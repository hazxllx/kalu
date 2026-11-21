import ApiError from '../utils/apiError.js';
import { assessClinicalEncounter, DEFAULT_CLINICAL_ASSESSMENT_CONFIG } from '../utils/clinicalAssessment.js';
import { BP_EMERGENCY_SYMPTOMS, bloodPressureSymptomsFromText } from '../../../shared/bloodPressure.js';

const indicatorLabels = {
  'severe difficulty breathing': 'severeBreathingDifficulty',
  'suspected stroke': 'suspectedStroke',
  'severe bleeding': 'severeBleeding',
  'altered consciousness': 'alteredConsciousness',
  convulsions: 'convulsions',
  'vaginal bleeding': 'bleeding',
  'severe headache': 'severeHeadache',
  'visual disturbances': 'visualDisturbance',
  'severe abdominal pain': 'severeAbdominalPain',
  'reduced fetal movement': 'reducedFetalMovement',
  'chronic disease requiring monitoring': 'chronicDisease',
  'active treatment required': 'activeTreatment',
  'moderate symptoms requiring evaluation': 'moderateSymptoms',
  'additional testing required': 'additionalTesting',
  'positive ncd screening requiring follow-up': 'ncdScreeningPositive',
  'required resources unavailable': 'resourcesUnavailable',
  'no danger signs': 'dangerSignsReviewed',
  'severe pregnancy blood pressure confirmed persistent at 15 minutes': 'pregnancySevereBpPersistent',
};

// Exact, standalone clinician assertions only. Never classify a substring such
// as "no severe bleeding", a family history, or a differential as a positive sign.
export const indicatorsFromFindings = (findings = '') => {
  const indicators = {};
  for (const clause of String(findings).toLowerCase().split(/[\n;.!?]|,\s*|\b(?:and|but|however|although)\b/)) {
    const text = clause.trim();
    if (!text || /\b(mother|father|sister|brother|family history|relative|history of)\b/.test(text)) continue;
    const isNegated = (start) => /\b(no|denies|without|negative for|not experiencing|does not have)\b(?:\W+\w+){0,5}\W*$/.test(text.slice(0, start));
    for (const [label, key] of Object.entries(indicatorLabels)) {
      const index = text.indexOf(label);
      if (index >= 0 && !isNegated(index)) indicators[key] = true;
    }
    const patterns = [
      [/\b(unconscious|unresponsive|decreased level of consciousness|altered mental status|disoriented)\b/, 'alteredConsciousness'],
      [/\b(seizure|seizures|fits|convulsion)\b/, 'convulsions'],
      [/\b(uncontrolled bleeding|profuse bleeding|heavy bleeding|severe hemorrhage|haemorrhage)\b/, 'severeBleeding'],
      [/\b(unable to breathe|gasping|severe respiratory distress|severe shortness of breath)\b/, 'severeBreathingDifficulty'],
      [/\b(facial droop|facial asymmetry|slurred speech|one[- ]sided (weakness|numbness)|sudden (arm|leg) weakness)\b/, 'suspectedStroke'],
      [/\b(vaginal bleeding|heavy bleeding|bleeding heavily)\b/, 'bleeding'],
      [/\b(blurred vision|vision changes|visual disturbance)\b/, 'visualDisturbance'],
      [/\b(upper abdominal pain|epigastric pain)\b/, 'severeAbdominalPain'],
      [/\b(reduced fetal movement|decreased fetal movement|baby (is )?moving less)\b/, 'reducedFetalMovement'],
    ];
    for (const [pattern, key] of patterns) {
      const match = pattern.exec(text);
      if (match && !isNegated(match.index)) indicators[key] = true;
    }
  }
  return indicators;
};

const indicatorKeys = new Set([...Object.values(indicatorLabels), ...Object.keys(BP_EMERGENCY_SYMPTOMS),
  'acuteCardiovascularSymptoms', 'followUpRequired', 'pregnancySevereBpPersistent', 'resourcesUnavailable']);

export const validateClinicalIndicators = (value) => {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ApiError.unprocessable('Clinical indicators must be a structured object.');
  }
  for (const [key, present] of Object.entries(value)) {
    if (!indicatorKeys.has(key) || typeof present !== 'boolean') {
      throw ApiError.unprocessable(`Clinical indicator ${key} must be a supported boolean finding.`);
    }
  }
  return value;
};

export const encounterBloodPressureContext = ({ chiefComplaint, findings, clinicalIndicators } = {}) => ({
  chiefComplaint,
  findings,
  indicators: {
    ...validateClinicalIndicators(clinicalIndicators),
    ...bloodPressureSymptomsFromText([chiefComplaint, findings].filter(Boolean).join('\n')),
  },
});

/** Records an encounter snapshot in existing consultation_details JSONB. */
export const buildEncounterAssessment = async ({ visit, resident, user, supabase = null, previous }) => {
  resident ||= {};
  previous ||= {};
  const submitted = validateClinicalIndicators(visit.consultationDetails?.clinicalIndicators);
  const bloodPressureContext = encounterBloodPressureContext({ chiefComplaint: visit.chiefComplaint,
    findings: visit.findings ?? visit.consultationDetails?.findings, clinicalIndicators: submitted });
  const indicators = {
    ...bloodPressureContext.indicators,
    ...indicatorsFromFindings(visit.consultationDetails?.findings ?? visit.findings),
    followUpRequired: visit.consultationDetails?.followUpRequired === 'Yes' || submitted.followUpRequired === true,
  };
  const encounterDate = visit.consultationDetails?.consultationDate
    || (Number.isFinite(Date.parse(visit.visitDate)) ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila' }).format(new Date(visit.visitDate)) : null);
  if (resident.birthDate && encounterDate) {
    const birth = new Date(resident.birthDate);
    const at = new Date(encounterDate);
    let age = at.getUTCFullYear() - birth.getUTCFullYear();
    if (at.getUTCMonth() < birth.getUTCMonth() || (at.getUTCMonth() === birth.getUTCMonth() && at.getUTCDate() < birth.getUTCDate())) age -= 1;
    if (Number.isFinite(age) && age >= 0) indicators.age = age;
  }
  let pregnancy = null;
  let config = {};
  let approval = null;
  let sourceStatus = supabase ? 'available' : 'unavailable';
  if (supabase && encounterDate) {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => supabase.from('maternal_pregnancies').select('id,edd_date,status,date_of_registration,outcome_date')
        .eq('resident_id', visit.residentId).lte('date_of_registration', encounterDate)
        .order('date_of_registration', { ascending: false }).limit(1).maybeSingle()),
      Promise.resolve().then(() => supabase.from('clinical_assessment_protocols').select('version,thresholds,approved_by,approved_at,review_reference')
        .eq('municipality_id', user.municipalityId || resident.municipalityId || '00000000-0000-0000-0000-000000000000')
        .eq('active', true).maybeSingle()),
      Promise.resolve().then(() => supabase.from('ncd_risk_assessments').select('data,assessment_date')
        .eq('resident_id', visit.residentId).lte('assessment_date', encounterDate)
        .order('assessment_date', { ascending: false }).limit(1).maybeSingle()),
    ]);
    const [maternal, protocol] = results.map((result) => result.value || { error: true });
    if (maternal.error) sourceStatus = 'unavailable';
    const row = maternal.data;
    const ncd = results[2].value || { error: true };
    if (ncd.data && (ncd.data.data?.htn_result === '+' || ncd.data.data?.dm_result === '+')) {
      indicators.ncdScreeningPositive = true;
    }
    const date = encounterDate;
    const postpartum = row?.outcome_date && date >= row.outcome_date
      && Date.parse(`${date}T00:00:00Z`) - Date.parse(`${row.outcome_date}T00:00:00Z`) <= 42 * 86400000;
    if (row && (!row.outcome_date || row.outcome_date >= date)
      && (row.outcome_date || ['active', 'lost_to_followup', 'transferred'].includes(row.status)) || postpartum) {
      pregnancy = { isPregnant: !postpartum, isPostpartum: Boolean(postpartum), gestationalAgeWeeks: null };
      if (!postpartum && row.edd_date) {
        const weeks = (280 - (Date.parse(row.edd_date) - Date.parse(date)) / 86400000) / 7;
        if (Number.isFinite(weeks) && weeks >= 0) pregnancy.gestationalAgeWeeks = weeks;
      }
    }
    const thresholds = protocol.data?.thresholds;
    const validThresholds = ['pregnancy', 'adult'].every((group) => ['systolic', 'diastolic'].every((field) => {
      const elevated = thresholds?.[`${group}Elevated`]?.[field];
      const severe = thresholds?.[`${group}Severe`]?.[field];
      return Number.isInteger(elevated) && Number.isInteger(severe) && elevated > 0 && elevated < severe && severe <= 300;
    }));
    if (!protocol.error && validThresholds && protocol.data?.approved_by && protocol.data.approved_at && protocol.data.review_reference) {
      approval = protocol.data;
      config = { thresholds: protocol.data.thresholds || {} };
    }
  }
  if (pregnancy) Object.assign(pregnancy, Object.fromEntries(
    ['bleeding', 'severeHeadache', 'visualDisturbance', 'severeAbdominalPain', 'reducedFetalMovement'].map((key) => [key, indicators[key]]),
  ));
  const computed = assessClinicalEncounter({ vitals: visit.vitals, indicators, pregnancy, config, bloodPressureContext });
  const now = new Date().toISOString();
  const assessment = {
    ...computed,
    ruleVersion: approval?.version || computed.ruleVersion,
    reviewStatus: approval ? 'approved' : 'requires_clinical_approval',
    approval: approval ? { by: approval.approved_by, at: approval.approved_at, reference: approval.review_reference } : null,
    references: { ...DEFAULT_CLINICAL_ASSESSMENT_CONFIG.references, ...(approval ? { approvedProtocol: approval.review_reference } : {}) },
    thresholds: approval ? config.thresholds : null,
    assessedAt: now, assessedBy: user.id,
    inputs: { vitals: visit.vitals || {}, indicators, pregnancy }, sourceStatus,
  };
  if (!approval) {
    // Shared BP safety remains actionable while local protocol rules await approval.
    const safetyReasons = computed.reasons.filter(({ ruleId }) => ruleId === 'bp_emergency' || ruleId === 'bp_severe');
    const emergency = safetyReasons.some(({ ruleId }) => ruleId === 'bp_emergency');
    Object.assign(assessment, safetyReasons.length ? {
      level: 'High', status: 'assessed', referralEvaluationRequired: true,
      urgency: emergency ? 'immediate' : 'prompt', reasons: safetyReasons,
      followUpRequirements: [emergency ? 'immediate_emergency_evaluation' : 'prompt_bp_referral_evaluation'],
    } : { level: null, status: 'pending_clinical_approval', referralEvaluationRequired: null,
      urgency: null, followUpRequirements: [], reasons: [] });
  } else if (sourceStatus !== 'available' && assessment.level === 'Low') {
    Object.assign(assessment, { level: null, status: 'incomplete', referralEvaluationRequired: null });
  }
  // The caller supplies the server's prior JSON, never a client-provided history.
  const history = Array.isArray(previous.clinicalAssessmentHistory) ? previous.clinicalAssessmentHistory : [];
  return { ...visit.consultationDetails, clinicalIndicators: submitted,
    clinicalAssessment: assessment, clinicalAssessmentHistory: [...history, assessment] };
};

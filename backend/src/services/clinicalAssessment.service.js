// backend/src/services/clinicalAssessment.service.js
import ApiError from '../utils/apiError.js';
import { assessClinicalEncounter, DEFAULT_CLINICAL_ASSESSMENT_CONFIG } from '../utils/clinicalAssessment.js';
import { BP_EMERGENCY_SYMPTOMS, bloodPressureSymptomsFromText } from '../../../shared/bloodPressure.js';
import {
  assessConsultationRisk, consultationChronology, consultationNumber, clinicalTextIndicatesPregnancy,
  isConsultationDate, normalizeConsultationRiskLevel, previousConsultationAssessment,
  savedConsultationAssessment, isAuthorizedRiskReview,
} from '../../../shared/consultationClinical.js';
import { canConsult } from '../config/rhuStations.js';
import { getRiskConfig } from './riskConfig.service.js';
import { riskHistoryVisit } from '../utils/residentRisk.js';

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
  'acuteCardiovascularSymptoms', 'followUpRequired', 'pregnancySevereBpPersistent', 'resourcesUnavailable',
  'dangerSignsReviewed']);

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

export const validateConsultationClinicalContext = (value) => {
  if (value === undefined) return { pregnancyStatus: 'unknown', existingConditions: [] };
  const errors = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ApiError.unprocessable('Please correct the clinical context.', { clinicalContext: 'Use a structured clinical context.' });
  }
  for (const key of Object.keys(value)) if (!['pregnancyStatus', 'existingConditions'].includes(key)) {
    errors[`clinicalContext.${key}`] = 'This clinical context field is not supported.';
  }
  const pregnancyStatus = value.pregnancyStatus ?? 'unknown';
  if (!['pregnant', 'not_pregnant', 'postpartum', 'unknown'].includes(pregnancyStatus)) {
    errors['clinicalContext.pregnancyStatus'] = 'Choose pregnant, not pregnant, postpartum, or unknown.';
  }
  if (!Array.isArray(value.existingConditions) || value.existingConditions.length > 50) {
    errors['clinicalContext.existingConditions'] = 'Use up to 50 structured condition records.';
  }
  const existingConditions = (Array.isArray(value.existingConditions) ? value.existingConditions : []).map((condition, index) => {
    const field = `clinicalContext.existingConditions[${index}]`;
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
      errors[field] = 'Use a structured condition record.';
      return null;
    }
    for (const key of Object.keys(condition)) if (!['name', 'status', 'significant'].includes(key)) errors[`${field}.${key}`] = 'This condition field is not supported.';
    if (typeof condition.name !== 'string' || !condition.name.trim() || condition.name.trim().length > 160) errors[`${field}.name`] = 'Enter a condition name of up to 160 characters.';
    if (!['stable', 'uncontrolled'].includes(condition.status)) errors[`${field}.status`] = 'Choose stable or uncontrolled.';
    if (typeof condition.significant !== 'boolean') errors[`${field}.significant`] = 'Use true or false for clinical significance.';
    return { name: typeof condition.name === 'string' ? condition.name.trim() : '', status: condition.status, significant: condition.significant };
  });
  if (Object.keys(errors).length) throw ApiError.unprocessable('Please correct the clinical context.', errors);
  return { pregnancyStatus, existingConditions };
};

export const canReviewConsultationRisk = (user) => ['mho', 'phn', 'rhu_personnel'].includes(user?.role)
  || (user?.role === 'health_supervisor' && canConsult(user));

export const validateConsultationRiskReview = (value, user) => {
  if (value === undefined) return null;
  if (!canReviewConsultationRisk(user)) throw ApiError.forbidden('Only an authorized clinical professional may reassess consultation risk.');
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['Low', 'Medium', 'High'].includes(value.level)
    || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.trim().length > 1000
    || value.reassessmentConfirmed !== true || Object.keys(value).some((key) => !['level', 'reason', 'reassessmentConfirmed'].includes(key))) {
    throw ApiError.unprocessable('Please document the confirmed clinical reassessment.', {
      riskReview: 'Choose Low, Medium, or High, confirm reassessment, and enter a reason (1-1000 characters). Audit fields are server-managed.',
    });
  }
  return { level: value.level, reason: value.reason.trim(), reassessmentConfirmed: true };
};

const daysBetween = (a, b) => (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
const dateShift = (date, days) => isConsultationDate(date) ? new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10) : null;
const datingMatches = (a, b) => Boolean((a.lmpDate && a.lmpDate === b.lmpDate) || (a.eddDate && a.eddDate === b.eddDate))
  && !(a.lmpDate && b.lmpDate && a.lmpDate !== b.lmpDate) && !(a.eddDate && b.eddDate && a.eddDate !== b.eddDate);

/** Resolve only clinically dated, same-resident episodes. Registration/upload order is not pregnancy identity. */
export const resolveConsultationPregnancy = ({ canonical = [], legacy = [], consultationDate }) => {
  const episodes = canonical.map((row) => ({ id: row.id, maternalRecordId: null, source: 'maternal_pregnancies',
    lmpDate: row.lmp_date || null, eddDate: row.edd_date || null, registrationDate: row.date_of_registration || null,
    outcomeDate: row.outcome_date || null, status: row.status }));
  let unresolved = false;
  for (const row of legacy) {
    const episode = { id: null, maternalRecordId: row.id, source: 'maternal_records',
      lmpDate: row.lmp || null, eddDate: row.edd || null, registrationDate: row.date_of_registration || null,
      outcomeDate: row.pregnancy_outcome_date || row.delivery_date || null, status: String(row.status || '').toLowerCase() };
    const candidates = episodes.filter((candidate) => row.pregnancy_id
      ? candidate.id === row.pregnancy_id && !(candidate.lmpDate && episode.lmpDate && candidate.lmpDate !== episode.lmpDate)
        && !(candidate.eddDate && episode.eddDate && candidate.eddDate !== episode.eddDate)
      : datingMatches(candidate, episode));
    if (candidates.length === 1) {
      const matched = candidates[0];
      matched.maternalRecordId = row.id;
      matched.lmpDate ||= episode.lmpDate;
      matched.eddDate ||= episode.eddDate;
      matched.outcomeDate ||= episode.outcomeDate;
      continue;
    }
    if (row.pregnancy_id || candidates.length > 1) unresolved = true;
    episodes.push(episode);
  }
  const current = [];
  for (const episode of episodes) {
    const start = episode.lmpDate || dateShift(episode.eddDate, -280) || episode.registrationDate;
    if (!start || !isConsultationDate(start)) { if (['active', 'lost_to_followup', 'transferred'].includes(episode.status)) unresolved = true; continue; }
    if (consultationDate < start) continue;
    if (!episode.outcomeDate && ['delivered', 'terminated'].includes(episode.status)
      && (!episode.eddDate || daysBetween(consultationDate, episode.eddDate) <= 42)) unresolved = true;
    const postpartum = isConsultationDate(episode.outcomeDate) && daysBetween(consultationDate, episode.outcomeDate) >= 0
      && daysBetween(consultationDate, episode.outcomeDate) <= 42;
    const pregnant = episode.outcomeDate ? consultationDate < episode.outcomeDate
      : ['active', 'lost_to_followup', 'transferred'].includes(episode.status);
    if (!postpartum && !pregnant) continue;
    if (pregnant && episode.eddDate && daysBetween(consultationDate, episode.eddDate) > 42) { unresolved = true; continue; }
    const weeks = episode.lmpDate ? daysBetween(consultationDate, episode.lmpDate) / 7
      : episode.eddDate ? (280 - daysBetween(episode.eddDate, consultationDate)) / 7 : null;
    current.push({ ...episode, isPregnant: pregnant, isPostpartum: postpartum,
      gestationalAgeWeeks: pregnant && Number.isFinite(weeks) && weeks >= 0 && weeks <= 46 ? Math.round(weeks * 100) / 100 : null });
  }
  if (current.length > 1) unresolved = true;
  const pregnancy = current.length === 1 ? current[0] : current.length ? {
    id: null, maternalRecordId: null, lmpDate: null, eddDate: null, gestationalAgeWeeks: null,
    isPregnant: current.some((row) => row.isPregnant), isPostpartum: !current.some((row) => row.isPregnant) && current.some((row) => row.isPostpartum),
    source: 'ambiguous_maternal_episodes',
  } : null;
  return { pregnancy, episodes, unresolved };
};

/** All reads are bounded/paginated; unavailable sources are explicit and cannot establish absence. */
export const loadEncounterClinicalContext = async ({ resident, user, consultationDate, consultationTime = '23:59',
  residentId = resident?.id, repo = null, supabase = null, excludeVisitId = null } = {}) => {
  const sources = {};
  const readRows = async (table, columns, dateField = null) => {
    if (!supabase) { sources[table] = 'unavailable'; return null; }
    try {
      const rows = [];
      for (let offset = 0; ; offset += 500) {
        let query = supabase.from(table).select(columns).eq('resident_id', residentId).order('id').range(offset, offset + 499);
        if (dateField) query = query.lte(dateField, consultationDate);
        const { data, error } = await query;
        if (error || !Array.isArray(data)) throw new Error('Clinical source unavailable');
        rows.push(...data);
        if (data.length < 500) break;
      }
      sources[table] = 'available';
      return rows;
    } catch { sources[table] = 'unavailable'; return null; }
  };
  const readHistory = async () => {
    try {
      if (!repo?.listVisits) throw new Error('Clinical history unavailable');
      const rows = [];
      for (let offset = 0; ; offset += 200) {
        const page = await repo.listVisits({ residentId, to: consultationDate, orderBy: 'clinicalDate', limit: 200, offset });
        if (!Array.isArray(page?.rows)) throw new Error('Clinical history unavailable');
        rows.push(...page.rows);
        if (page.rows.length < 200) break;
      }
      if (excludeVisitId && !rows.some((row) => row.id === excludeVisitId)) {
        const current = await repo.getVisit(excludeVisitId);
        if (current?.residentId === residentId) rows.push(current);
      }
      sources.history = 'available';
      return rows;
    } catch { sources.history = 'unavailable'; return null; }
  };
  const readProtocol = async () => {
    try {
      if (!supabase) throw new Error('Protocol source unavailable');
      const { data, error } = await supabase.from('clinical_assessment_protocols')
        .select('version,thresholds,approved_by,approved_at,review_reference').eq('municipality_id', user?.municipalityId || resident?.municipalityId)
        .eq('active', true).maybeSingle();
      if (error) throw error;
      sources.protocol = 'available';
      return data || null;
    } catch { sources.protocol = 'unavailable'; return null; }
  };
  const [canonical, legacy, ncd, tcl, history, protocol] = await Promise.all([
    readRows('maternal_pregnancies', 'id,lmp_date,edd_date,status,date_of_registration,outcome_date'),
    readRows('maternal_records', 'id,pregnancy_id,lmp,edd,status,date_of_registration,delivery_date,pregnancy_outcome_date'),
    readRows('ncd_risk_assessments', 'id,data,assessment_date', 'assessment_date'),
    readRows('tcl_entries', 'id,program,status,last_visit'), readHistory(), readProtocol(),
  ]);
  let riskConfig = null;
  try { riskConfig = await getRiskConfig({ repo, strict: true }); sources.historyRisk = 'available'; }
  catch { sources.historyRisk = 'unavailable'; }
  const riskHistory = (history || []).map((visit) => riskConfig ? riskHistoryVisit(visit, riskConfig) : visit);
  const resolved = resolveConsultationPregnancy({ canonical: canonical || [], legacy: legacy || [], consultationDate });
  const conditions = new Map();
  const merge = (condition) => {
    const key = String(condition.name || '').trim().toLowerCase();
    if (!key) return;
    const prior = conditions.get(key);
    conditions.set(key, { ...prior, ...condition, status: prior?.status === 'uncontrolled' || condition.status === 'uncontrolled' ? 'uncontrolled' : 'stable',
      significant: prior?.significant === true || condition.significant === true });
  };
  for (const row of [...(ncd || [])].sort((a, b) => String(a.assessment_date).localeCompare(String(b.assessment_date)))) {
    for (const [field, name] of [['htn_result', 'Positive hypertension screening'], ['dm_result', 'Positive diabetes screening']]) {
      if (row.data?.[field] === '+') merge({ name, status: 'stable', significant: true, source: 'ncd_risk_assessments', sourceId: row.id, assessmentDate: row.assessment_date, screening: true });
    }
  }
  for (const row of tcl || []) if (String(row.status).toLowerCase() === 'active' && (!row.last_visit || row.last_visit <= consultationDate)) {
    if (/^(?:ncd|hypertension|diabetes|asthma|tuberculosis|tb)$/i.test(String(row.program || '').trim())) {
      merge({ name: row.program, status: 'stable', significant: true, source: 'tcl_entries', sourceId: row.id });
    }
  }
  const asOf = `${consultationDate}T${consultationTime}`;
  const chronological = (history || []).filter((visit) => consultationChronology(visit) <= asOf)
    .sort((a, b) => consultationChronology(a).localeCompare(consultationChronology(b)) || String(a.id).localeCompare(String(b.id)));
  for (const visit of chronological) {
    const recorded = visit.consultationDetails?.clinicalContext?.existingConditions;
    const review = visit.consultationDetails?.consultationRiskAssessment?.review;
    if (Array.isArray(recorded) && isAuthorizedRiskReview(review)) {
      const names = new Set(recorded.map((condition) => String(condition.name || '').toLowerCase()));
      for (const [key, condition] of conditions) if (condition.source === 'professional_report' && !names.has(key)) conditions.delete(key);
    }
    if (Array.isArray(recorded)) for (const condition of recorded) {
      if (condition && typeof condition === 'object' && typeof condition.name === 'string') {
        if (isAuthorizedRiskReview(review) && condition.source === 'professional_report' && condition.reassessmentReason === review.reason) {
          conditions.set(condition.name.toLowerCase(), { ...condition, sourceId: visit.id });
        } else merge({ ...condition, source: condition.source || 'saved_consultation', sourceId: condition.sourceId || visit.id });
      }
    }
  }
  let age = null;
  if (isConsultationDate(resident?.birthDate) && isConsultationDate(consultationDate) && resident.birthDate <= consultationDate) {
    const birth = resident.birthDate;
    age = Number(consultationDate.slice(0, 4)) - Number(birth.slice(0, 4)) - (consultationDate.slice(5) < birth.slice(5) ? 1 : 0);
  }
  const unavailable = ['maternal_pregnancies', 'maternal_records', 'ncd_risk_assessments', 'tcl_entries', 'history', 'historyRisk'].some((source) => sources[source] !== 'available');
  return { pregnancy: resolved.pregnancy, existingConditions: [...conditions.values()],
    previousAssessment: previousConsultationAssessment(riskHistory, { asOf, excludeVisitId }), age,
    currentAssessment: excludeVisitId ? previousConsultationAssessment(riskHistory.filter((visit) => visit.id === excludeVisitId)) : null,
    sourceStatus: unavailable ? 'unavailable' : resolved.unresolved ? 'incomplete' : 'available', sources,
    protocol, episodes: resolved.episodes };
};

export const reconcileConsultationClinicalContext = ({ context, submitted, user, previous = null, riskReview = null }) => {
  const input = validateConsultationClinicalContext(submitted);
  const conditions = new Map((context.existingConditions || []).map((condition) => [condition.name.toLowerCase(), condition]));
  if (riskReview && canReviewConsultationRisk(user)) {
    const names = new Set(input.existingConditions.map((condition) => condition.name.toLowerCase()));
    for (const [key, condition] of conditions) if (condition.source === 'professional_report' && !names.has(key)) conditions.delete(key);
  }
  for (const condition of input.existingConditions) {
    const key = condition.name.toLowerCase();
    const official = conditions.get(key);
    if (official?.source === 'professional_report' && riskReview && canReviewConsultationRisk(user)) {
      conditions.set(key, { ...condition, source: 'professional_report', reportedBy: user.id, reassessmentReason: riskReview.reason });
      continue;
    }
    conditions.set(key, { ...condition, source: 'professional_report', reportedBy: user.id,
      ...(official ? { ...official, significant: official.significant || condition.significant,
        status: official.status === 'uncontrolled' || condition.status === 'uncontrolled' ? 'uncontrolled' : 'stable' } : {}) });
  }
  const official = context.pregnancy;
  const pregnancy = official || null;
  return { pregnancyStatus: pregnancy?.isPregnant ? 'pregnant' : pregnancy?.isPostpartum ? 'postpartum' : 'unknown',
    pregnancy, existingConditions: [...conditions.values()], submitted: input,
    sourceStatus: context.sourceStatus, sources: context.sources, verification: 'server_reconciled_professional_input',
    verifiedBy: user.id, verifiedAt: new Date().toISOString(),
    ...(official && ((official.isPregnant && input.pregnancyStatus === 'not_pregnant') || (official.isPostpartum && input.pregnancyStatus === 'not_pregnant'))
      ? { reconciliationWarning: 'Recorded maternal episode retained; a client report cannot dismiss official pregnancy or postpartum context.' } : {}),
    ...(previous?.clinicalContext?.reconciliationWarning ? { previousReconciliationWarning: previous.clinicalContext.reconciliationWarning } : {}) };
};

export const resolveConsultationMaternal = ({ value, context, clinicalContext, consultationDate, healthService, clinicalText }) => {
  if (value === undefined || value === null) return null;
  const errors = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw ApiError.unprocessable('Please correct the maternal care details.', { maternal: 'Use a structured maternal care record.' });
  if (!['prenatal', 'postpartum'].includes(value.careType)) errors['maternal.careType'] = 'Choose prenatal or postpartum care.';
  if (!healthService?.id || String(healthService.category).toLowerCase() !== 'maternal') errors['maternal.careType'] = 'Select a real maternal health service before recording maternal care.';
  const pregnancyIndicatedByClinicalText = clinicalTextIndicatesPregnancy(clinicalText);
  for (const field of ['lmpDate', 'eddDate']) if (value[field] != null && value[field] !== '' && !isConsultationDate(value[field])) errors[`maternal.${field}`] = 'Use a valid calendar date.';
  let pregnancy = context.pregnancy || clinicalContext.pregnancy;
  if (value.pregnancyId) {
    const episode = context.episodes?.find((row) => row.id === value.pregnancyId);
    if (!episode || episode.id !== context.pregnancy?.id) errors['maternal.pregnancyId'] = 'The selected pregnancy is not a confirmed same-resident episode for this consultation date.';
    else pregnancy = context.pregnancy;
  }
  if (value.careType === 'prenatal' && !pregnancy?.isPregnant && !pregnancyIndicatedByClinicalText) {
    errors['maternal.careType'] = 'Record pregnancy-related terms in the chief complaint or clinical findings, or use a confirmed same-resident pregnancy episode for prenatal care.';
  }
  if (value.careType === 'prenatal' && pregnancy?.isPostpartum) errors['maternal.careType'] = 'The recorded episode is postpartum, not prenatal.';
  if (value.careType === 'postpartum' && pregnancy?.isPregnant) errors['maternal.careType'] = 'The recorded episode is still pregnant; verify postpartum episode details.';
  const lmpDate = pregnancy?.lmpDate || value.lmpDate || null;
  const eddDate = pregnancy?.eddDate || value.eddDate || null;
  if (lmpDate && lmpDate > consultationDate) errors['maternal.lmpDate'] = 'LMP cannot be after the consultation date.';
  if (lmpDate && eddDate && (daysBetween(eddDate, lmpDate) < 140 || daysBetween(eddDate, lmpDate) > 330)) errors['maternal.eddDate'] = 'Check the pregnancy dating; EDD must be consistent with LMP.';
  if (pregnancy?.lmpDate && value.lmpDate && pregnancy.lmpDate !== value.lmpDate) errors['maternal.lmpDate'] = 'The submitted LMP conflicts with the recorded maternal episode.';
  if (pregnancy?.eddDate && value.eddDate && pregnancy.eddDate !== value.eddDate) errors['maternal.eddDate'] = 'The submitted EDD conflicts with the recorded maternal episode.';
  if (value.gestationalAgeWeeks != null && consultationNumber(value.gestationalAgeWeeks) === null) errors['maternal.gestationalAgeWeeks'] = 'Use a valid numeric gestational age.';
  const calculated = lmpDate ? daysBetween(consultationDate, lmpDate) / 7 : eddDate ? (280 - daysBetween(eddDate, consultationDate)) / 7 : null;
  const weeks = pregnancy?.gestationalAgeWeeks ?? (Number.isFinite(calculated) ? calculated : consultationNumber(value.gestationalAgeWeeks));
  if (value.careType === 'prenatal' && weeks !== null && (weeks < 0 || weeks > 46)) errors['maternal.gestationalAgeWeeks'] = 'Gestational age must be between 0 and 46 weeks.';
  if (Object.keys(errors).length) throw ApiError.unprocessable('Please correct the maternal care details.', errors);
  return { careType: value.careType, pregnancyId: pregnancy?.id || null, lmpDate, eddDate,
    gestationalAgeWeeks: value.careType === 'prenatal' && weeks !== null ? Math.round(weeks * 100) / 100 : null,
    pregnancyIndicatedByDiagnosis: pregnancyIndicatedByClinicalText,
    ...(pregnancy?.maternalRecordId ? { maternalRecordId: pregnancy.maternalRecordId } : {}),
    sourceStatus: context.sourceStatus, pregnancyResolution: pregnancy?.id ? 'canonical_episode' : lmpDate || eddDate ? 'dated_unlinked_episode' : 'unresolved' };
};

/** Records an encounter snapshot in existing consultation_details JSONB. */
export const buildEncounterAssessment = async ({ visit, resident, user, supabase = null, previous, context = null, riskReview = null }) => {
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
  let pregnancy = context ? structuredClone(visit.consultationDetails?.clinicalContext?.pregnancy ?? context.pregnancy) : null;
  let config = {};
  let approval = null;
  let sourceStatus = context?.sourceStatus ?? (supabase ? 'available' : 'unavailable');
  if (context) {
    if (context.protocol) {
      const thresholds = context.protocol.thresholds;
      const valid = ['pregnancy', 'adult'].every((group) => ['systolic', 'diastolic'].every((field) => {
        const elevated = thresholds?.[`${group}Elevated`]?.[field];
        const severe = thresholds?.[`${group}Severe`]?.[field];
        return Number.isInteger(elevated) && Number.isInteger(severe) && elevated > 0 && elevated < severe && severe <= 300;
      }));
      if (valid && context.protocol.approved_by && context.protocol.approved_at && context.protocol.review_reference) {
        approval = context.protocol;
        config = { thresholds };
      }
    }
    if ((visit.consultationDetails?.clinicalContext?.existingConditions || []).length) indicators.chronicDisease = true;
    if ((context.existingConditions || []).some((condition) => condition.screening)) indicators.ncdScreeningPositive = true;
  } else if (supabase && encounterDate) {
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
    if (maternal.error || results[2].status === 'rejected' || results[2].value?.error) sourceStatus = 'unavailable';
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
  const details = { ...visit.consultationDetails, clinicalIndicators: submitted,
    clinicalAssessment: assessment, clinicalAssessmentHistory: [...history, assessment] };
  if (context) {
    const clinicalContext = details.clinicalContext;
    const priorCurrent = context.currentAssessment || savedConsultationAssessment(previous);
    const prior = normalizeConsultationRiskLevel(priorCurrent?.level) === 'High' ? {
      ...priorCurrent, sourceVisitId: visit.id, consultationDate: previous.consultationDate || encounterDate,
    } : context.previousAssessment;
    const screeningIndicators = { ...submitted, ...indicatorsFromFindings(details.findings ?? visit.findings),
      ...(indicators.chronicDisease ? { chronicDisease: true } : {}), ...(indicators.ncdScreeningPositive ? { ncdScreeningPositive: true } : {}),
      followUpRequired: indicators.followUpRequired };
    if (computed.reasons.some((reason) => ['bp_emergency', 'bp_severe'].includes(reason.ruleId))) Object.assign(screeningIndicators, bloodPressureContext.indicators);
    const screening = assessConsultationRisk({ vitals: visit.vitals, age: context.age,
      indicators: screeningIndicators, pregnancy, existingConditions: clinicalContext?.existingConditions ?? context.existingConditions,
      previousAssessment: prior, sourceStatus });
    const priorReview = previous.consultationRiskAssessment?.review;
    if (riskReview) {
      if (riskReview.level === 'Low' && sourceStatus !== 'available') {
        throw ApiError.unprocessable('Low risk cannot be established while clinical source data is unavailable or unresolved.', { riskReview: 'Verify clinical source context before selecting Low.' });
      }
      if (screening.computedLevel === 'High' && riskReview.level !== 'High') {
        throw ApiError.unprocessable('Current danger findings cannot be downgraded by a risk review.', { riskReview: 'Reassess and correct the actual clinical findings before selecting a lower risk.' });
      }
      const review = { ...riskReview, previousLevel: prior?.level || previous.consultationRiskAssessment?.level || null,
        reviewedBy: user.id, reviewedByRole: user.role, reviewedAt: now,
        ...(user.role === 'health_supervisor' ? { clinicianAuthority: 'consultation_station' } : {}) };
      Object.assign(screening, { level: riskReview.level, status: 'assessed', previousHighHeld: false, review,
        reasons: [...screening.reasons.filter((reason) => reason.ruleId !== 'previous_high_held'),
          { ruleId: 'authorized_clinical_reassessment', message: riskReview.reason }] });
      details.riskReviewHistory = [...(Array.isArray(previous.riskReviewHistory) ? previous.riskReviewHistory : []), review];
    } else if (isAuthorizedRiskReview(priorReview)) screening.review = priorReview;
    details.consultationRiskAssessment = { ...screening, assessedBy: user.id, assessedByRole: user.role, assessedAt: now,
      sources: Object.entries(context.sources).map(([type, status]) => ({ type, status })),
      inputs: { vitals: visit.vitals, age: context.age, pregnancy, existingConditions: clinicalContext?.existingConditions || [], indicators: screeningIndicators } };
    details.consultationRiskAssessmentHistory = [...(Array.isArray(previous.consultationRiskAssessmentHistory) ? previous.consultationRiskAssessmentHistory : []), details.consultationRiskAssessment];
    if (!riskReview && previous.riskReviewHistory) details.riskReviewHistory = previous.riskReviewHistory;
  }
  return details;
};

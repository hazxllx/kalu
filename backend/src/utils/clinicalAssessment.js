import { classifyBloodPressure, parseBloodPressure } from '../../../shared/bloodPressure.js';

export const DEFAULT_CLINICAL_ASSESSMENT_CONFIG = Object.freeze({
  ruleVersion: 'clinical-encounter-v1',
  references: Object.freeze({
    DOH_MATERNAL: 'WHO Pre-eclampsia (2026): https://www.who.int/news-room/fact-sheets/detail/pre-eclampsia ; Philippine society hypertension CPG (2020), statement 22 p.59: https://drive.google.com/file/d/1t3UFLQG6XxTUNkVniliIbKnvnUVmDuKD/view ; severe BP diagnosis requires persistence at least 15 minutes. DOH AO 2015-0020 VI.7: https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/70257 . Screening prompts evaluation, never diagnosis or medication.',
    DOH_PRIMARY: 'DOH Omnibus Health Guidelines, Adults 20-59 (2023), p.158: https://drive.google.com/file/d/1I9J8fRqDpb6fk0RacL0V4QF-nsPTzr1Q/view ; 180 systolic OR 110 diastolic WITH acute signs warrants emergent referral. BP alone prompts assessment. Population scope and local applicability require approval.',
    DOH_EMERGENCY: 'DOH Omnibus Health Guidelines, Adults 20-59 (2023), p.42: https://drive.google.com/file/d/1I9J8fRqDpb6fk0RacL0V4QF-nsPTzr1Q/view ; neurological deficits, altered consciousness, seizures, breathing difficulty and profuse bleeding are independent triage red flags. Applicability to other ages requires clinical protocol review.',
  }),
  // Systolic and diastolic blood pressure thresholds are in mmHg.
  thresholds: Object.freeze({
    pregnancyElevated: Object.freeze({ systolic: 140, diastolic: 90 }),
    pregnancySevere: Object.freeze({ systolic: 160, diastolic: 110 }),
    adultElevated: Object.freeze({ systolic: 140, diastolic: 90 }),
    adultSevere: Object.freeze({ systolic: 180, diastolic: 110 }),
  }),
});

const GENERAL_DANGER_SIGNS = [
  'severeBreathingDifficulty', 'suspectedStroke', 'severeBleeding', 'alteredConsciousness', 'convulsions',
];
const MATERNAL_DANGER_SIGNS = [
  'bleeding', 'severeHeadache', 'visualDisturbance', 'severeAbdominalPain', 'reducedFetalMovement',
];
const ROUTINE_REQUIREMENTS = {
  chronicDisease: 'review_chronic_disease_care',
  activeTreatment: 'review_active_treatment',
  moderateSymptoms: 'review_symptoms',
  followUpRequired: 'arrange_follow_up',
  additionalTesting: 'review_additional_testing',
  ncdScreeningPositive: 'confirm_and_manage_positive_ncd_screening',
};

const positiveNumber = (value) => {
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    value = Number(value);
  }
  return Number.isFinite(value) && value > 0 ? value : null;
};

/**
 * A pregnancy object denotes a current pregnancy unless `isPregnant` is explicitly false.
 * Maternal danger signs belong on that object; `null` means not evaluated.
 */
export function assessClinicalEncounter({ vitals = {}, indicators = {}, pregnancy = null, config = {}, bloodPressureContext = null } = {}) {
  const pregnant = pregnancy === true || (
    pregnancy !== null && typeof pregnancy === 'object' && !Array.isArray(pregnancy) && pregnancy.isPregnant !== false
  );
  const maternal = pregnant || pregnancy?.isPostpartum === true;
  // Age is expressed in years, not inferred from the encounter type.
  const age = positiveNumber(indicators?.age);
  const adult = age !== null && age >= 20 && age <= 59;
  const structuredBp = vitals?.systolic != null || vitals?.diastolic != null;
  const reading = structuredBp ? { systolic: vitals.systolic, diastolic: vitals.diastolic } : vitals?.bp;
  const bp = parseBloodPressure(reading);
  const systolic = bp?.systolic ?? null;
  const diastolic = bp?.diastolic ?? null;
  const completeBp = bp !== null;
  const validBp = completeBp;
  const bpSafety = classifyBloodPressure(reading, bloodPressureContext ?? { indicators });

  const reasons = [];
  const followUpRequirements = new Set();
  const urgencyRank = { routine: 1, prompt: 2, immediate: 3 };
  let urgency = null;
  const addFinding = (ruleId, reference, requiredUrgency, requirement, field) => {
    reasons.push({ ruleId, reference, ...(field ? { field } : {}) });
    followUpRequirements.add(requirement);
    if (!urgency || urgencyRank[requiredUrgency] > urgencyRank[urgency]) urgency = requiredUrgency;
  };

  for (const field of GENERAL_DANGER_SIGNS) {
    if (indicators?.[field] === true) {
      addFinding('general_danger_sign', 'DOH_EMERGENCY', 'immediate', 'immediate_referral_evaluation', field);
    }
  }
  if (bpSafety?.referralEvaluationRequired) {
    addFinding(bpSafety.emergency ? 'bp_emergency' : 'bp_severe', 'DOH_PRIMARY', bpSafety.urgency,
      bpSafety.emergency ? 'immediate_emergency_evaluation' : 'prompt_bp_referral_evaluation');
  }
  if (indicators?.resourcesUnavailable === true) {
    addFinding('required_resources_unavailable', 'DOH_EMERGENCY', 'prompt', 'evaluate_referral_for_required_resources');
  }
  if (maternal) {
    for (const field of MATERNAL_DANGER_SIGNS) {
      if (pregnancy[field] === true) {
        addFinding('maternal_danger_sign', 'DOH_MATERNAL', 'prompt', 'prompt_maternal_referral_evaluation', field);
      }
    }
  }

  if (maternal || adult) {
    const group = maternal ? 'pregnancy' : 'adult';
    const thresholds = DEFAULT_CLINICAL_ASSESSMENT_CONFIG.thresholds;
    const getThreshold = (key) => Object.fromEntries(
      Object.entries(thresholds[key]).map(([field, fallback]) => {
        const value = config?.thresholds?.[key]?.[field];
        return [field, Number.isFinite(value) && value > 0 ? value : fallback];
      }),
    );
    let elevated = getThreshold(`${group}Elevated`);
    let severe = getThreshold(`${group}Severe`);
    if (elevated.systolic >= severe.systolic || elevated.diastolic >= severe.diastolic) {
      elevated = thresholds[`${group}Elevated`];
      severe = thresholds[`${group}Severe`];
    }
    const meets = (threshold) => validBp && (
      (systolic !== null && systolic >= threshold.systolic)
      || (diastolic !== null && diastolic >= threshold.diastolic)
    );
    if (meets(severe) && !bpSafety?.emergency) {
      if (maternal) {
        addFinding('pregnancy_severe_bp', 'DOH_MATERNAL', indicators?.pregnancySevereBpPersistent === true ? 'immediate' : 'prompt',
          indicators?.pregnancySevereBpPersistent === true ? 'immediate_maternal_referral_evaluation' : 'repeat_bp_and_prompt_maternal_evaluation');
      } else {
        addFinding('adult_severe_bp', 'DOH_PRIMARY', 'prompt', 'prompt_bp_referral_evaluation');
      }
    } else if (meets(elevated) && !bpSafety?.emergency) {
      if (maternal) {
        addFinding('pregnancy_elevated_bp', 'DOH_MATERNAL', 'prompt', 'prompt_maternal_referral_evaluation');
      } else {
        addFinding('adult_elevated_bp', 'DOH_PRIMARY', 'routine', 'arrange_bp_follow_up');
      }
    }
  }

  for (const [field, requirement] of Object.entries(ROUTINE_REQUIREMENTS)) {
    if (indicators?.[field] === true) {
      addFinding('routine_care_indicator', 'DOH_PRIMARY', 'routine', requirement, field);
    }
  }

  const referralEvaluationRequired = urgency === 'immediate' || urgency === 'prompt';
  const hasAssessableBp = (maternal || adult) && completeBp && validBp;
  const level = referralEvaluationRequired ? 'High' : urgency === 'routine' ? 'Medium'
    : hasAssessableBp ? 'Low' : null;

  if (!urgency) {
    if (!hasAssessableBp) reasons.push({ ruleId: age !== null && !maternal && !adult ? 'bp_protocol_age_scope_unverified' : 'bp_assessment_incomplete', reference: maternal ? 'DOH_MATERNAL' : 'DOH_PRIMARY' });
    if (level === 'Low') reasons.push({ ruleId: 'no_matching_encounter_risk_rule', reference: maternal ? 'DOH_MATERNAL' : 'DOH_PRIMARY' });
  }

  return {
    level,
    status: level === null ? 'incomplete' : 'assessed',
    reasons,
    referralEvaluationRequired,
    urgency,
    destination: null,
    followUpRequirements: [...followUpRequirements],
    ruleVersion: DEFAULT_CLINICAL_ASSESSMENT_CONFIG.ruleVersion,
    reviewStatus: 'requires_clinical_approval',
  };
}

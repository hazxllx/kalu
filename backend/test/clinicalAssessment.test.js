import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessClinicalEncounter,
  DEFAULT_CLINICAL_ASSESSMENT_CONFIG,
} from '../src/utils/clinicalAssessment.js';

test('pregnancy BP prompts assessment without diagnosing from one reading', () => {
  const indicators = { age: 20, dangerSignsReviewed: true };
  for (const [bp, level, urgency, ruleId] of [
    ['139/89', 'Low', null, 'no_matching_encounter_risk_rule'],
    ['140/89', 'High', 'prompt', 'pregnancy_elevated_bp'],
    ['139/90', 'High', 'prompt', 'pregnancy_elevated_bp'],
    ['159/109', 'High', 'prompt', 'pregnancy_elevated_bp'],
    ['160/109', 'High', 'prompt', 'pregnancy_severe_bp'],
    ['159/110', 'High', 'prompt', 'pregnancy_severe_bp'],
  ]) {
    const result = assessClinicalEncounter({ vitals: { bp }, indicators, pregnancy: {} });
    assert.equal(result.level, level, bp);
    assert.equal(result.urgency, urgency, bp);
    assert.equal(result.referralEvaluationRequired, level === 'High', bp);
    assert.deepEqual(result.reasons, [{ ruleId, reference: 'DOH_MATERNAL' }], bp);
    assert.equal(result.destination, null, bp);
  }
  const partial = assessClinicalEncounter({ vitals: { diastolic: 110 }, pregnancy: {} });
  assert.equal(partial.urgency, null);
  assert.equal(partial.status, 'incomplete');
  assert.equal(assessClinicalEncounter({ vitals: { bp: '160/110' }, pregnancy: {}, indicators: { pregnancySevereBpPersistent: true } }).urgency, 'immediate');
});

test('adult BP uses inclusive OR thresholds within the source guideline age scope and cannot establish emergency alone', () => {
  for (const [bp, level, urgency, ruleId] of [
    ['140/89', 'Medium', 'routine', 'adult_elevated_bp'],
    ['139/90', 'Medium', 'routine', 'adult_elevated_bp'],
    ['179/109', 'Medium', 'routine', 'adult_elevated_bp'],
    ['180/119', 'High', 'prompt', 'adult_severe_bp'],
    ['179/110', 'High', 'prompt', 'adult_severe_bp'],
  ]) {
    const result = assessClinicalEncounter({ vitals: { bp }, indicators: { age: 20 } });
    assert.equal(result.level, level, bp);
    assert.equal(result.urgency, urgency, bp);
    assert.equal(result.referralEvaluationRequired, level === 'High', bp);
    assert.deepEqual(result.reasons, [{ ruleId, reference: 'DOH_PRIMARY' }], bp);
    assert.equal(result.destination, null, bp);
    assert.equal(Object.hasOwn(result, 'diagnosis'), false, bp);
  }
  for (const age of [undefined, 19, 60, true, '20 years']) {
    const result = assessClinicalEncounter({ vitals: { bp: '180/120' }, indicators: { age, dangerSignsReviewed: true } });
    assert.equal(result.level, null);
    assert.equal(result.status, 'incomplete');
  }
});

test('each explicit general and maternal danger sign triggers referral even without vitals or review', () => {
  for (const field of ['severeBreathingDifficulty', 'suspectedStroke', 'severeBleeding', 'alteredConsciousness', 'convulsions']) {
    const result = assessClinicalEncounter({ indicators: { [field]: true } });
    assert.equal(result.level, 'High', field);
    assert.equal(result.urgency, 'immediate', field);
    assert.equal(result.referralEvaluationRequired, true, field);
    assert.equal(result.destination, null, field);
    assert.deepEqual(result.reasons, [{ ruleId: 'general_danger_sign', reference: 'DOH_EMERGENCY', field }]);
  }
  for (const field of ['bleeding', 'severeHeadache', 'visualDisturbance', 'severeAbdominalPain', 'reducedFetalMovement']) {
    const result = assessClinicalEncounter({ pregnancy: { [field]: true } });
    assert.equal(result.level, 'High', field);
    assert.equal(result.referralEvaluationRequired, true, field);
    assert.equal(result.destination, null, field);
    assert.deepEqual(result.reasons, [{ ruleId: 'maternal_danger_sign', reference: 'DOH_MATERNAL', field }]);
  }
});

test('each routine care flag can yield Medium without creating a referral', () => {
  for (const field of ['chronicDisease', 'activeTreatment', 'moderateSymptoms', 'followUpRequired', 'additionalTesting', 'ncdScreeningPositive']) {
    const result = assessClinicalEncounter({ indicators: { [field]: true } });
    assert.equal(result.level, 'Medium', field);
    assert.equal(result.urgency, 'routine', field);
    assert.equal(result.referralEvaluationRequired, false, field);
    assert.equal(result.destination, null, field);
    assert.equal(result.followUpRequirements.length, 1, field);
    assert.deepEqual(result.reasons, [{ ruleId: 'routine_care_indicator', reference: 'DOH_PRIMARY', field }]);
  }
});

test('the strongest finding sets urgency without dropping routine follow-up requirements', () => {
  const result = assessClinicalEncounter({
    vitals: { bp: '181/120' },
    indicators: { age: 18, convulsions: true, followUpRequired: true },
  });
  assert.equal(result.level, 'High');
  assert.equal(result.urgency, 'immediate');
  assert.deepEqual(result.followUpRequirements, [
    'immediate_referral_evaluation', 'immediate_emergency_evaluation', 'arrange_follow_up',
  ]);
});

test('shared BP safety requires complete plausible readings and escalates symptoms without a repeat delay', () => {
  for (const vitals of [{ bp: '301/120' }, { bp: '190/201' }, { bp: '180/10' }, { systolic: 190 },
    { systolic: true, diastolic: 80 }, { bp: '999/99' }, { bp: '90/90' }]) {
    const result = assessClinicalEncounter({ vitals, indicators: { age: 30, dangerSignsReviewed: true } });
    assert.equal(result.level, null, JSON.stringify(vitals));
    assert.equal(result.urgency, null, JSON.stringify(vitals));
  }
  for (const bp of ['181/80', '160/121']) {
    const severe = assessClinicalEncounter({ vitals: { bp } });
    assert.equal(severe.urgency, 'prompt');
    assert.ok(severe.reasons.some(({ ruleId }) => ruleId === 'bp_severe'));
    const emergency = assessClinicalEncounter({ vitals: { bp }, pregnancy: {}, indicators: { chestPain: true } });
    assert.equal(emergency.urgency, 'immediate');
    assert.ok(emergency.followUpRequirements.includes('immediate_emergency_evaluation'));
    assert.ok(!emergency.followUpRequirements.some((requirement) => requirement.includes('repeat')));
  }
});

test('no flags is incomplete without explicit review and assessable BP, not a negative clinical finding', () => {
  const vitals = { bp: '120/80' };
  assert.equal(assessClinicalEncounter().status, 'incomplete');
  for (const dangerSignsReviewed of [undefined, false, 'true', 1]) {
    const result = assessClinicalEncounter({ vitals, indicators: { age: 30, dangerSignsReviewed } });
    assert.equal(result.level, null);
    assert.equal(result.status, 'incomplete');
    assert.equal(result.referralEvaluationRequired, false);
    assert.equal(result.urgency, null);
    assert.deepEqual(result.reasons, [{ ruleId: 'danger_sign_review_missing', reference: 'DOH_EMERGENCY' }]);
  }
  const reviewedAdult = { age: 30, dangerSignsReviewed: true };
  for (const vitals of [{}, { systolic: 120 }, { bp: 'invalid' }, { bp: '80/120' }]) {
    const result = assessClinicalEncounter({ vitals, indicators: reviewedAdult });
    assert.equal(result.level, null);
    assert.equal(result.status, 'incomplete');
    assert.deepEqual(result.reasons, [{ ruleId: 'bp_assessment_incomplete', reference: 'DOH_PRIMARY' }]);
  }
  const result = assessClinicalEncounter({
    vitals,
    indicators: { ...reviewedAdult, suspectedStroke: 'true', chronicDisease: 1, bleeding: true },
  });
  assert.deepEqual(result, {
    level: 'Low',
    status: 'assessed',
    reasons: [{ ruleId: 'no_matching_encounter_risk_rule', reference: 'DOH_PRIMARY' }],
    referralEvaluationRequired: false,
    urgency: null,
    destination: null,
    followUpRequirements: [],
    ruleVersion: DEFAULT_CLINICAL_ASSESSMENT_CONFIG.ruleVersion,
    reviewStatus: 'requires_clinical_approval',
  });
  assert.equal(assessClinicalEncounter({ vitals, indicators: reviewedAdult, pregnancy: { bleeding: 'true' } }).level, 'Low');
});

test('numeric overrides are validated and neither inputs nor defaults are mutated', () => {
  const config = Object.freeze({
    thresholds: Object.freeze({ adultSevere: Object.freeze({ systolic: 170, diastolic: '100' }) }),
  });
  const indicators = Object.freeze({ age: 30, dangerSignsReviewed: true });
  const encounter = Object.freeze({ vitals: Object.freeze({ systolic: 170, diastolic: 100 }), indicators, config });
  assert.equal(assessClinicalEncounter(encounter).level, 'High');
  assert.equal(assessClinicalEncounter({ vitals: { bp: '169/109' }, indicators, config }).level, 'Medium');
  assert.equal(assessClinicalEncounter({ ...encounter, config: {} }).level, 'Medium');
  assert.equal(DEFAULT_CLINICAL_ASSESSMENT_CONFIG.thresholds.adultSevere.systolic, 180);
  for (const systolic of [null, true, NaN, Infinity, 0, -1, 139]) {
    const config = { thresholds: { adultSevere: { systolic } } };
    assert.equal(assessClinicalEncounter({ ...encounter, config }).level, 'Medium');
  }
});

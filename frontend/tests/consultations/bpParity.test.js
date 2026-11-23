import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyBloodPressure as frontend, parseBloodPressure } from '../../src/features/consultations/utils/bpClassification.js';
import { classifyBloodPressure as backend } from '../../../backend/src/config/bpThresholds.js';
import { classifyWithConfig, getBpConfig, updateThresholds } from '../../../backend/src/services/bpConfig.service.js';
import { DEFAULT_BP_THRESHOLDS } from '../../../shared/bloodPressure.js';

const examples = [
  ['110/70', 'Normal Blood Pressure'], ['119/79', 'Normal Blood Pressure'], ['120/75', 'Elevated Blood Pressure'],
  ['125/79', 'Elevated Blood Pressure'], ['129/79', 'Elevated Blood Pressure'], ['120/80', 'Stage 1 Hypertension'],
  ['120/89', 'Stage 1 Hypertension'], ['130/75', 'Stage 1 Hypertension'],
  ['125/85', 'Stage 1 Hypertension'], ['130/80', 'Stage 1 Hypertension'], ['135/85', 'Stage 1 Hypertension'], ['139/89', 'Stage 1 Hypertension'],
  ['140/80', 'Stage 2 Hypertension'], ['130/90', 'Stage 2 Hypertension'],
  ['140/85', 'Stage 2 Hypertension'], ['135/90', 'Stage 2 Hypertension'], ['150/95', 'Stage 2 Hypertension'], ['180/100', 'Hypertensive Urgency or Emergency'],
  ['130/120', 'Hypertensive Urgency or Emergency'], ['181/80', 'Hypertensive Urgency or Emergency'], ['150/120', 'Hypertensive Urgency or Emergency'],
  ['185/125', 'Hypertensive Urgency or Emergency'], ['85/65', 'Normal Blood Pressure'], ['125/55', 'Elevated Blood Pressure'],
];

test('the configuration API reports effective clinical rules and rejects conflicting settings', async () => {
  const repo = { getBpThresholdSettings: async () => ({ stage1DiastolicMin: 90, labels: { stage1: 'Wrong label' } }),
    saveBpThresholdSettings: async () => assert.fail('Conflicting thresholds must not be saved') };
  const config = await getBpConfig({ repo });
  assert.deepEqual(config.thresholds, DEFAULT_BP_THRESHOLDS);
  assert.equal(config.categories.find(({ code }) => code === 'stage1').label, 'Stage 1 Hypertension');
  assert.equal(config.categories.length, 5);
  assert.equal(config.categories.find(({ code }) => code === 'normal').label, 'Normal Blood Pressure');
  assert.equal(config.categories.find(({ code }) => code === 'elevated').label, 'Elevated Blood Pressure');
  assert.equal(config.categories.find(({ code }) => code === 'crisis').label, 'Hypertensive Urgency or Emergency');
  await assert.rejects(updateThresholds({ user: { role: 'admin' }, repo,
    payload: { ...DEFAULT_BP_THRESHOLDS, stage2SystolicMin: 135 } }), { statusCode: 422 });
});
for (const [reading, category] of examples) {
  test(`${reading} is ${category} in frontend and backend`, async () => {
    const expected = backend(reading);
    assert.equal(expected.category, category);
    const { badgeClassName, ...actual } = frontend(reading);
    assert.ok(badgeClassName);
    assert.deepEqual(actual, expected);
    assert.deepEqual(await classifyWithConfig(reading, { repo: { getBpThresholdSettings: async () => ({ stage1DiastolicMin: 90 }) } }), expected);
  });
}

test('all systolic/diastolic threshold crossings select the higher category', () => {
  for (const systolic of [110, 119, 120, 129, 130, 139, 140, 180, 181, 250]) {
    for (const diastolic of [20, 59, 70, 79, 80, 89, 90, 119, 120, 121, 200]) {
      if (systolic <= diastolic) continue;
      const expected = systolic >= 180 || diastolic >= 120 ? 'crisis'
        : systolic >= 140 || diastolic >= 90 ? 'stage2'
          : systolic >= 130 || diastolic >= 80 ? 'stage1'
            : systolic >= 120 ? 'elevated' : 'normal';
      assert.equal(frontend(`${systolic}/${diastolic}`).code, expected);
      assert.equal(backend({ systolic, diastolic }).code, expected);
    }
  }
});

test('emergency symptoms promote only severe readings and require immediate evaluation', () => {
  for (const findings of ['Chest pain', 'Shortness of breath', 'Back pain', 'Numbness or weakness',
    'Changes in vision', 'Difficulty speaking', 'New acute chest pressure', 'Slurred speech', 'Seizure']) {
    const context = { findings };
    const result = frontend('185/125', context);
    assert.equal(result.category, 'Hypertensive Urgency or Emergency', findings);
    assert.equal(result.emergency, true);
    assert.equal(result.urgency, 'immediate');
    assert.match(result.message, /immediate clinical assessment/i);
    assert.equal(backend('150/121', context).emergency, true);
    assert.equal(frontend('180/120', context).category, 'Hypertensive Urgency or Emergency');
  }
});

test('negated, historical, hypothetical symptoms do not establish emergency', () => {
  for (const findings of ['', 'No chest pain', 'Denies chest pain and shortness of breath',
    'No chest pain or back pain', 'History of chest pain', 'Family history of stroke',
    'If chest pain occurs, seek care', 'Chest pain absent', 'Back pain resolved']) {
    const result = frontend('185/125', { findings });
    assert.equal(result.category, 'Hypertensive Urgency or Emergency', findings);
    assert.equal(result.emergency, false);
    assert.equal(result.urgency, 'immediate');
  }
  assert.equal(frontend('185/125', { findings: 'No chest pain but reports shortness of breath' }).emergency, true);
  assert.equal(frontend('185/125', { findings: 'Denies chest pain, reports back pain' }).emergency, true);
});

test('structured symptom flags require true and a valid complete reading', () => {
  assert.equal(frontend('185/125', { indicators: { acuteCardiovascularSymptoms: true } }).emergency, true);
  assert.equal(frontend('185/125', { symptoms: { chestPain: 'false' } }).emergency, false);
  for (const reading of ['', '120', '120/', '/80', '120/80junk', '1e2/80', '-120/80',
    '120.5/80', '301/80', '120/201', '39/20', '120/19', '80/120', '120/120',
    {}, [], { systolic: null, diastolic: 80 }, { systolic: true, diastolic: 20 },
    { systolic: '', diastolic: 80 }, { systolic: 120.5, diastolic: 80 },
    { systolic: Infinity, diastolic: 80 }, { systolic: 500, diastolic: 80 }]) {
    assert.equal(frontend(reading, { chestPain: true }), null, JSON.stringify(reading));
    assert.equal(backend(reading), null);
  }
  assert.deepEqual(parseBloodPressure('40/20'), { systolic: 40, diastolic: 20 });
  assert.deepEqual(parseBloodPressure('300/200'), { systolic: 300, diastolic: 200 });
});

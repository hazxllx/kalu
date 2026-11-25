import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyBloodPressure,
  parseBloodPressure,
  validateThresholdPayload,
  DEFAULT_BP_THRESHOLDS,
} from '../src/config/bpThresholds.js';

test('normal reading is classified Normal', () => {
  const r = classifyBloodPressure('118/76');
  assert.equal(r.code, 'normal');
  assert.equal(r.systolic, 118);
  assert.equal(r.diastolic, 76);
});

test('configured Normal includes 120/80; Elevated starts at 121 systolic with diastolic through 80', () => {
  assert.equal(classifyBloodPressure('125/78').code, 'elevated');
  assert.equal(classifyBloodPressure('125/80').code, 'elevated');
  assert.equal(classifyBloodPressure('120/80').code, 'normal');
  // Diastolic 81 and above enters Stage 1 unless a higher category applies.
  assert.equal(classifyBloodPressure('125/81').code, 'stage1');
});

test('stage 1 by systolic OR diastolic', () => {
  assert.equal(classifyBloodPressure('135/70').code, 'stage1');
  assert.equal(classifyBloodPressure('118/85').code, 'stage1');
});

test('stage 2 by systolic OR diastolic', () => {
  assert.equal(classifyBloodPressure('145/95').code, 'stage2');
  assert.equal(classifyBloodPressure('150/70').code, 'stage2');
});

test('severe range requires emergency symptoms to flag emergency', () => {
  const r = classifyBloodPressure('190/100');
  assert.equal(r.code, 'crisis');
  assert.equal(r.emergency, false);
  assert.equal(classifyBloodPressure('190/100', { chestPain: true }).emergency, true);
  assert.equal(classifyBloodPressure('160/125').code, 'crisis');
});

test('low readings stay separately flagged while 120/80 follows the configured Normal boundary', () => {
  assert.equal(classifyBloodPressure('85/55').code, 'normal');
  assert.equal(classifyBloodPressure('120/80').code, 'normal');
  // A valid reading whose diastolic is in the crisis range is crisis, not low.
  assert.equal(classifyBloodPressure('130/125').code, 'crisis');
});

test('more severe category wins when systolic and diastolic differ', () => {
  // systolic normal, diastolic stage 2 -> stage 2
  assert.equal(classifyBloodPressure('118/92').code, 'stage2');
});

test('all requested consultation examples use the exact five classification labels', () => {
  const examples = [
    ['110/70', 'Normal Blood Pressure'],
    ['120/75', 'Normal Blood Pressure'],
    ['120/80', 'Normal Blood Pressure'],
    ['121/80', 'Elevated Blood Pressure'],
    ['120/81', 'Stage 1 Hypertension'],
    ['125/85', 'Stage 1 Hypertension'],
    ['130/80', 'Stage 1 Hypertension'],
    ['140/85', 'Stage 2 Hypertension'],
    ['135/90', 'Stage 2 Hypertension'],
    ['180/100', 'Hypertensive Urgency or Emergency'],
    ['150/120', 'Hypertensive Urgency or Emergency'],
  ];
  for (const [reading, expected] of examples) {
    assert.equal(classifyBloodPressure(reading).category, expected, reading);
  }
});

test('empty / incomplete / malformed / implausible readings are never Normal', () => {
  for (const bad of ['', '   ', '120', '120/', '/80', 'abc', '12/8', '400/90', '120/400', '80/120', '-120/80']) {
    assert.equal(classifyBloodPressure(bad), null, `expected null for "${bad}"`);
  }
});

test('parseBloodPressure rejects systolic <= diastolic and out-of-range values', () => {
  assert.equal(parseBloodPressure('80/80'), null);
  assert.equal(parseBloodPressure('80/90'), null);
  assert.deepEqual(parseBloodPressure('120/80'), { systolic: 120, diastolic: 80 });
});

test('configured thresholds change categories without changing OR-based severity rules', () => {
  const configured = { ...DEFAULT_BP_THRESHOLDS, stage2SystolicMin: 135 };
  const result = classifyBloodPressure('136/70', configured);
  assert.equal(result.code, 'stage2');
  assert.equal(result.source, 'configured');
  assert.equal(classifyBloodPressure('130/95', configured).code, 'stage2');
});

test('configured category labels remain the supported screening labels', () => {
  const r = classifyBloodPressure('145/95');
  assert.equal(r.code, 'stage2');
  assert.equal(r.label, 'Stage 2 Hypertension');
});

test('validateThresholdPayload rejects non-increasing systolic cut-offs', () => {
  const bad = { ...DEFAULT_BP_THRESHOLDS, stage2SystolicMin: 125 }; // below stage1 (130)
  const { errors, thresholds } = validateThresholdPayload(bad);
  assert.ok(errors.length > 0);
  assert.equal(thresholds, null);
});

test('validateThresholdPayload accepts a well-ordered configuration', () => {
  const { errors, thresholds } = validateThresholdPayload(DEFAULT_BP_THRESHOLDS);
  assert.deepEqual(errors, []);
  assert.equal(thresholds.stage2SystolicMin, 140);
});

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

test('elevated requires systolic 120-129 AND diastolic below 80', () => {
  assert.equal(classifyBloodPressure('125/78').code, 'elevated');
  // diastolic 85 pushes it to stage 1 (diastolic 80-89)
  assert.equal(classifyBloodPressure('125/85').code, 'stage1');
});

test('stage 1 by systolic OR diastolic', () => {
  assert.equal(classifyBloodPressure('135/70').code, 'stage1');
  assert.equal(classifyBloodPressure('118/85').code, 'stage1');
});

test('stage 2 by systolic OR diastolic', () => {
  assert.equal(classifyBloodPressure('145/95').code, 'stage2');
  assert.equal(classifyBloodPressure('150/70').code, 'stage2');
});

test('crisis range (above 180 OR above 120) and flagged as emergency', () => {
  const r = classifyBloodPressure('190/100');
  assert.equal(r.code, 'crisis');
  assert.equal(r.emergency, true);
  assert.equal(classifyBloodPressure('160/125').code, 'crisis');
});

test('low (hypotension) below 90/60, unless a more urgent category applies', () => {
  assert.equal(classifyBloodPressure('85/55').code, 'low');
  // A valid reading whose diastolic is in the crisis range is crisis, not low.
  assert.equal(classifyBloodPressure('130/125').code, 'crisis');
});

test('more severe category wins when systolic and diastolic differ', () => {
  // systolic normal, diastolic stage 2 -> stage 2
  assert.equal(classifyBloodPressure('118/92').code, 'stage2');
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

test('admin-configured thresholds override the defaults', () => {
  // Lower the stage-2 systolic cut-off to 135; a 136/70 reading becomes Stage 2
  // where the defaults would call it Stage 1.
  const configured = { ...DEFAULT_BP_THRESHOLDS, stage2SystolicMin: 135 };
  assert.equal(classifyBloodPressure('136/70').code, 'stage1');
  assert.equal(classifyBloodPressure('136/70', configured).code, 'stage2');
  assert.equal(classifyBloodPressure('136/70', configured).source, 'configured');
});

test('configured label overrides are applied', () => {
  const r = classifyBloodPressure('145/95', DEFAULT_BP_THRESHOLDS, { stage2: 'Severe HTN' });
  assert.equal(r.code, 'stage2');
  assert.equal(r.label, 'Severe HTN');
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

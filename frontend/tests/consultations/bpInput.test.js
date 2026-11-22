import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBloodPressureInput, parseBloodPressure } from '../../src/features/consultations/utils/bpClassification.js';

test('compact readings format when typed or pasted', () => {
  assert.deepEqual(formatBloodPressureInput('1208', 4, 4, 'insertText'), { value: '120/8', caret: 5 });
  assert.deepEqual(formatBloodPressureInput('12080', 5, 5, 'insertFromPaste'), { value: '120/80', caret: 6 });
  assert.deepEqual(formatBloodPressureInput('1208', 4, 4, 'insertFromPaste'), { value: '120/8', caret: 5 });
  assert.deepEqual(formatBloodPressureInput('9080', 4, 4, 'insertText'), { value: '90/80', caret: 5 });
  assert.deepEqual(formatBloodPressureInput('9060', 4, 4, 'insertFromPaste'), { value: '90/60', caret: 5 });
});

test('editing and deletion do not reinsert the separator or move the caret', () => {
  assert.equal(formatBloodPressureInput('12080', 3, 3, 'deleteContentBackward'), null);
  assert.equal(formatBloodPressureInput('12080', 2, 2, 'insertText'), null);
  assert.equal(formatBloodPressureInput('120/8', 5, 5, 'insertText'), null);
  for (const value of ['120/', '120/8', 'abc', '12080', '80/120', '']) assert.equal(parseBloodPressure(value), null);
  assert.deepEqual(parseBloodPressure('120/80'), { systolic: 120, diastolic: 80 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasRecordedMaternalValue,
  maternalScreeningValue,
  recordedMaternalRows,
} from '../../src/features/health-records/lib/maternalDisplay.js';

test('maternal overview filters missing and legacy placeholder values but preserves recorded zero and false', () => {
  assert.deepEqual(recordedMaternalRows([
    ['Null', null],
    ['Undefined', undefined],
    ['Empty', '  '],
    ['Legacy placeholder', 'Not recorded'],
    ['Result placeholder', 'Result not recorded'],
    ['Dash', '—'],
    ['Zero', 0],
    ['No', false],
    ['Recorded date', '2026-03-01'],
  ]), [
    ['Zero', 0],
    ['No', false],
    ['Recorded date', '2026-03-01'],
  ]);
  assert.equal(hasRecordedMaternalValue(''), false);
});

test('screening display includes whichever actual date or result is available', () => {
  assert.equal(maternalScreeningValue('2026-03-01', ''), '2026-03-01');
  assert.equal(maternalScreeningValue('', '-'), '-');
  assert.equal(maternalScreeningValue('2026-03-01', '+'), '2026-03-01 · +');
  assert.equal(maternalScreeningValue(null, null), '');
});

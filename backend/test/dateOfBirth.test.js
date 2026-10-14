import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDateOnly, isFutureDateOnly, ageFromDateOnly } from '../src/validators/common.js';

// Helpers shared with the frontend suite: same documented year range 0..120,
// same YYYY-MM-DD UTC calendar rules, same no-timezone-shift behaviour.

test('accepts a valid past DOB and computes age', () => {
  assert.ok(parseDateOnly('2000-09-02') instanceof Date);
  assert.match(String(ageFromDateOnly('2000-09-02')), /^\d+$/);
});

test('rejects a five-digit year (09/02/20000 → 20000-09-02)', () => {
  assert.equal(parseDateOnly('20000-09-02'), null);
});

test('rejects five-digit year slash form 09/02/20000', () => {
  // Slash format is not an accepted DOB payload shape (residents.service expects YYYY-MM-DD).
  assert.equal(parseDateOnly('09/02/20000'), null);
});

test('rejects incomplete dates', () => {
  for (const value of ['2000-09', '2000', '2000-9-2', '00-09-02', '2000/09/02']) {
    assert.equal(parseDateOnly(value), null, `expected null for ${value}`);
  }
});

test('rejects impossible calendar dates and rollovers', () => {
  for (const value of ['2000-02-30', '2000-13-01', '2000-00-10', '2000-04-31', '1999-02-29']) {
    assert.equal(parseDateOnly(value), null, `expected null for ${value}`);
  }
});

test('accepts leap-year Feb 29, rejects non-leap Feb 29', () => {
  assert.ok(parseDateOnly('2000-02-29') instanceof Date);
  assert.equal(parseDateOnly('1900-02-29'), null);
});

test('future date detection (far future is always future)', () => {
  assert.equal(isFutureDateOnly('3026-01-01'), true);
  assert.equal(isFutureDateOnly('1900-01-01'), false);
});

test('future date detection respects UTC day boundary (tomorrow is future)', () => {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const iso = tomorrow.toISOString().slice(0, 10);
  assert.equal(isFutureDateOnly(iso), true);
});

test('age range: 121-year-old is out of the documented 0..120 range', () => {
  const veryOld = new Date();
  veryOld.setUTCFullYear(veryOld.getUTCFullYear() - 121);
  const iso = veryOld.toISOString().slice(0, 10);
  const age = ageFromDateOnly(iso);
  assert.ok(age !== null && age > 120, `expected age > 120 for ${iso}, got ${age}`);
});

test('parseDateOnly trims then validates; five-digit year still rejected after trim', () => {
  // The validators normalize via text() (trim) before applying DATE_ONLY_PATTERN,
  // so surrounding whitespace is tolerated but the 4-digit year rule is not.
  assert.ok(parseDateOnly(' 2000-09-02 ') instanceof Date);
  assert.equal(parseDateOnly('20000-09-02 '), null);
  // Exact YYYY-MM-DD without whitespace is the canonical payload shape.
  assert.ok(parseDateOnly('2000-09-02') instanceof Date);
});

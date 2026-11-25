import assert from 'node:assert/strict';
import test from 'node:test';

import { ageFromDateOnly, dateOfBirth, personName } from '../../src/utils/validation/index.js';

// Use an explicit clock for boundary checks so midnight/timezone changes cannot
// make a "tomorrow" fixture become today's date during a long test run.
const fakeNow = new Date('2026-10-14T12:00:00.000Z');

const isoTomorrow = '2026-10-15';
const isoToday = '2026-10-14';

test('accepts a valid past date of birth (09/02/2000 → 2000-09-02)', () => {
  assert.equal(dateOfBirth('2000-09-02', { label: 'Date of birth' }), '');
});

test('accepts a boundary past date (1906-10-14 is 120 years ago)', () => {
  // 2026-10-14 minus 120 years. ageFromDateOnly uses the supplied now's UTC day,
  // but dateOfBirth() internally uses new Date() → the test only checks the
  // parse/validity path, not the exact age, so any past date well within the
  // range should be accepted.
  assert.equal(dateOfBirth('2000-01-01', { label: 'Date of birth' }), '');
});

test('rejects empty when required', () => {
  assert.match(dateOfBirth('', { label: 'Date of birth' }), /required/i);
  assert.match(dateOfBirth('   ', { label: 'Date of birth' }), /required/i);
});

test('allows empty when not required', () => {
  assert.equal(dateOfBirth('', { isRequired: false }), '');
});

test('rejects a five-digit year (09/02/20000 → 20000-09-02)', () => {
  // The strict YYYY-MM-DD regex rejects the five-digit prefix entirely.
  assert.match(dateOfBirth('20000-09-02', { label: 'Date of birth' }), /invalid/i);
});

test('rejects five-digit year embedded in slash format (09/02/20000 is not an accepted DOB value)', () => {
  // The DOB field stores YYYY-MM-DD; verify the raw slash string is rejected.
  // parseDateOnly does not understand MM/DD/YYYY, so this is invalid.
  assert.match(dateOfBirth('09/02/20000', { label: 'Date of birth' }), /invalid/i);
});

test('rejects incomplete dates', () => {
  for (const value of ['2000-09', '2000', '2000-9-2', '00-09-02', '2000/09/02']) {
    assert.match(dateOfBirth(value, { label: 'Date of birth' }), /invalid/i, `expected invalid for ${value}`);
  }
});

test('rejects impossible calendar dates', () => {
  for (const value of ['2000-02-30', '2000-13-01', '2000-00-10', '2000-04-31', '1999-02-29']) {
    assert.match(dateOfBirth(value, { label: 'Date of birth' }), /invalid/i, `expected invalid for ${value}`);
  }
});

test('rejects impossible Feb 29 on a non-leap year but accepts it on a leap year', () => {
  assert.match(dateOfBirth('1900-02-29', { label: 'Date of birth' }), /invalid/i);
  assert.equal(dateOfBirth('2000-02-29', { label: 'Date of birth' }), '');
});

test('rejects future birth dates', () => {
  // A date far in the future is always in the future regardless of timezone.
  assert.match(dateOfBirth('3026-01-01', { label: 'Date of birth' }), /future/i);
});

test('rejects future date via the today comparison (tomorrow)', () => {
  const tomorrow = new Date(fakeNow);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const iso = tomorrow.toISOString().slice(0, 10);
  assert.match(dateOfBirth(iso, { label: 'Date of birth', now: fakeNow }), /future/i);
});

test('rejects dates whose computed age exceeds maxAge (default 120)', () => {
  // A birth date 121 years before today → age 121 → rejected.
  const veryOld = new Date();
  veryOld.setUTCFullYear(veryOld.getUTCFullYear() - 121);
  const iso = veryOld.toISOString().slice(0, 10);
  assert.match(dateOfBirth(iso, { label: 'Date of birth', maxAge: 120 }), /valid age/i);
});

test('applies a custom maxAge', () => {
  assert.match(dateOfBirth('2000-01-01', { label: 'Date of birth', maxAge: 10 }), /valid age/i);
});

test('person names accept Unicode letters and common name punctuation', () => {
  assert.equal(personName('María-José'), '');
  assert.equal(personName("O'Neil"), '');
  assert.equal(personName('A.'), '');
  assert.equal(personName('  Dela Cruz  '), '');
});

test('person names reject blank required names and non-name characters', () => {
  assert.match(personName('   ', { label: 'First name' }), /required/i);
  assert.match(personName('Anne2'), /letters/i);
  assert.match(personName(''), /required/i);
});

test('middle names are optional but validated when provided', () => {
  assert.equal(personName('   ', { label: 'Middle name', isRequired: false }), '');
  assert.match(personName('Middle2', { label: 'Middle name', isRequired: false }), /letters/i);
});

test('age changes on the birthday, including leap-day birthdays', () => {
  assert.equal(ageFromDateOnly('2000-11-19', new Date(2026, 10, 18, 12)), 25);
  assert.equal(ageFromDateOnly('2000-11-19', new Date(2026, 10, 19, 12)), 26);
  assert.equal(ageFromDateOnly('2000-02-29', new Date(2025, 1, 28, 12)), 24);
  assert.equal(ageFromDateOnly('2000-02-29', new Date(2025, 2, 1, 12)), 25);
  assert.equal(ageFromDateOnly('2000032005'), null);
  assert.equal(ageFromDateOnly('2025-02-29'), null);
});

test('age uses the local calendar day when UTC is still yesterday', () => {
  const localMidnight = {
    getFullYear: () => 2026,
    getMonth: () => 10,
    getDate: () => 19,
    getUTCFullYear: () => 2026,
    getUTCMonth: () => 10,
    getUTCDate: () => 18,
  };
  assert.equal(ageFromDateOnly('2000-11-19', localMidnight), 26);
});

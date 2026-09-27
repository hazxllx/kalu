import test from 'node:test';
import assert from 'node:assert/strict';

import { registerResidentValidator } from '../src/validators/registration.validators.js';
import { isStrictMobile, toZone, isZone } from '../src/validators/common.js';

/**
 * Registration mobile-number + Zone validation (server-authoritative).
 *
 * Mobile: EXACTLY 11 numeric digits, no separators/letters/+63 (e.g.
 * 09381829120). Zone: a controlled value 1..8. The frontend mirrors these but
 * the server is the source of truth — these tests pin the exact accept/reject
 * behaviour required by the KALUSAGAP registration spec.
 */

const base = () => ({
  firstName: 'Juan',
  lastName: 'Dela Cruz',
  birthDate: '1990-05-04',
  sex: 'Male',
  civilStatus: 'Single',
  cellphoneNo: '09381829120',
  barangay: 'San Isidro',
  currentAddress: 'Zone 1, San Isidro',
  zone: '1',
});

test('isStrictMobile accepts exactly 11 digits starting 09', () => {
  assert.equal(isStrictMobile('09381829120'), true);
});

test('isStrictMobile rejects wrong length, letters and separators', () => {
  assert.equal(isStrictMobile('0938182912'), false); // 10 digits
  assert.equal(isStrictMobile('093818291200'), false); // 12 digits
  assert.equal(isStrictMobile('0938ABC9120'), false); // letters
  assert.equal(isStrictMobile('0938-182-9120'), false); // dashes
  assert.equal(isStrictMobile('0938 182 9120'), false); // spaces
  assert.equal(isStrictMobile('+639381829120'), false); // +63 prefix
});

test('valid registration passes and preserves the leading zero + zone', () => {
  const { value, error } = registerResidentValidator(base());
  assert.equal(error, undefined);
  assert.equal(value.resident.cellphoneNo, '09381829120');
  assert.equal(value.resident.zone, 1);
});

test('registration rejects a 10-digit mobile', () => {
  const { error } = registerResidentValidator({ ...base(), cellphoneNo: '0938182912' });
  assert.ok(error && error.cellphoneNo);
});

test('registration rejects a 12-digit mobile', () => {
  const { error } = registerResidentValidator({ ...base(), cellphoneNo: '093818291200' });
  assert.ok(error && error.cellphoneNo);
});

test('registration rejects mobile with letters', () => {
  const { error } = registerResidentValidator({ ...base(), cellphoneNo: '0938ABC9120' });
  assert.ok(error && error.cellphoneNo);
});

test('registration rejects mobile with dashes or spaces', () => {
  assert.ok(registerResidentValidator({ ...base(), cellphoneNo: '0938-182-9120' }).error?.cellphoneNo);
  assert.ok(registerResidentValidator({ ...base(), cellphoneNo: '0938 182 9120' }).error?.cellphoneNo);
});

test('toZone parses 1..8 and rejects everything else', () => {
  assert.equal(toZone('1'), 1);
  assert.equal(toZone(8), 8);
  assert.equal(toZone('Zone 3'), 3); // tolerates a "Zone " prefix
  assert.equal(toZone('9'), null);
  assert.equal(toZone('0'), null);
  assert.equal(toZone('A'), null);
  assert.equal(toZone('Purok 3'), null);
  assert.equal(toZone(''), null);
  assert.equal(isZone('8'), true);
  assert.equal(isZone('9'), false);
});

test('registration accepts Zone 8 and rejects Zone 9 / 0 / A', () => {
  assert.equal(registerResidentValidator({ ...base(), zone: '8' }).error, undefined);
  assert.ok(registerResidentValidator({ ...base(), zone: '9' }).error?.zone);
  assert.ok(registerResidentValidator({ ...base(), zone: '0' }).error?.zone);
  assert.ok(registerResidentValidator({ ...base(), zone: 'A' }).error?.zone);
});

test('registration requires a zone', () => {
  const { error } = registerResidentValidator({ ...base(), zone: '' });
  assert.ok(error && error.zone);
});

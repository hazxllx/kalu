// Regression tests for the consultation integration fixes.
//
// Covers two repaired issues, using the REAL exported service functions with an
// injected in-memory repository stub (no database, no network):
//
//   1. Verified-residents-only eligibility. A consultation may only be recorded
//      for a resident who is individually `approved` OR a member of a verified
//      household in scope — exactly the "verified directory" the resident
//      selector is populated from. Pending/unverified residents are refused, and
//      a household-lookup failure must fail CLOSED (not silently allow).
//
//   2. `visits.bmi_category` is NOT NULL (default ''). A consultation saved
//      without both height and weight must store '' — never null — or the insert
//      fails with a NOT-NULL violation.
//
// Run: node --test test/consultationEligibility.test.js

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isResidentConsultationEligible,
  toVisit,
} from '../src/services/consultations.service.js';

const user = { id: 'u1', role: 'health_supervisor', name: 'HS One' };

// A repo stub whose verified-household set is configurable per test.
const repoWith = (ids = [], { throws = false } = {}) => ({
  verifiedHouseholdResidentIds: async () => {
    if (throws) throw new Error('household lookup failed');
    return ids;
  },
});

test('eligibility: an individually approved resident is eligible', async () => {
  const resident = { id: 'r1', verificationStatus: 'approved', barangay: 'San Isidro' };
  assert.equal(await isResidentConsultationEligible(resident, repoWith([])), true);
});

test('eligibility: approval check is case-insensitive', async () => {
  const resident = { id: 'r1', verificationStatus: 'APPROVED' };
  assert.equal(await isResidentConsultationEligible(resident, repoWith([])), true);
});

test('eligibility: a pending resident NOT in a verified household is refused', async () => {
  const resident = { id: 'r1', verificationStatus: 'pending', barangay: 'San Isidro' };
  assert.equal(await isResidentConsultationEligible(resident, repoWith([])), false);
});

test('eligibility: a pending resident who is a verified-household member is eligible', async () => {
  const resident = { id: 'r1', verificationStatus: 'pending', barangay: 'San Isidro', municipalityId: 'm1' };
  assert.equal(await isResidentConsultationEligible(resident, repoWith(['r1'])), true);
});

test('eligibility: rejected / resubmission_required / unverified are all refused', async () => {
  for (const status of ['rejected', 'resubmission_required', '', 'unverified', null, undefined]) {
    const resident = { id: 'r1', verificationStatus: status };
    assert.equal(
      await isResidentConsultationEligible(resident, repoWith([])),
      false,
      `status "${String(status)}" must not be eligible`,
    );
  }
});

test('eligibility: a household-lookup failure fails CLOSED (not eligible)', async () => {
  const resident = { id: 'r1', verificationStatus: 'pending', barangay: 'San Isidro' };
  assert.equal(await isResidentConsultationEligible(resident, repoWith([], { throws: true })), false);
});

test('eligibility: a null/absent resident is never eligible', async () => {
  assert.equal(await isResidentConsultationEligible(null, repoWith(['r1'])), false);
  assert.equal(await isResidentConsultationEligible(undefined, repoWith(['r1'])), false);
});

test('toVisit: a consultation without height/weight stores bmiCategory "" (never null)', () => {
  const visit = toVisit({ consultationDate: '2026-01-02', chiefComplaint: 'Cough' }, user, 'r1');
  assert.equal(visit.vitals.bmiCategory, '', 'NOT-NULL column must receive "" not null');
  assert.notEqual(visit.vitals.bmiCategory, null);
  assert.equal(visit.vitals.bmi, null, 'bmi itself is nullable and null when inputs are absent');
});

test('toVisit: a consultation with height/weight stores a real BMI category', () => {
  const visit = toVisit(
    { consultationDate: '2026-01-02', height: 170, weight: 65 },
    user,
    'r1',
  );
  assert.equal(typeof visit.vitals.bmi, 'number');
  assert.equal(visit.vitals.bmiCategory, 'Normal');
});

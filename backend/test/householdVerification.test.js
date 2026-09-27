import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import repository from '../src/repositories/index.js';
import * as service from '../src/services/households.service.js';

/**
 * Household verification service tests.
 *
 * Focused on the Health-Supervisor verification path: the reviewer identity and
 * timestamp are always derived from the authenticated session (never the client
 * body), a "Returned for Correction" outcome requires a reason, and a BHW may
 * not set a verification outcome. The repository is stubbed in-memory.
 */

const HOUSEHOLDS = new Map();
const original = {};
const STUBBED = ['getHousehold', 'updateHousehold'];

const makeHousehold = (over = {}) => ({
  id: 'HH-000001',
  barangay: 'San Isidro',
  municipalityId: 'M1',
  // Complete profiling data so the verification-outcome tests below exercise
  // the reviewer-stamping / scope / reason logic (not the completeness gate).
  headName: 'Juan Dela Cruz',
  purok: 'Purok 1',
  streetAddress: 'Sitio Maligaya',
  respondentFirst: 'Maria',
  respondentLast: 'Dela Cruz',
  waterSource: 'level3',
  toiletType: 'ws_own',
  sanitationAccess: 'Yes',
  monthlyIncome: 12000,
  members: [{ name: 'Juan Dela Cruz', relationship: 'Head', classification: '' }],
  verificationStatus: 'Pending Verification',
  verifiedBy: null,
  verifiedAt: null,
  correctionReason: '',
  ...over,
});

const HS = { id: 'hs-uuid-1', role: 'health_supervisor', barangay: 'San Isidro', municipalityId: 'M1', name: 'Supervisor One' };
const HS_OTHER = { id: 'hs-uuid-2', role: 'health_supervisor', barangay: 'San Antonio', municipalityId: 'M1' };
const BHW = { id: 'bhw-uuid-1', role: 'bhw', barangay: 'San Isidro', municipalityId: 'M1' };

before(() => {
  for (const key of STUBBED) original[key] = repository[key];
  repository.getHousehold = async (id) => {
    const h = HOUSEHOLDS.get(id);
    return h ? { ...h } : null;
  };
  repository.updateHousehold = async (id, patch) => {
    const current = HOUSEHOLDS.get(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    HOUSEHOLDS.set(id, next);
    return next;
  };
});

beforeEach(() => {
  HOUSEHOLDS.clear();
});

after(() => {
  for (const key of STUBBED) repository[key] = original[key];
});

test('verifying a household stamps the reviewer + timestamp from the session, ignoring the client', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  const result = await service.updateHousehold({
    id: 'HH-000001',
    user: HS,
    patch: { verificationStatus: 'Verified', verifiedBy: 'attacker-uuid', verifiedAt: '2000-01-01T00:00:00.000Z' },
  });
  assert.equal(result.verificationStatus, 'Verified');
  assert.equal(result.verifiedBy, 'hs-uuid-1');
  assert.notEqual(result.verifiedAt, '2000-01-01T00:00:00.000Z');
  assert.ok(result.verifiedAt);
});

test('returning a household for correction requires a reason', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  await assert.rejects(
    () => service.updateHousehold({ id: 'HH-000001', user: HS, patch: { verificationStatus: 'Returned for Correction' } }),
    (e) => e.statusCode === 422,
  );
});

test('returning a household for correction stores the reason', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  const result = await service.updateHousehold({
    id: 'HH-000001',
    user: HS,
    patch: { verificationStatus: 'Returned for Correction', correctionReason: 'Incomplete water source data' },
  });
  assert.equal(result.verificationStatus, 'Returned for Correction');
  assert.equal(result.correctionReason, 'Incomplete water source data');
});

test('verifying clears any stale correction reason', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold({ correctionReason: 'old reason' }));
  const result = await service.updateHousehold({
    id: 'HH-000001',
    user: HS,
    patch: { verificationStatus: 'Verified' },
  });
  assert.equal(result.correctionReason, '');
});

test('a BHW cannot set a verification outcome', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  await assert.rejects(
    () => service.updateHousehold({ id: 'HH-000001', user: BHW, patch: { verificationStatus: 'Verified' } }),
    (e) => e.statusCode === 403,
  );
});

test('a Health Supervisor cannot verify a household in another barangay (404)', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold({ barangay: 'San Isidro' }));
  await assert.rejects(
    () => service.updateHousehold({ id: 'HH-000001', user: HS_OTHER, patch: { verificationStatus: 'Verified' } }),
    (e) => e.statusCode === 404,
  );
});

test('an invalid verification status is rejected', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  await assert.rejects(
    () => service.updateHousehold({ id: 'HH-000001', user: HS, patch: { verificationStatus: 'Bogus' } }),
    (e) => e.statusCode === 422,
  );
});

// --- completeness gate (issue #5) ------------------------------------------

test('verifying an incomplete household is blocked and names the missing fields', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold({ members: [], waterSource: '', toiletType: '' }));
  await assert.rejects(
    () => service.updateHousehold({ id: 'HH-000001', user: HS, patch: { verificationStatus: 'Verified' } }),
    (e) => {
      assert.equal(e.statusCode, 422);
      assert.ok(Array.isArray(e.details));
      assert.ok(e.details.includes('Water source'));
      assert.ok(e.details.includes('Toilet facility'));
      assert.ok(e.details.includes('At least one household member'));
      return true;
    },
  );
  // The blocked verification did not mutate the stored record.
  assert.equal(HOUSEHOLDS.get('HH-000001').verificationStatus, 'Pending Verification');
});

test('a household with zero members cannot be approved (HH-023 style)', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold({ members: [] }));
  await assert.rejects(
    () => service.updateHousehold({ id: 'HH-000001', user: HS, patch: { verificationStatus: 'Verified' } }),
    (e) => e.statusCode === 422 && e.details.includes('At least one household member'),
  );
});

test('a complete household verifies successfully (HH-020 style)', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  const result = await service.updateHousehold({ id: 'HH-000001', user: HS, patch: { verificationStatus: 'Verified' } });
  assert.equal(result.verificationStatus, 'Verified');
});

test('missingForVerification lists each absent required field', () => {
  const missing = service.missingForVerification({ members: [] });
  for (const label of ['Household head', 'Purok/Zone', 'Street address / sitio', 'Respondent information', 'Water source', 'Toilet facility', 'Sanitation access', 'At least one household member']) {
    assert.ok(missing.includes(label), `expected missing to include ${label}`);
  }
  assert.deepEqual(service.missingForVerification({
    headName: 'H', purok: 'P', streetAddress: 'S', respondentFirst: 'R',
    waterSource: 'level3', toiletType: 'ws_own', sanitationAccess: 'Yes',
    members: [{ name: 'H' }],
  }), []);
});

// --- separation of duties (issue #6) ---------------------------------------

test('a BHW cannot set the approval status', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  await assert.rejects(
    () => service.updateHousehold({ id: 'HH-000001', user: BHW, patch: { approvalStatus: 'Approved' } }),
    (e) => e.statusCode === 403,
  );
});

test('a BHW cannot move a household to the Approved HH status', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  await assert.rejects(
    () => service.updateHousehold({ id: 'HH-000001', user: BHW, patch: { hhStatus: 'Approved' } }),
    (e) => e.statusCode === 403,
  );
});

test('a BHW may still submit a household for verification', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold({ hhStatus: 'Ongoing' }));
  const result = await service.updateHousehold({ id: 'HH-000001', user: BHW, patch: { hhStatus: 'Submitted' } });
  assert.equal(result.hhStatus, 'Submitted');
});

import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import repository from '../src/repositories/index.js';
import * as service from '../src/services/residents.service.js';

/**
 * Resident directory (verified-only) service tests.
 *
 * The Health Supervisor directory must list only VERIFIED residents — those
 * individually approved (residents.verification_status = 'approved') OR linked
 * to a Verified household — de-duplicated by resident id, and always within the
 * caller's assigned barangay. The repository is stubbed in-memory so the merge,
 * de-duplication and scope rules are exercised without a database.
 */

const STUBBED = ['listResidents', 'verifiedHouseholdResidentIds', 'listResidentsByIds'];
const original = {};

// name-keyed dataset; each resident carries a verification_status + barangay.
const RESIDENTS = [
  { id: 'RES-1', barangay: 'San Isidro', verificationStatus: 'approved', createdAt: '2026-01-04' },
  { id: 'RES-2', barangay: 'San Isidro', verificationStatus: 'pending', createdAt: '2026-01-03' },
  { id: 'RES-3', barangay: 'San Isidro', verificationStatus: 'pending', createdAt: '2026-01-02' },
  { id: 'RES-4', barangay: 'San Antonio', verificationStatus: 'approved', createdAt: '2026-01-01' },
];

// Configurable per test: resident ids that belong to a Verified household.
let householdVerified = [];
let lastListArgs = null;

before(() => {
  for (const key of STUBBED) original[key] = repository[key];

  repository.listResidents = async ({ barangay = null, verificationStatuses = null } = {}) => {
    lastListArgs = { barangay, verificationStatuses };
    let rows = RESIDENTS.filter((r) => !barangay || r.barangay === barangay);
    if (verificationStatuses && verificationStatuses.length) {
      rows = rows.filter((r) => verificationStatuses.includes(r.verificationStatus));
    }
    return { rows: rows.map((r) => ({ ...r })), total: rows.length };
  };

  repository.verifiedHouseholdResidentIds = async ({ barangay = null } = {}) => {
    // Only return ids whose resident is actually in the requested barangay,
    // mirroring the real scope-filtered query.
    return householdVerified.filter((id) => {
      const r = RESIDENTS.find((x) => x.id === id);
      return r && (!barangay || r.barangay === barangay);
    });
  };

  repository.listResidentsByIds = async ({ ids = [], barangay = null } = {}) => {
    return RESIDENTS
      .filter((r) => ids.includes(r.id) && (!barangay || r.barangay === barangay))
      .map((r) => ({ ...r }));
  };
});

beforeEach(() => { householdVerified = []; lastListArgs = null; });

after(() => {
  for (const key of STUBBED) repository[key] = original[key];
});

const HS = { id: 'hs-1', role: 'health_supervisor', barangay: 'San Isidro', municipalityId: 'M1' };
const PHN = { id: 'phn-1', role: 'phn', municipalityId: 'M1' };

test('verified directory returns only approved residents in scope when there are no verified households', async () => {
  const { rows } = await service.listResidents({ user: HS, verifiedOnly: true });
  assert.deepEqual(rows.map((r) => r.id), ['RES-1']);
  assert.deepEqual(lastListArgs.verificationStatuses, ['approved']);
  assert.equal(lastListArgs.barangay, 'San Isidro');
});

test('a resident verified only through a Verified household is included', async () => {
  householdVerified = ['RES-2'];
  const { rows } = await service.listResidents({ user: HS, verifiedOnly: true });
  assert.deepEqual(rows.map((r) => r.id).sort(), ['RES-1', 'RES-2']);
});

test('a pending resident with no verification appears in neither source', async () => {
  householdVerified = ['RES-2'];
  const { rows } = await service.listResidents({ user: HS, verifiedOnly: true });
  assert.ok(!rows.some((r) => r.id === 'RES-3'));
});

test('a resident both approved AND in a Verified household appears exactly once', async () => {
  householdVerified = ['RES-1'];
  const { rows } = await service.listResidents({ user: HS, verifiedOnly: true });
  const ids = rows.map((r) => r.id);
  assert.deepEqual(ids, ['RES-1']);
  assert.equal(ids.filter((id) => id === 'RES-1').length, 1);
});

test('the verified directory never leaks another barangay (household ids are scope-filtered)', async () => {
  householdVerified = ['RES-4']; // approved, but in San Antonio
  const { rows } = await service.listResidents({ user: HS, verifiedOnly: true });
  assert.ok(!rows.some((r) => r.id === 'RES-4'));
  assert.deepEqual(rows.map((r) => r.id), ['RES-1']);
});

test('a Health Supervisor cannot request another barangay (403)', async () => {
  await assert.rejects(
    () => service.listResidents({ user: HS, verifiedOnly: true, barangay: 'San Antonio' }),
    (e) => e.statusCode === 403,
  );
});

test('without verifiedOnly the directory is the plain scoped list (approved + pending)', async () => {
  const { rows } = await service.listResidents({ user: HS });
  assert.deepEqual(rows.map((r) => r.id).sort(), ['RES-1', 'RES-2', 'RES-3']);
  assert.equal(lastListArgs.verificationStatuses, null);
});

test('a municipality-wide caller (PHN) drilling into a barangay stays scoped to it', async () => {
  const { rows } = await service.listResidents({ user: PHN, verifiedOnly: true, barangay: 'San Antonio' });
  assert.deepEqual(rows.map((r) => r.id), ['RES-4']);
  assert.equal(lastListArgs.barangay, 'San Antonio');
});

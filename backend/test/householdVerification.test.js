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
  waterSource: 'level3',
  toiletType: 'ws_own',
  sanitationAccess: 'Yes',
  monthlyIncome: 12000,
  members: [],
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

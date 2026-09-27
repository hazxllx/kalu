import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import repository from '../src/repositories/index.js';
import * as service from '../src/services/households.service.js';

/**
 * Member health profile service tests (foundation): BMI is always recomputed
 * server-side from height/weight and cleared to null (never 0) when a
 * measurement is missing; scope and the verified-lock are enforced. The
 * repository is stubbed in-memory, so no database or Supabase is touched.
 */

const HOUSEHOLDS = new Map();
const PROFILES = new Map(); // household_member_id -> profile
const original = {};
const STUBBED = ['getHousehold', 'getMemberHealthProfile', 'upsertMemberHealthProfile'];

const makeHousehold = (over = {}) => ({
  id: 'HH-000001',
  barangay: 'San Isidro',
  municipalityId: 'M1',
  barangayId: 'B1',
  verificationStatus: 'Pending Verification',
  members: [{ id: 'MEM-1', name: 'Juan Dela Cruz' }],
  ...over,
});

const BHW = { id: 'bhw-1', role: 'bhw', barangay: 'San Isidro', municipalityId: 'M1' };
const BHW_OTHER = { id: 'bhw-2', role: 'bhw', barangay: 'San Antonio', municipalityId: 'M1' };
const HS = { id: 'hs-1', role: 'health_supervisor', barangay: 'San Isidro', municipalityId: 'M1' };

before(() => {
  for (const key of STUBBED) original[key] = repository[key];
  repository.getHousehold = async (id) => {
    const h = HOUSEHOLDS.get(id);
    return h ? { ...h } : null;
  };
  repository.getMemberHealthProfile = async (memberId) => {
    const p = PROFILES.get(memberId);
    return p ? { ...p } : null;
  };
  repository.upsertMemberHealthProfile = async (memberId, patch) => {
    const next = { id: 'HMH-1', householdMemberId: memberId, ...patch };
    PROFILES.set(memberId, next);
    return { ...next };
  };
});

beforeEach(() => {
  HOUSEHOLDS.clear();
  PROFILES.clear();
});

after(() => {
  for (const key of STUBBED) repository[key] = original[key];
});

test('BMI is computed server-side from height + weight (170cm/70kg ~= 24.2)', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  const saved = await service.saveMemberHealth({
    id: 'HH-000001', memberId: 'MEM-1', user: BHW,
    payload: { heightCm: 170, weightKg: 70 },
  });
  assert.equal(saved.bmi, 24.2);
  assert.equal(saved.heightCm, 170);
  assert.equal(saved.weightKg, 70);
  assert.ok(saved.bmiMeasuredAt);
});

test('BMI is null (never 0) when weight is missing', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  const saved = await service.saveMemberHealth({
    id: 'HH-000001', memberId: 'MEM-1', user: BHW,
    payload: { heightCm: 170 },
  });
  assert.equal(saved.bmi, null);
  assert.equal(saved.bmiMeasuredAt, null);
});

test('a client-sent BMI is ignored and recomputed', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  const saved = await service.saveMemberHealth({
    id: 'HH-000001', memberId: 'MEM-1', user: BHW,
    payload: { heightCm: 170, weightKg: 70, bmi: 999 },
  });
  assert.equal(saved.bmi, 24.2);
});

test('clearing weight clears a previously stored BMI (no stale value)', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  await service.saveMemberHealth({ id: 'HH-000001', memberId: 'MEM-1', user: BHW, payload: { heightCm: 170, weightKg: 70 } });
  const cleared = await service.saveMemberHealth({ id: 'HH-000001', memberId: 'MEM-1', user: BHW, payload: { heightCm: 170, weightKg: '' } });
  assert.equal(cleared.bmi, null);
});

test('a negative weight is rejected (422)', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  await assert.rejects(
    () => service.saveMemberHealth({ id: 'HH-000001', memberId: 'MEM-1', user: BHW, payload: { heightCm: 170, weightKg: -5 } }),
    (e) => e.statusCode === 422,
  );
});

test('a future date of death is rejected (422)', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  const future = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await assert.rejects(
    () => service.saveMemberHealth({ id: 'HH-000001', memberId: 'MEM-1', user: BHW, payload: { dateOfDeath: future } }),
    (e) => e.statusCode === 422,
  );
});

test('a BHW in another barangay cannot save member health (404)', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  await assert.rejects(
    () => service.saveMemberHealth({ id: 'HH-000001', memberId: 'MEM-1', user: BHW_OTHER, payload: { heightCm: 170, weightKg: 70 } }),
    (e) => e.statusCode === 404,
  );
});

test('an unknown member is a 404', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  await assert.rejects(
    () => service.saveMemberHealth({ id: 'HH-000001', memberId: 'MEM-NOPE', user: BHW, payload: {} }),
    (e) => e.statusCode === 404,
  );
});

test('a BHW cannot edit a verified household (403); the Health Supervisor still can', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold({ verificationStatus: 'Verified' }));
  await assert.rejects(
    () => service.saveMemberHealth({ id: 'HH-000001', memberId: 'MEM-1', user: BHW, payload: { heightCm: 170, weightKg: 70 } }),
    (e) => e.statusCode === 403,
  );
  const saved = await service.saveMemberHealth({ id: 'HH-000001', memberId: 'MEM-1', user: HS, payload: { heightCm: 170, weightKg: 70 } });
  assert.equal(saved.bmi, 24.2);
});

test('getMemberHealth returns the member and null profile when none saved', async () => {
  HOUSEHOLDS.set('HH-000001', makeHousehold());
  const result = await service.getMemberHealth({ id: 'HH-000001', memberId: 'MEM-1', user: BHW });
  assert.equal(result.member.id, 'MEM-1');
  assert.equal(result.profile, null);
});

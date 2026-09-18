import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import repository from '../src/repositories/index.js';
import * as service from '../src/services/verifications.service.js';

/**
 * Manual resident verification service tests.
 *
 * The repository is stubbed with an in-memory store so the transitions, scope
 * checks, audit logging and account-status sync are exercised without touching
 * a database. Reviewer identity always comes from the `user` argument, exactly
 * as the controller passes it from the authenticated session.
 */

const RESIDENTS = new Map();
const LOGS = [];
const PROFILE_STATUS = [];
const original = {};

const STUBBED = [
  'getResident',
  'getResidentByAuthUserId',
  'listResidentsByVerificationStatus',
  'updateResident',
  'insertResidentVerificationLog',
  'listResidentVerificationLogs',
  'listRecentResidentVerificationLogs',
  'setProfileStatus',
];

const makeResident = (over = {}) => ({
  id: 'RES-000001',
  firstName: 'Juan',
  middleName: '',
  lastName: 'Dela Cruz',
  suffix: '',
  barangay: 'San Isidro',
  municipalityId: 'M1',
  cellphoneNo: '09000000000',
  birthDate: '1990-01-01',
  sex: 'Male',
  civilStatus: 'Single',
  currentAddress: 'Purok 1',
  philhealthNo: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  submittedForVerificationAt: '2026-01-01T00:00:00.000Z',
  verificationStatus: 'pending',
  verifiedBy: null,
  verifiedAt: null,
  rejectionReason: '',
  updatedAt: null,
  authUserId: 'user-1',
  ...over,
});

const HS = { id: 'hs-1', role: 'health_supervisor', barangay: 'San Isidro', municipalityId: 'M1' };
const HS_OTHER = { id: 'hs-2', role: 'health_supervisor', barangay: 'San Antonio', municipalityId: 'M1' };
const PHN = { id: 'phn-1', role: 'phn', municipalityId: 'M1' };
const RESIDENT = { id: 'user-1', role: 'resident-limited' };
const BHW = { id: 'bhw-1', role: 'bhw', barangay: 'San Isidro', municipalityId: 'M1' };

before(() => {
  for (const key of STUBBED) original[key] = repository[key];

  repository.getResident = async (id) => RESIDENTS.get(id) || null;
  repository.getResidentByAuthUserId = async (uid) =>
    [...RESIDENTS.values()].find((r) => r.authUserId === uid) || null;
  repository.listResidentsByVerificationStatus = async ({ statuses = null, q = '', barangay = null, limit = 100, offset = 0 } = {}) => {
    let rows = [...RESIDENTS.values()];
    if (statuses && statuses.length) rows = rows.filter((r) => statuses.includes(r.verificationStatus));
    if (q) rows = rows.filter((r) => `${r.firstName} ${r.lastName}`.toLowerCase().includes(String(q).toLowerCase()));
    if (barangay) rows = rows.filter((r) => r.barangay === barangay);
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  };
  repository.updateResident = async (id, patch) => {
    const current = RESIDENTS.get(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    RESIDENTS.set(id, next);
    return next;
  };
  repository.insertResidentVerificationLog = async (log) => {
    const row = { id: `LOG-${LOGS.length + 1}`, ...log, createdAt: new Date().toISOString() };
    LOGS.push(row);
    return row;
  };
  repository.listResidentVerificationLogs = async (residentId) =>
    LOGS.filter((l) => l.residentId === residentId).map((l) => ({ ...l }));
  repository.listRecentResidentVerificationLogs = async () => ({ rows: LOGS.map((l) => ({ ...l })), total: LOGS.length });
  repository.setProfileStatus = async (profileId, status) => {
    PROFILE_STATUS.push({ profileId, status });
    return { id: profileId, status };
  };
});

beforeEach(() => {
  RESIDENTS.clear();
  LOGS.length = 0;
  PROFILE_STATUS.length = 0;
});

after(() => {
  for (const key of STUBBED) repository[key] = original[key];
});

test('a new resident defaults to pending and appears in the pending queue', async () => {
  RESIDENTS.set('RES-000001', makeResident());
  const { rows } = await service.listQueue({ user: HS, status: 'pending' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].name, 'Juan Dela Cruz');
});

test('a Health Supervisor can approve a pending resident and the account becomes active', async () => {
  RESIDENTS.set('RES-000001', makeResident());
  const result = await service.approve({ user: HS, id: 'RES-000001', remarks: 'Verified at the health station' });

  assert.equal(result.status, 'approved');
  assert.equal(result.verifiedBy, 'hs-1');
  assert.ok(result.verifiedAt);
  assert.equal(RESIDENTS.get('RES-000001').verificationStatus, 'approved');
  assert.equal(LOGS.length, 1);
  assert.equal(LOGS[0].action, 'approved');
  assert.equal(LOGS[0].reviewedBy, 'hs-1');
  assert.equal(LOGS[0].previousStatus, 'pending');
  assert.equal(LOGS[0].newStatus, 'approved');
  assert.deepEqual(PROFILE_STATUS.at(-1), { profileId: 'user-1', status: 'active' });
});

test('approving an already approved resident is a conflict', async () => {
  RESIDENTS.set('RES-000001', makeResident({ verificationStatus: 'approved' }));
  await assert.rejects(() => service.approve({ user: HS, id: 'RES-000001' }), (e) => e.statusCode === 409);
});

test('rejecting requires a reason', async () => {
  RESIDENTS.set('RES-000001', makeResident());
  await assert.rejects(() => service.reject({ user: HS, id: 'RES-000001', reason: '  ' }), (e) => e.statusCode === 400);
  assert.equal(LOGS.length, 0);
});

test('rejecting records the reason and keeps the account limited', async () => {
  RESIDENTS.set('RES-000001', makeResident());
  const result = await service.reject({ user: HS, id: 'RES-000001', reason: 'Invalid information', remarks: 'Address mismatch' });

  assert.equal(result.status, 'rejected');
  assert.match(result.rejectionReason, /Invalid information/);
  assert.match(result.rejectionReason, /Address mismatch/);
  assert.equal(LOGS[0].action, 'rejected');
  assert.equal(LOGS[0].newStatus, 'rejected');
  assert.deepEqual(PROFILE_STATUS.at(-1), { profileId: 'user-1', status: 'pending_verification' });
});

test('requesting a resubmission moves a rejected resident to resubmission_required and logs it', async () => {
  RESIDENTS.set('RES-000001', makeResident({ verificationStatus: 'rejected' }));
  const result = await service.requestResubmission({ user: HS, id: 'RES-000001', reason: 'Insufficient proof of residency' });
  assert.equal(result.status, 'resubmission_required');
  assert.equal(LOGS[0].action, 'rejected');
  assert.equal(LOGS[0].previousStatus, 'rejected');
  assert.equal(LOGS[0].newStatus, 'resubmission_required');
});

test('a resident can resubmit their own rejected registration and it returns to pending', async () => {
  RESIDENTS.set('RES-000001', makeResident({ verificationStatus: 'rejected', rejectionReason: 'Invalid information' }));
  const result = await service.resubmit({ user: RESIDENT, id: 'RES-000001' });

  assert.equal(result.status, 'pending');
  assert.equal(result.rejectionReason, '');
  assert.equal(LOGS[0].action, 'resubmitted');
  assert.equal(LOGS[0].previousStatus, 'rejected');
  assert.equal(LOGS[0].newStatus, 'pending');
  assert.equal(LOGS[0].reviewedBy, null);
});

test('a resident cannot resubmit another resident’s registration', async () => {
  RESIDENTS.set('RES-000001', makeResident({ authUserId: 'someone-else', verificationStatus: 'rejected' }));
  await assert.rejects(() => service.resubmit({ user: RESIDENT, id: 'RES-000001' }), (e) => e.statusCode === 404);
});

test('a resident cannot approve or reject anyone', async () => {
  RESIDENTS.set('RES-000001', makeResident());
  await assert.rejects(() => service.approve({ user: RESIDENT, id: 'RES-000001' }), (e) => e.statusCode === 403);
  await assert.rejects(() => service.reject({ user: RESIDENT, id: 'RES-000001', reason: 'x' }), (e) => e.statusCode === 403);
});

test('an unauthorized role (BHW) cannot review residents', async () => {
  RESIDENTS.set('RES-000001', makeResident());
  await assert.rejects(() => service.listQueue({ user: BHW }), (e) => e.statusCode === 403);
  await assert.rejects(() => service.approve({ user: BHW, id: 'RES-000001' }), (e) => e.statusCode === 403);
});

test('a Health Supervisor cannot act on another barangay (404, not 403)', async () => {
  RESIDENTS.set('RES-000001', makeResident({ barangay: 'San Isidro' }));
  await assert.rejects(() => service.approve({ user: HS_OTHER, id: 'RES-000001' }), (e) => e.statusCode === 404);
});

test('a PHN at municipality scope can review within the municipality', async () => {
  RESIDENTS.set('RES-000001', makeResident());
  const result = await service.approve({ user: PHN, id: 'RES-000001' });
  assert.equal(result.status, 'approved');
});

test('an unknown status filter is rejected', async () => {
  await assert.rejects(() => service.listQueue({ user: HS, status: 'bogus' }), (e) => e.statusCode === 400);
});

test('getMine returns the resident’s own status and history', async () => {
  RESIDENTS.set('RES-000001', makeResident({ verificationStatus: 'approved' }));
  LOGS.push({ id: 'LOG-1', residentId: 'RES-000001', reviewedBy: 'hs-1', action: 'approved', reason: '', previousStatus: 'pending', newStatus: 'approved', createdAt: '2026-01-02T00:00:00.000Z' });

  const mine = await service.getMine({ user: RESIDENT });
  assert.equal(mine.hasResidentRecord, true);
  assert.equal(mine.verification.status, 'approved');
  assert.equal(mine.history.length, 1);
  assert.equal(mine.history[0].action, 'approved');
});

test('getMine reports no resident record without leaking whether others exist', async () => {
  const mine = await service.getMine({ user: RESIDENT });
  assert.equal(mine.hasResidentRecord, false);
  assert.equal(mine.verification, null);
});

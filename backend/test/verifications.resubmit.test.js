import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import repository from '../src/repositories/index.js';
import * as service from '../src/services/verifications.service.js';

/**
 * Resident self-resubmission transition tests.
 *
 * After a Health Supervisor requests a resubmission (or rejects), the resident
 * re-uploads documents and the record must return to 'pending' — driven only by
 * the authenticated account, never a body-supplied id. The repository is
 * stubbed in-memory; `resubmit` performs no notification/storage side effects.
 */

const STUBBED = ['getResidentByAuthUserId', 'updateResident', 'insertResidentVerificationLog', 'setProfileStatus'];
const original = {};

let resident;
let logged;
let profileStatus;

before(() => {
  for (const k of STUBBED) original[k] = repository[k];
  repository.getResidentByAuthUserId = async (authUserId) =>
    resident && resident.authUserId === authUserId ? { ...resident } : null;
  repository.updateResident = async (id, patch) => {
    if (resident && resident.id === id) resident = { ...resident, ...patch };
    return { ...resident };
  };
  repository.insertResidentVerificationLog = async (entry) => { logged = entry; return { id: 'log-1', ...entry }; };
  repository.setProfileStatus = async (_authUserId, status) => { profileStatus = status; };
});

after(() => { for (const k of STUBBED) repository[k] = original[k]; });

beforeEach(() => {
  logged = null;
  profileStatus = null;
  resident = {
    id: 'RES-1',
    authUserId: 'auth-1',
    barangay: 'San Isidro',
    verificationStatus: 'resubmission_required',
  };
});

const RESIDENT = { id: 'auth-1', role: 'resident-limited' };

test('resubmit returns a resubmission_required record to pending (self, from account)', async () => {
  const result = await service.resubmit({ user: RESIDENT, id: 'RES-1' });
  assert.equal(result.status, 'pending');
  assert.equal(resident.verificationStatus, 'pending');
  assert.equal(logged.newStatus, 'pending');
  assert.equal(logged.previousStatus, 'resubmission_required');
  assert.equal(profileStatus, 'pending_verification'); // stays limited until approved
});

test('resubmit also works from rejected', async () => {
  resident.verificationStatus = 'rejected';
  const result = await service.resubmit({ user: RESIDENT, id: 'RES-1' });
  assert.equal(result.status, 'pending');
});

test('resubmit is rejected when the record is not awaiting resubmission (409)', async () => {
  resident.verificationStatus = 'pending';
  await assert.rejects(() => service.resubmit({ user: RESIDENT, id: 'RES-1' }), (e) => e.statusCode === 409);
});

test('a non-resident cannot resubmit (403)', async () => {
  await assert.rejects(
    () => service.resubmit({ user: { id: 'hs-1', role: 'health_supervisor' }, id: 'RES-1' }),
    (e) => e.statusCode === 403,
  );
});

test('a resident cannot resubmit another resident id (403)', async () => {
  await assert.rejects(
    () => service.resubmit({ user: RESIDENT, id: 'RES-999' }),
    (e) => e.statusCode === 403,
  );
});

test('resubmit fails cleanly when the account has no resident record (404)', async () => {
  resident = null;
  await assert.rejects(() => service.resubmit({ user: RESIDENT, id: 'RES-1' }), (e) => e.statusCode === 404);
});

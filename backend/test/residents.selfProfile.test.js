import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import repository from '../src/repositories/index.js';
import * as service from '../src/services/residents.service.js';

/**
 * Resident self-service profile update tests.
 *
 * Only the contact number may change, the resident is resolved from the
 * authenticated session (never a body id), and the PH mobile format is
 * enforced. The repository is stubbed in-memory (no DB/storage).
 */

const STUBBED = ['getResidentByAuthUserId', 'updateResident'];
const original = {};
let resident;
let lastPatch;

before(() => {
  for (const k of STUBBED) original[k] = repository[k];
  repository.getResidentByAuthUserId = async (authUserId) =>
    resident && resident.authUserId === authUserId ? { ...resident } : null;
  repository.updateResident = async (id, patch) => {
    lastPatch = patch;
    if (resident && resident.id === id) resident = { ...resident, ...patch };
    return { ...resident };
  };
});

after(() => { for (const k of STUBBED) repository[k] = original[k]; });

beforeEach(() => {
  lastPatch = null;
  resident = {
    id: 'RES-1',
    authUserId: 'auth-1',
    firstName: 'Juan',
    lastName: 'Dela Cruz',
    cellphoneNo: '09171234567',
    barangay: 'San Isidro',
  };
});

const RESIDENT = { id: 'auth-1', role: 'resident' };

test('a resident updates their own contact number', async () => {
  const result = await service.updateOwnProfile({ user: RESIDENT, payload: { cellphoneNo: '0918 765 4321' } });
  assert.equal(lastPatch.cellphoneNo, '0918 765 4321');
  assert.equal(result.cellphoneNo, '0918 765 4321');
  assert.equal(result.id, 'RES-1');
});

test('an invalid PH mobile number is rejected (422)', async () => {
  await assert.rejects(
    () => service.updateOwnProfile({ user: RESIDENT, payload: { cellphoneNo: '12345' } }),
    (e) => e.statusCode === 422,
  );
});

test('an empty contact number is allowed (clears it)', async () => {
  const result = await service.updateOwnProfile({ user: RESIDENT, payload: { cellphoneNo: '' } });
  assert.equal(result.cellphoneNo, '');
});

test('a non-resident cannot use the self-profile update (403)', async () => {
  await assert.rejects(
    () => service.updateOwnProfile({ user: { id: 'hs-1', role: 'health_supervisor' }, payload: { cellphoneNo: '09171234567' } }),
    (e) => e.statusCode === 403,
  );
});

test('a resident with no record gets 404', async () => {
  resident = null;
  await assert.rejects(
    () => service.updateOwnProfile({ user: RESIDENT, payload: { cellphoneNo: '09171234567' } }),
    (e) => e.statusCode === 404,
  );
});

test('with no editable fields supplied nothing is patched', async () => {
  const result = await service.updateOwnProfile({ user: RESIDENT, payload: {} });
  assert.equal(lastPatch, null);
  assert.equal(result.cellphoneNo, '09171234567');
});

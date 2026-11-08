import assert from 'node:assert/strict';
import test from 'node:test';

// All repository operations below are isolated in-memory substitutes. Auth is
// deliberately unconfigured, including the best-effort confirmation call.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
const repository = (await import('../src/repositories/index.js')).default;
const { registerResident, activateExistingResident } = await import('../src/services/registration.service.js');

const USER = { id: '11111111-1111-4111-8111-111111111111', role: 'resident' };
const OTHER = '22222222-2222-4222-8222-222222222222';
const PAYLOAD = {
  firstName: 'Ana', lastName: 'Santos', middleName: '', birthDate: '1990-05-20',
  sex: 'Female', civilStatus: 'Single', barangay: 'San Isidro', identityNo: 'CLAIM-TEST-ID',
};
const RESIDENT = {
  id: 'RES-000123', healthRecordNo: 'RHU-000123', ...PAYLOAD,
  verificationStatus: 'approved', authUserId: null, updatedAt: '2026-11-07T00:00:00Z',
};

const install = (t, initial = [RESIDENT]) => {
  const rows = initial.map((row) => ({ ...row }));
  const methods = ['getResidentByAuthUserId', 'getResident', 'findResidentByIdentity', 'findBarangayByName',
    'claimResidentForAccount', 'activateResidentById', 'updateResident', 'nextResidentIds', 'insertResident', 'setProfileStatus'];
  const original = Object.fromEntries(methods.map((name) => [name, repository[name]]));
  t.after(() => Object.assign(repository, original));
  const calls = { identity: [], id: [], updates: [], inserted: [], activated: [] };
  repository.getResidentByAuthUserId = async (id) => {
    const row = rows.find((resident) => resident.authUserId === id);
    return row ? { ...row } : null;
  };
  repository.getResident = async (id) => {
    const row = rows.find((resident) => resident.id === id);
    return row ? { ...row } : null;
  };
  repository.findBarangayByName = async () => ({ id: 'barangay-test', name: 'San Isidro', municipalityId: 'municipality-test', status: 'Active' });
  repository.findResidentByIdentity = async ({ identityNo, firstName, lastName, birthDate }) => {
    const row = rows.find((resident) => identityNo ? resident.identityNo === identityNo
      : resident.firstName === firstName && resident.lastName === lastName && resident.birthDate === birthDate);
    return row ? { ...row } : null;
  };
  const claim = (args, byIdentity) => {
    calls[byIdentity ? 'identity' : 'id'].push(args);
    const row = rows.find((resident) => (byIdentity ? resident.identityNo === args.identityNo : resident.id === args.residentId)
      && resident.birthDate === args.birthDate && !resident.authUserId);
    if (!row) return null;
    if (rows.some((resident) => resident.authUserId === args.authUserId)) throw Object.assign(new Error('Duplicate owner'), { code: '23505' });
    row.authUserId = args.authUserId;
    return { ...row };
  };
  repository.claimResidentForAccount = async (args) => claim(args, true);
  repository.activateResidentById = async (args) => claim(args, false);
  repository.updateResident = async (id, patch, options) => {
    calls.updates.push({ id, patch, options });
    assert.equal(Object.hasOwn(patch, 'authUserId'), false, 'a non-atomic update must never attach an account');
    const row = rows.find((resident) => resident.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    return { ...row };
  };
  let sequence = 200;
  repository.nextResidentIds = async () => ({ id: `RES-${String(++sequence).padStart(6, '0')}`, healthRecordNo: `RHU-${sequence}` });
  repository.insertResident = async (row) => {
    calls.inserted.push(row);
    if (rows.some((resident) => resident.authUserId === row.authUserId)) {
      throw Object.assign(new Error('Duplicate account ownership'), { details: { code: '23505' } });
    }
    rows.push({ ...row });
    return { ...row };
  };
  repository.setProfileStatus = async (...args) => { calls.activated.push(args); };
  return { rows, calls };
};

test('global identity match with the wrong DOB fails closed after a null atomic proof', async (t) => {
  const harness = install(t);
  await assert.rejects(registerResident({ user: USER, payload: { ...PAYLOAD, birthDate: '1991-05-20', firstName: 'Other' } }),
    (error) => error.statusCode === 409 && !/CLAIM-TEST-ID|Ana|Santos/.test(error.message));
  assert.deepEqual(harness.calls.identity, [{ authUserId: USER.id, identityNo: PAYLOAD.identityNo, birthDate: '1991-05-20' }]);
  assert.equal(harness.rows[0].authUserId, null);
  assert.equal(harness.calls.updates.length, 0);
  assert.equal(harness.calls.inserted.length, 0);
  assert.equal(harness.calls.activated.length, 0);
});

test('rejected or unavailable atomic claims never fall back to a direct link or expose database messages', async (t) => {
  const harness = install(t);
  repository.claimResidentForAccount = async () => { throw Object.assign(new Error('Private database constraint values'), { details: { code: '23514' } }); };
  await assert.rejects(registerResident({ user: USER, payload: PAYLOAD }),
    (error) => error.statusCode === 409 && !/Private|constraint/.test(error.message));
  repository.claimResidentForAccount = undefined;
  await assert.rejects(registerResident({ user: USER, payload: PAYLOAD }), (error) => error.statusCode === 503);
  repository.activateResidentById = undefined;
  await assert.rejects(registerResident({ user: USER, payload: { ...PAYLOAD, residentId: RESIDENT.id } }), (error) => error.statusCode === 503);
  await assert.rejects(activateExistingResident({ user: USER, residentId: RESIDENT.id, birthDate: PAYLOAD.birthDate }), (error) => error.statusCode === 503);
  assert.equal(harness.rows[0].authUserId, null);
  assert.equal(harness.calls.updates.length, 0);
  assert.equal(harness.calls.activated.length, 0);
});

test('malformed, wrong-record and wrong-owner atomic results are not fabricated successes', async (t) => {
  const harness = install(t);
  for (const result of [{ id: null, authUserId: null }, { ...RESIDENT, id: 'RES-999999', authUserId: USER.id }, { ...RESIDENT, authUserId: OTHER }]) {
    repository.claimResidentForAccount = async () => result;
    await assert.rejects(registerResident({ user: USER, payload: PAYLOAD }), (error) => error.statusCode === 503);
  }
  assert.equal(harness.rows[0].authUserId, null);
  assert.equal(harness.calls.updates.length, 0);
  assert.equal(harness.calls.activated.length, 0);
});

test('staff name/DOB matches reuse the real ID RPC and preserve the approved clinical profile', async (t) => {
  const harness = install(t, [{ ...RESIDENT, identityNo: '' }]);
  const result = await registerResident({ user: USER, payload: { ...PAYLOAD, identityNo: '' } });
  assert.equal(result.id, RESIDENT.id);
  assert.equal(result.healthRecordNo, RESIDENT.healthRecordNo);
  assert.equal(result.verificationStatus, 'approved');
  assert.deepEqual(harness.calls.id, [{ authUserId: USER.id, residentId: RESIDENT.id, birthDate: PAYLOAD.birthDate }]);
  assert.deepEqual(harness.calls.activated, [[USER.id, 'active']]);
  assert.equal(harness.calls.updates.length, 0);
  assert.equal(harness.calls.inserted.length, 0);
});

test('an explicit resident-ID claim cannot replace an owner linked between the read and claim', async (t) => {
  const harness = install(t);
  repository.activateResidentById = async () => { harness.rows[0].authUserId = OTHER; return null; };
  await assert.rejects(registerResident({ user: USER, payload: { ...PAYLOAD, residentId: 'res-000123' } }), (error) => error.statusCode === 409);
  assert.equal(harness.rows[0].authUserId, OTHER);
  assert.equal(harness.calls.updates.length, 0);
  assert.equal(harness.calls.activated.length, 0);
});

test('concurrent same-owner claims and committed-response loss recover the current owner without a second attachment', async (t) => {
  const harness = install(t);
  const results = await Promise.all([registerResident({ user: USER, payload: PAYLOAD }), registerResident({ user: USER, payload: PAYLOAD })]);
  assert.deepEqual(results.map((result) => result.id), [RESIDENT.id, RESIDENT.id]);
  assert.equal(harness.rows.length, 1);
  assert.equal(harness.rows[0].authUserId, USER.id);
  assert.equal(harness.calls.updates.length, 0);
  harness.rows[0].authUserId = null;
  repository.activateResidentById = async () => {
    harness.rows[0].authUserId = USER.id;
    throw new TypeError('Response lost');
  };
  const recovered = await activateExistingResident({ user: USER, residentId: RESIDENT.id, birthDate: PAYLOAD.birthDate });
  assert.equal(recovered.id, RESIDENT.id);
  assert.equal(recovered.alreadyLinked, false);
});

test('approved same-profile retries recover activation, while a different registration remains a conflict', async (t) => {
  const harness = install(t, [{ ...RESIDENT, authUserId: USER.id }]);
  const retry = await registerResident({ user: USER, payload: { ...PAYLOAD, residentId: RESIDENT.id } });
  assert.equal(retry.id, RESIDENT.id);
  assert.deepEqual(harness.calls.activated, [[USER.id, 'active']]);
  await assert.rejects(registerResident({ user: USER, payload: { ...PAYLOAD, residentId: 'RES-000456', identityNo: 'ANOTHER-ID', firstName: 'Other' } }),
    (error) => error.statusCode === 409);
  assert.equal(harness.calls.inserted.length, 0);
});

test('new registration preserves scope and simultaneous same-account inserts recover the one committed row', async (t) => {
  const harness = install(t, []);
  const results = await Promise.all([registerResident({ user: USER, payload: PAYLOAD }), registerResident({ user: USER, payload: PAYLOAD })]);
  assert.equal(harness.rows.length, 1);
  assert.equal(harness.calls.inserted.length, 2);
  assert.equal(results[0].id, results[1].id);
  assert.equal(harness.rows[0].authUserId, USER.id);
  assert.equal(harness.rows[0].municipalityId, 'municipality-test');
  assert.equal(harness.rows[0].barangayId, 'barangay-test');
  assert.equal(harness.rows[0].verificationStatus, 'pending');
  assert.equal(harness.calls.activated.length, 0);
  assert.equal((await registerResident({ user: USER })).id, results[0].id);
});

test('minor metadata is applied only after an atomic claim and a rejected update is not a success', async (t) => {
  const harness = install(t, [{ ...RESIDENT, birthDate: '2015-05-20', verificationStatus: 'pending' }]);
  const payload = { ...PAYLOAD, birthDate: '2015-05-20', minorVerificationMethod: 'student_id', guardianLinkChoice: 'skip' };
  const result = await registerResident({ user: { ...USER, role: 'resident-limited' }, payload });
  assert.equal(result.id, RESIDENT.id);
  assert.equal(harness.calls.updates[0].patch.minorVerificationMethod, 'student_id');
  assert.equal(harness.calls.updates[0].options.expectedUpdatedAt, RESIDENT.updatedAt);
  assert.equal(harness.calls.activated.length, 0);
  harness.rows[0].authUserId = null;
  delete harness.rows[0].minorVerificationMethod;
  repository.updateResident = async () => null;
  await assert.rejects(registerResident({ user: USER, payload }), (error) => error.statusCode === 409);
});

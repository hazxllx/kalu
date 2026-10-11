// Existing-resident account activation (simplified "I already have a barangay
// health record" flow). These tests force the local file-driver repository (by
// clearing the Supabase env BEFORE importing) and then stub the repository
// methods the service calls, so the suite is deterministic and offline. The
// success path's best-effort getServiceClient().auth.admin call throws 503
// (unconfigured) and is swallowed by the service — no network is touched.

import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

const repository = (await import('../src/repositories/index.js')).default;
const {
  lookupExistingResident,
  activateExistingResident,
} = await import('../src/services/registration.service.js');

const USER = { id: '11111111-1111-4111-8111-111111111111', role: 'resident' };

/** Install an in-memory residents table behind the repository the service uses. */
const seed = (rows) => {
  const residents = rows.map((r) => ({ ...r }));
  const saved = {};
  for (const key of [
    'getResident', 'getResidentByAuthUserId', 'activateResidentById',
    'updateResident', 'setProfileStatus',
  ]) {
    saved[key] = repository[key];
  }
  const calls = { setProfileStatus: [] };
  repository.getResident = async (id) => residents.find((r) => r.id === id) || null;
  repository.getResidentByAuthUserId = async (authUserId) =>
    residents.find((r) => r.authUserId && r.authUserId === authUserId) || null;
  repository.activateResidentById = async ({ authUserId, residentId, birthDate }) => {
    const r = residents.find((x) => x.id === residentId && !x.authUserId && String(x.birthDate) === String(birthDate));
    if (!r) return null;
    r.authUserId = authUserId;
    return { ...r };
  };
  repository.updateResident = async (id, patch) => {
    const r = residents.find((x) => x.id === id);
    if (!r) return null;
    Object.assign(r, patch);
    return { ...r };
  };
  repository.setProfileStatus = async (authUserId, status) => {
    calls.setProfileStatus.push([authUserId, status]);
    return { id: authUserId, status };
  };
  const restore = () => Object.assign(repository, saved);
  return { residents, calls, restore };
};

const RESIDENT = {
  id: 'RES-000123',
  healthRecordNo: 'RHU-000123',
  firstName: 'Maria',
  lastName: 'Santos',
  birthDate: '1990-05-20',
  barangay: 'San Isidro',
  verificationStatus: 'approved',
  authUserId: null,
};

// --------------------------------------------------------------------------
// lookupExistingResident
// --------------------------------------------------------------------------
test('lookup: rejects an invalid Resident ID format', async () => {
  const h = seed([]);
  try {
    await assert.rejects(() => lookupExistingResident({ residentId: 'nope' }), /valid Resident ID/i);
  } finally { h.restore(); }
});

test('lookup: unknown Resident ID is a 404 with no personal data', async () => {
  const h = seed([]);
  try {
    await assert.rejects(() => lookupExistingResident({ residentId: 'RES-999999' }), /No resident record/i);
  } finally { h.restore(); }
});

test('lookup: an eligible unlinked record returns only { status: eligible }', async () => {
  const h = seed([{ ...RESIDENT }]);
  try {
    const result = await lookupExistingResident({ residentId: 'res-000123' });
    assert.deepEqual(result, { status: 'eligible' });
  } finally { h.restore(); }
});

test('lookup: an already-linked record returns { status: already_linked }', async () => {
  const h = seed([{ ...RESIDENT, authUserId: 'someone-else' }]);
  try {
    const result = await lookupExistingResident({ residentId: 'RES-000123' });
    assert.deepEqual(result, { status: 'already_linked' });
  } finally { h.restore(); }
});

// --------------------------------------------------------------------------
// activateExistingResident
// --------------------------------------------------------------------------
test('activate: requires a date of birth to verify identity', async () => {
  const h = seed([{ ...RESIDENT }]);
  try {
    await assert.rejects(
      () => activateExistingResident({ user: USER, residentId: 'RES-000123', birthDate: '' }),
      /date of birth/i,
    );
  } finally { h.restore(); }
});

test('activate: a Resident ID with a mismatched date of birth is refused', async () => {
  const h = seed([{ ...RESIDENT }]);
  try {
    await assert.rejects(
      () => activateExistingResident({ user: USER, residentId: 'RES-000123', birthDate: '2000-01-01' }),
      /does not match/i,
    );
    // The record must NOT have been linked.
    assert.equal(h.residents[0].authUserId, null);
  } finally { h.restore(); }
});

test('activate: a record linked to another account directs to login/recovery', async () => {
  const h = seed([{ ...RESIDENT, authUserId: 'another-account' }]);
  try {
    await assert.rejects(
      () => activateExistingResident({ user: USER, residentId: 'RES-000123', birthDate: '1990-05-20' }),
      /already has an account/i,
    );
  } finally { h.restore(); }
});

test('activate: a valid ID + matching DOB links the account to the existing record', async () => {
  const h = seed([{ ...RESIDENT }]);
  try {
    const result = await activateExistingResident({ user: USER, residentId: 'RES-000123', birthDate: '1990-05-20' });
    assert.equal(result.id, 'RES-000123');
    assert.equal(result.healthRecordNo, 'RHU-000123'); // HRN preserved
    assert.equal(result.alreadyLinked, false);
    // The existing record is now linked to this account — no new profile created.
    assert.equal(h.residents.length, 1);
    assert.equal(h.residents[0].authUserId, USER.id);
    // An approved record also activates the login account.
    assert.deepEqual(h.calls.setProfileStatus, [[USER.id, 'active']]);
  } finally { h.restore(); }
});

test('activate: a pending (not-yet-approved) record links without activating the login', async () => {
  const h = seed([{ ...RESIDENT, verificationStatus: 'pending' }]);
  try {
    const result = await activateExistingResident({ user: USER, residentId: 'RES-000123', birthDate: '1990-05-20' });
    assert.equal(result.id, 'RES-000123');
    assert.equal(h.residents[0].authUserId, USER.id);
    assert.deepEqual(h.calls.setProfileStatus, []); // not approved → no activation
  } finally { h.restore(); }
});

test('activate: idempotent when this account is already linked to the same record', async () => {
  const h = seed([{ ...RESIDENT, authUserId: USER.id }]);
  try {
    const result = await activateExistingResident({ user: USER, residentId: 'RES-000123', birthDate: '1990-05-20' });
    assert.equal(result.id, 'RES-000123');
    assert.equal(result.alreadyLinked, false);
    assert.equal(h.residents.length, 1); // no duplicate
  } finally { h.restore(); }
});

test('activate: refuses when the account is already linked to a DIFFERENT record', async () => {
  const h = seed([
    { ...RESIDENT, id: 'RES-000999', authUserId: USER.id },
    { ...RESIDENT },
  ]);
  try {
    await assert.rejects(
      () => activateExistingResident({ user: USER, residentId: 'RES-000123', birthDate: '1990-05-20' }),
      /already linked to this account/i,
    );
  } finally { h.restore(); }
});

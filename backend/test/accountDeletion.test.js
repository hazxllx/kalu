import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { deleteUser } from '../src/services/users.service.js';
import repository from '../src/repositories/index.js';

const migrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/20261012090000_admin_account_deletion.sql',
  import.meta.url,
));

const ADMIN_ACTOR = 'actor-admin-1';
const TARGET = 'target-user-9';

/**
 * Patch the shared repository singleton for one scenario and restore the
 * original methods afterwards, so each test runs against a clean contract.
 * `calls` records what the service invoked, in order, for ordering assertions.
 */
const withRepository = async (overrides, run) => {
  const keys = Object.keys(overrides);
  const originals = Object.fromEntries(keys.map((key) => [key, repository[key]]));
  Object.assign(repository, overrides);
  try {
    return await run();
  } finally {
    Object.assign(repository, originals);
  }
};

const baseProfile = (patch = {}) => ({
  id: TARGET,
  email: 'nurse@example.gov',
  name: 'Nurse Juana',
  role: 'phn',
  status: 'active',
  municipalityId: 'muni-1',
  barangayId: null,
  facilityId: null,
  ...patch,
});

test('deleteUser blocks an administrator from deleting their own account', async () => {
  await withRepository({
    getProfileById: async () => baseProfile({ id: ADMIN_ACTOR, role: 'admin' }),
  }, async () => {
    await assert.rejects(
      () => deleteUser({ id: ADMIN_ACTOR, actorId: ADMIN_ACTOR, confirmEmail: 'nurse@example.gov' }),
      (error) => error.statusCode === 409 && /your own/i.test(error.message),
    );
  });
});

test('deleteUser requires a matching email confirmation', async () => {
  await withRepository({ getProfileById: async () => baseProfile() }, async () => {
    await assert.rejects(
      () => deleteUser({ id: TARGET, actorId: ADMIN_ACTOR, confirmEmail: '' }),
      (error) => error.statusCode === 422 && /email/i.test(error.message),
    );
    await assert.rejects(
      () => deleteUser({ id: TARGET, actorId: ADMIN_ACTOR, confirmEmail: 'wrong@example.gov' }),
      (error) => error.statusCode === 422 && /does not match/i.test(error.message),
    );
  });
});

test('deleteUser refuses to delete the last active administrator', async () => {
  await withRepository({
    getProfileById: async () => baseProfile({ role: 'admin', email: 'admin@example.gov' }),
    countActiveAdmins: async () => 0,
    assertAccountDeletable: async () => { throw new Error('must not reach the DB guard'); },
    deleteAuthAccount: async () => { throw new Error('must not delete'); },
  }, async () => {
    await assert.rejects(
      () => deleteUser({ id: TARGET, actorId: ADMIN_ACTOR, confirmEmail: 'admin@example.gov' }),
      (error) => error.statusCode === 409 && /last active administrator/i.test(error.message),
    );
  });
});

test('deleteUser deletes the auth identity and records an audit entry on success', async () => {
  const calls = [];
  await withRepository({
    getProfileById: async () => baseProfile(),
    countActiveAdmins: async () => 1,
    assertAccountDeletable: async (args) => { calls.push(['assert', args]); return { id: TARGET, email: 'nurse@example.gov', full_name: 'Nurse Juana', role: 'phn', status: 'active', municipality_id: 'muni-1', barangay_id: null, facility_id: null }; },
    deleteAuthAccount: async (id) => { calls.push(['delete', id]); },
    insertHealthAuditLog: async (log) => { calls.push(['audit', log]); },
  }, async () => {
    const result = await deleteUser({ id: TARGET, actorId: ADMIN_ACTOR, confirmEmail: 'Nurse@Example.gov' });
    assert.deepEqual(result, { deleted: true, id: TARGET });

    // The DB guard must run before the irreversible auth deletion, and the audit
    // record must be written only after a confirmed deletion.
    assert.deepEqual(calls.map((entry) => entry[0]), ['assert', 'delete', 'audit']);

    const auditLog = calls.find((entry) => entry[0] === 'audit')[1];
    assert.equal(auditLog.action, 'ACCOUNT_DELETED');
    assert.equal(auditLog.entityType, 'profiles');
    assert.equal(auditLog.entityId, TARGET);
    assert.equal(auditLog.actorId, ADMIN_ACTOR);
    assert.equal(auditLog.metadata.email, 'nurse@example.gov');
    // No secrets are ever recorded.
    assert.ok(!('password' in auditLog.metadata) && !('token' in auditLog.metadata));
  });
});

test('deleteUser does not write an audit entry or report success if the auth deletion fails', async () => {
  const calls = [];
  await withRepository({
    getProfileById: async () => baseProfile(),
    countActiveAdmins: async () => 1,
    assertAccountDeletable: async () => ({ id: TARGET, email: 'nurse@example.gov', role: 'phn', status: 'active' }),
    deleteAuthAccount: async () => { const error = new Error('Supabase Auth is unavailable'); error.statusCode = 502; throw error; },
    insertHealthAuditLog: async (log) => { calls.push(log); },
  }, async () => {
    await assert.rejects(
      () => deleteUser({ id: TARGET, actorId: ADMIN_ACTOR, confirmEmail: 'nurse@example.gov' }),
      (error) => error.statusCode === 502,
    );
    assert.equal(calls.length, 0, 'no ACCOUNT_DELETED audit entry may be written when deletion fails');
  });
});

test('account-deletion migration enforces the safety invariants in the database', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /pg_advisory_xact_lock\(734920184\)/);
  assert.match(sql, /role = 'admin' and status = 'active'/); // active-admin actor check
  assert.match(sql, /You cannot delete your own administrator account/);
  assert.match(sql, /last active Administrator/);
  assert.match(sql, /grant execute on function public\.admin_assert_account_deletable\(uuid, uuid\) to service_role/);
  // The guard performs NO mutation (deletion is done via the Auth admin API).
  assert.doesNotMatch(sql, /delete from public\.profiles/i);
  assert.doesNotMatch(sql, /delete from auth\.users/i);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { ROLES } from '../src/config/roles.js';
import { getPermissionMatrix, updateRolePermissions } from '../src/services/roles.service.js';

const rows = [
  { role: ROLES.ADMIN, permission_id: 'admin.manage', granted: true },
  { role: ROLES.MHO, permission_id: 'mho.view', granted: true },
  { role: ROLES.PHN, permission_id: 'phn.view', granted: true },
  { role: ROLES.HEALTH_SUPERVISOR, permission_id: 'health_supervisor.view', granted: true },
  { role: ROLES.RHU_PERSONNEL, permission_id: 'rhu_personnel.view', granted: true },
  { role: ROLES.BHW, permission_id: 'bhw.view', granted: true },
  { role: ROLES.RESIDENT, permission_id: 'resident.view', granted: true },
];

test('permission updates reject truthy nonboolean values before any database access', async () => {
  const supabase = { from: () => { throw new Error('Invalid permission values must never reach the database'); } };
  for (const value of ['false', 'true', 0, 1, null, [], {}]) {
    await assert.rejects(() => updateRolePermissions({
      user: { id: 'admin', role: ROLES.ADMIN }, role: ROLES.PHN,
      permissions: { 'accounts.roles.manage': value }, supabase,
    }), (error) => error.statusCode === 400 && /true or false/.test(error.message));
  }
});

test('permission revocation sends boolean false through the atomic audited RPC', async () => {
  const supabase = { rpc: async (name, input) => {
    assert.equal(name, 'admin_save_role_permissions');
    assert.deepEqual(input, { p_actor_id: 'admin', p_role: ROLES.PHN, p_permissions: { 'accounts.roles.manage': false } });
    return { data: { role: ROLES.PHN, permissions: input.p_permissions, changed: 1 } };
  } };
  const result = await updateRolePermissions({ user: { id: 'admin', role: ROLES.ADMIN },
    role: ROLES.PHN, permissions: { 'accounts.roles.manage': false }, supabase });
  assert.deepEqual(result, { role: ROLES.PHN, permissions: { 'accounts.roles.manage': false }, changed: 1 });
});

test('database permission denial remains forbidden instead of a generic server error', async () => {
  await assert.rejects(() => updateRolePermissions({
    user: { id: 'admin', role: ROLES.ADMIN }, role: ROLES.PHN, permissions: {},
    supabase: { rpc: async () => ({ error: { code: '42501' } }) },
  }), (error) => error.statusCode === 403);
});

test('shared administrator permissions cannot remove every administrator permission-management capability', async () => {
  await assert.rejects(() => updateRolePermissions({
    user: { id: 'admin', role: ROLES.ADMIN }, role: ROLES.ADMIN,
    permissions: { 'accounts.roles.manage': false },
    supabase: { rpc: () => { throw new Error('Invalid last-administrator access change must not be persisted'); } },
  }), (error) => error.statusCode === 409);
});

const createSupabase = () => {
  const query = {
    roleFilter: null,
    select() {
      return this;
    },
    eq(column, value) {
      assert.equal(column, 'role');
      this.roleFilter = value;
      return this;
    },
    then(resolve, reject) {
      const result = rows.filter((row) => !this.roleFilter || row.role === this.roleFilter);
      return Promise.resolve({ data: result, error: null }).then(resolve, reject);
    },
  };
  return {
    from(table) {
      assert.equal(table, 'role_permissions');
      return query;
    },
  };
};

for (const role of [
  ROLES.RESIDENT,
  ROLES.BHW,
  ROLES.RHU_PERSONNEL,
  ROLES.PHN,
  ROLES.HEALTH_SUPERVISOR,
  ROLES.MHO,
]) {
  test(`${role} receives only its own permission rows`, async () => {
    const matrix = await getPermissionMatrix({
      user: { id: 'authenticated-user', role },
      supabase: createSupabase(),
    });
    assert.deepEqual(Object.keys(matrix), [role]);
    assert.deepEqual(matrix[role], { [`${role}.view`]: true });
  });
}

test('pending residents receive only the resident permission rows', async () => {
  const matrix = await getPermissionMatrix({
    user: { id: 'authenticated-user', role: ROLES.RESIDENT_LIMITED },
    supabase: createSupabase(),
  });
  assert.deepEqual(matrix, { [ROLES.RESIDENT]: { 'resident.view': true } });
});

test('admins receive the full matrix required to manage role permissions', async () => {
  const matrix = await getPermissionMatrix({
    user: { id: 'authenticated-admin', role: ROLES.ADMIN },
    supabase: createSupabase(),
  });
  assert.deepEqual(Object.keys(matrix).sort(), Object.values(ROLES).filter((role) => role !== ROLES.RESIDENT_LIMITED).sort());
});

test('the matrix endpoint service rejects requests without an authenticated user', async () => {
  await assert.rejects(
    getPermissionMatrix({ user: null, supabase: createSupabase() }),
    (error) => error.statusCode === 401,
  );
});

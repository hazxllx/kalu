import assert from 'node:assert/strict';
import test from 'node:test';

import { ROLES } from '../src/config/roles.js';
import { getPermissionMatrix } from '../src/services/roles.service.js';

const rows = [
  { role: ROLES.ADMIN, permission_id: 'admin.manage', granted: true },
  { role: ROLES.MHO, permission_id: 'mho.view', granted: true },
  { role: ROLES.PHN, permission_id: 'phn.view', granted: true },
  { role: ROLES.HEALTH_SUPERVISOR, permission_id: 'health_supervisor.view', granted: true },
  { role: ROLES.RHU_PERSONNEL, permission_id: 'rhu_personnel.view', granted: true },
  { role: ROLES.BHW, permission_id: 'bhw.view', granted: true },
  { role: ROLES.RESIDENT, permission_id: 'resident.view', granted: true },
];

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

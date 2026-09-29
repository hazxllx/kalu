import test from 'node:test';
import assert from 'node:assert/strict';

import * as roles from '../src/services/roles.service.js';

/**
 * BUG-011 — the role/permission matrix is authoritative in the database and is
 * admin-writable only. These tests exercise the service against an in-memory
 * stub of public.role_permissions + public.health_audit_logs.
 */

const makeStub = () => {
  const rolePerms = []; // {role, permission_id, granted, updated_by}
  const audit = [];
  return {
    _rolePerms: rolePerms,
    _audit: audit,
    from(table) {
      if (table === 'role_permissions') {
        const q = {
          _role: null,
          select() { return this; },
          eq(col, val) { if (col === 'role') this._role = val; return this; },
          then(resolve) {
            const rows = this._role == null ? rolePerms : rolePerms.filter((r) => r.role === this._role);
            resolve({ data: rows.map((r) => ({ ...r })), error: null });
          },
          async upsert(rows) {
            for (const row of rows) {
              const i = rolePerms.findIndex((r) => r.role === row.role && r.permission_id === row.permission_id);
              if (i >= 0) rolePerms[i] = { ...rolePerms[i], ...row };
              else rolePerms.push({ ...row });
            }
            return { error: null };
          },
        };
        return q;
      }
      if (table === 'health_audit_logs') {
        return {
          async insert(rows) { audit.push(...rows); return { error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
};

const ADMIN = { id: 'admin-1', role: 'admin' };
const PHN = { id: 'phn-1', role: 'phn' };

test('BUG-011: an administrator can persist a role permission change (and it is audited)', async () => {
  const supabase = makeStub();
  const result = await roles.updateRolePermissions({
    user: ADMIN,
    role: 'health_supervisor',
    permissions: { 'referrals.approve': true, 'referrals.delete': false },
    supabase,
  });
  assert.equal(result.role, 'health_supervisor');
  assert.equal(result.permissions['referrals.approve'], true);
  assert.equal(result.changed, 2); // both are new/changed
  assert.equal(supabase._audit.length, 2);
  assert.ok(supabase._audit.every((a) => a.entity_type === 'role_permissions' && a.actor_id === 'admin-1'));
});

test('BUG-011: a non-admin cannot change permissions (403)', async () => {
  const supabase = makeStub();
  await assert.rejects(
    () => roles.updateRolePermissions({
      user: PHN,
      role: 'phn',
      permissions: { 'users.manage': true },
      supabase,
    }),
    (e) => e.statusCode === 403,
  );
  assert.equal(supabase._rolePerms.length, 0, 'nothing was written');
});

test('BUG-011: an unmanaged/unknown role is rejected (400)', async () => {
  const supabase = makeStub();
  await assert.rejects(
    () => roles.updateRolePermissions({ user: ADMIN, role: 'wizard', permissions: {}, supabase }),
    (e) => e.statusCode === 400,
  );
});

test('BUG-011: the matrix reads back the persisted overrides', async () => {
  const supabase = makeStub();
  await roles.updateRolePermissions({
    user: ADMIN,
    role: 'phn',
    permissions: { 'reports.send': true },
    supabase,
  });
  const matrix = await roles.getPermissionMatrix({ user: ADMIN, supabase });
  assert.equal(matrix.phn['reports.send'], true);
});

test('BUG-011: re-saving the same values records no new audit entries', async () => {
  const supabase = makeStub();
  await roles.updateRolePermissions({ user: ADMIN, role: 'phn', permissions: { 'reports.send': true }, supabase });
  const second = await roles.updateRolePermissions({ user: ADMIN, role: 'phn', permissions: { 'reports.send': true }, supabase });
  assert.equal(second.changed, 0);
  assert.equal(supabase._audit.length, 1, 'only the first change was audited');
});

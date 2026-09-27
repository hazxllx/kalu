import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import repository from '../src/repositories/index.js';
import * as service from '../src/services/users.service.js';

/**
 * Admin User Management service tests.
 *
 * Following the project harness: the repository singleton's methods are
 * monkey-patched with in-memory stubs, the service layer is exercised directly,
 * and error cases assert on `statusCode`. Route-level authorization
 * (unauthenticated 401 / non-admin 403 / admin 200) is enforced by
 * authenticate + authorize(FEATURE_ROLES.users) and is verified against the
 * live API, not here.
 */

const STUBBED = ['listProfiles', 'getProfileById', 'updateProfileFields', 'countActiveAdmins'];
const original = {};

let store; // id -> profile-user object
let updateCalls;
let activeAdminCount;

const makeUser = (over = {}) => ({
  id: over.id || 'u1',
  email: over.email || 'user@example.test',
  name: over.name || 'Test User',
  role: over.role || 'phn',
  status: over.status || 'active',
  municipalityId: over.municipalityId ?? 'muni-1',
  municipality: over.municipality ?? 'Pili',
  barangayId: over.barangayId ?? null,
  barangay: over.barangay ?? null,
  facilityId: over.facilityId ?? null,
  position: over.position ?? '',
  licenseNo: over.licenseNo ?? '',
  contact: over.contact ?? '',
  createdAt: over.createdAt ?? '2026-01-01T00:00:00Z',
  updatedAt: over.updatedAt ?? '2026-01-01T00:00:00Z',
});

before(() => {
  for (const k of STUBBED) original[k] = repository[k];

  repository.listProfiles = async ({ q = '', role = null, status = null, limit = 50, offset = 0 } = {}) => {
    let rows = [...store.values()];
    if (role) rows = rows.filter((r) => r.role === role);
    if (status) rows = rows.filter((r) => r.status === status);
    if (q) {
      const term = q.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(term) || r.email.toLowerCase().includes(term));
    }
    const total = rows.length;
    return { rows: rows.slice(offset, offset + limit), total };
  };
  repository.getProfileById = async (id) => store.get(id) || null;
  repository.updateProfileFields = async (id, fields) => {
    updateCalls.push({ id, fields });
    const existing = store.get(id);
    if (!existing) return null;
    // Emulate the DB mapping back to the curated user shape.
    const updated = { ...existing };
    if (fields.full_name !== undefined) updated.name = fields.full_name || existing.email;
    if (fields.contact !== undefined) updated.contact = fields.contact;
    if (fields.position !== undefined) updated.position = fields.position;
    if (fields.license_no !== undefined) updated.licenseNo = fields.license_no;
    if (fields.role !== undefined) updated.role = fields.role;
    if (fields.status !== undefined) updated.status = fields.status;
    if (fields.barangay_id !== undefined) updated.barangayId = fields.barangay_id;
    store.set(id, updated);
    return updated;
  };
  repository.countActiveAdmins = async ({ excludeId = null } = {}) => {
    let count = 0;
    for (const r of store.values()) {
      if (r.role === 'admin' && r.status !== 'disabled' && r.id !== excludeId) count += 1;
    }
    activeAdminCount = count;
    return count;
  };
});

after(() => {
  for (const k of STUBBED) repository[k] = original[k];
});

beforeEach(() => {
  store = new Map();
  updateCalls = [];
  activeAdminCount = null;
});

test('listUsers returns rows and total from the repository', async () => {
  store.set('a', makeUser({ id: 'a', role: 'admin', name: 'Admin One' }));
  store.set('b', makeUser({ id: 'b', role: 'phn', name: 'Nurse Two' }));
  const result = await service.listUsers({});
  assert.equal(result.total, 2);
  assert.equal(result.rows.length, 2);
});

test('listUsers rejects an invalid role filter (400)', async () => {
  await assert.rejects(() => service.listUsers({ role: 'superuser' }), (e) => e.statusCode === 400);
});

test('listUsers rejects an invalid status filter (400)', async () => {
  await assert.rejects(() => service.listUsers({ status: 'banned' }), (e) => e.statusCode === 400);
});

test('list results carry no secret fields', async () => {
  store.set('a', makeUser({ id: 'a' }));
  const { rows } = await service.listUsers({});
  const secretish = ['password', 'password_hash', 'passwordHash', 'access_token', 'accessToken', 'refresh_token', 'refreshToken', 'token', 'otp'];
  for (const key of secretish) assert.ok(!(key in rows[0]), `unexpected secret field: ${key}`);
});

test('getUser returns 404 for an unknown id', async () => {
  await assert.rejects(() => service.getUser({ id: 'missing' }), (e) => e.statusCode === 404);
});

test('updateUser returns 404 for an unknown id', async () => {
  await assert.rejects(() => service.updateUser({ id: 'missing', patch: { name: 'x' } }), (e) => e.statusCode === 404);
});

test('updateUser rejects an invalid role (422)', async () => {
  store.set('b', makeUser({ id: 'b', role: 'phn' }));
  await assert.rejects(() => service.updateUser({ id: 'b', patch: { role: 'wizard' } }), (e) => e.statusCode === 422);
});

test('updateUser rejects an invalid status (422)', async () => {
  store.set('b', makeUser({ id: 'b' }));
  await assert.rejects(() => service.updateUser({ id: 'b', patch: { status: 'frozen' } }), (e) => e.statusCode === 422);
});

test('updateUser persists profile fields, role and status', async () => {
  store.set('b', makeUser({ id: 'b', role: 'phn', status: 'pending_verification' }));
  const updated = await service.updateUser({
    id: 'b',
    patch: { name: 'Renamed Nurse', contact: '0917 000 0000', role: 'mho', status: 'active' },
  });
  assert.equal(updated.role, 'mho');
  assert.equal(updated.status, 'active');
  assert.equal(updated.name, 'Renamed Nurse');
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].fields.role, 'mho');
  assert.equal(updateCalls[0].fields.status, 'active');
  assert.equal(updateCalls[0].fields.full_name, 'Renamed Nurse');
});

test('updateUser rejects a barangay assignment for a non-scoped role (422)', async () => {
  store.set('b', makeUser({ id: 'b', role: 'phn' }));
  await assert.rejects(
    () => service.updateUser({ id: 'b', patch: { barangayId: 'brgy-1' } }),
    (e) => e.statusCode === 422,
  );
});

test('updateUser clears the barangay when a scoped role becomes non-scoped', async () => {
  store.set('b', makeUser({ id: 'b', role: 'health_supervisor', barangayId: 'brgy-1', barangay: 'San Isidro' }));
  const updated = await service.updateUser({ id: 'b', patch: { role: 'mho' } });
  assert.equal(updated.role, 'mho');
  assert.equal(updateCalls[0].fields.barangay_id, null);
});

test('last-admin safeguard blocks demoting the only active admin (409)', async () => {
  store.set('a', makeUser({ id: 'a', role: 'admin', status: 'active' }));
  await assert.rejects(
    () => service.updateUser({ id: 'a', patch: { role: 'phn' } }),
    (e) => e.statusCode === 409,
  );
});

test('last-admin safeguard blocks disabling the only active admin (409)', async () => {
  store.set('a', makeUser({ id: 'a', role: 'admin', status: 'active' }));
  await assert.rejects(
    () => service.updateUser({ id: 'a', patch: { status: 'disabled' } }),
    (e) => e.statusCode === 409,
  );
});

test('demoting an admin is allowed when another active admin remains', async () => {
  store.set('a', makeUser({ id: 'a', role: 'admin', status: 'active' }));
  store.set('a2', makeUser({ id: 'a2', role: 'admin', status: 'active' }));
  const updated = await service.updateUser({ id: 'a', patch: { role: 'phn' } });
  assert.equal(updated.role, 'phn');
});

test('updateUser never writes the email field', async () => {
  store.set('b', makeUser({ id: 'b', email: 'orig@example.test' }));
  await service.updateUser({ id: 'b', patch: { email: 'changed@example.test', name: 'New Name' } });
  assert.equal(updateCalls.length, 1);
  assert.ok(!('email' in updateCalls[0].fields), 'email must not be updated on profiles');
});

test('updateUser with no recognized fields is a no-op that returns the record', async () => {
  store.set('b', makeUser({ id: 'b', name: 'Same' }));
  const updated = await service.updateUser({ id: 'b', patch: { unknownField: 'x' } });
  assert.equal(updated.name, 'Same');
  assert.equal(updateCalls.length, 0);
});

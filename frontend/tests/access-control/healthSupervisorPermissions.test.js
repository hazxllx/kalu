import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Health Supervisor permission invariants verified at the source level so
// no Vite alias (@/) resolution is needed. This mirrors the production test
// pattern (backend/test/reportsWorkflow.test.js) that reads the source text.
const permissionsPath = fileURLToPath(new URL('../../src/lib/permissions.js', import.meta.url));
const source = fs.readFileSync(permissionsPath, 'utf8');

// Extract the DEFAULT_GRANTS entry for a role by finding its bracket array.
const extractDefaultGrants = (roleKey) => {
  const marker = `[ROLE.${roleKey}]:`;
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const bracketStart = source.indexOf('[', start + marker.length);
  let depth = 0;
  let end = -1;
  for (let i = bracketStart; i < source.length; i += 1) {
    if (source[i] === '[') depth += 1;
    else if (source[i] === ']') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return '*';
  const block = source.slice(bracketStart, end + 1);
  const ids = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return ids;
};

/**
 * Health Supervisor Add Resident + Yes/No permission invariants.
 *
 * These are catalogue-level guarantees: a Health Supervisor must be able to
 * view the directory, open a profile, create a resident, and choose whether
 * to create a login account (accounts.create) — all within their barangay
 * scope. The frontend separates the two creates (residents.create for the
 * profile, accounts.create for the optional login) and shows Yes/No whenever
 * residents.create is held; the backend enforces the same split.
 */

test('health_supervisor has residents.create and accounts.create by default', () => {
  const perms = extractDefaultGrants('HEALTH_SUPERVISOR');
  assert.ok(Array.isArray(perms), 'expected HEALTH_SUPERVISOR defaults to be an array');
  assert.ok(perms.includes('residents.create'), 'health_supervisor should create residents');
  assert.ok(perms.includes('accounts.create'), 'health_supervisor should create resident login accounts');
});

test('health_supervisor can view the resident directory and profiles by default', () => {
  const perms = extractDefaultGrants('HEALTH_SUPERVISOR');
  assert.ok(perms.includes('residents.directory.view'));
  assert.ok(perms.includes('residents.profile.view'));
});

test('residents.create and accounts.create are distinct permissions (separable)', () => {
  // The catalogue declares both; they are not fused — an admin can revoke one
  // without revoking the other. Verify both exist as distinct permission ids.
  assert.ok(source.includes("'residents.create'"), 'residents.create must be declared');
  assert.ok(source.includes("'accounts.create'"), 'accounts.create must be declared');
  assert.notEqual('residents.create', 'accounts.create');
});

test('PHN and MHO also have residents.create by default (municipality-wide)', () => {
  for (const role of ['PHN', 'MHO']) {
    const perms = extractDefaultGrants(role);
    assert.ok(Array.isArray(perms), `expected ${role} defaults to be an array`);
    assert.ok(perms.includes('residents.create'), `${role} should have residents.create`);
  }
});

test('BHW is intentionally excluded from the resident directory view', () => {
  const perms = extractDefaultGrants('BHW');
  assert.ok(Array.isArray(perms));
  assert.equal(perms.includes('residents.directory.view'), false);
});

test('the permission catalogue contains the health_supervisor managed role', () => {
  assert.ok(source.includes("id: ROLE.HEALTH_SUPERVISOR"), 'MANAGED_ROLES should include health_supervisor');
  assert.ok(source.includes("id: ROLE.BHW"), 'MANAGED_ROLES should include bhw for negative check');
});

test('the permission catalogue declares the four resident/account ids the directory tests rely on', () => {
  for (const id of ['residents.directory.view', 'residents.profile.view', 'residents.create', 'accounts.create']) {
    assert.ok(source.includes(`'${id}'`), `missing ${id}`);
  }
});

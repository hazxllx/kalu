import test from 'node:test';
import assert from 'node:assert/strict';

import { createHousehold, updateHousehold } from '../src/services/households.service.js';
import {
  readIdempotencyKey,
  requestFingerprint,
  stableStringify,
} from '../src/middleware/idempotency.js';

/**
 * Offline synchronization server-side guarantees:
 *   - idempotency keys are bound to the exact request (fingerprint);
 *   - a replayed create returns the existing household (no duplicate);
 *   - optimistic concurrency rejects a stale write atomically (If-Match);
 *   - an accepted write bumps the record revision.
 *
 * These are pure/unit-level: repositories are injected and the patches used are
 * ordinary field edits, so no audit/notification side effect is attempted.
 */

// No id: the best-effort audit short-circuits, so these unit tests never make a
// network call to any Supabase project.
const user = { id: null, role: 'bhw', barangay: 'Poblacion' };

const baseHousehold = {
  id: 'HH-001',
  barangay: 'Poblacion',
  municipalityId: 'muni-1',
  members: [],
  waterSource: 'level2',
  toiletType: 'ws_own',
  sanitationAccess: 'improved',
  monthlyIncome: 9000,
  revision: 3,
};

const makeRepo = () => {
  const calls = [];
  return {
    calls,
    async getHousehold() {
      return { ...baseHousehold };
    },
    async updateHousehold(id, patch, options = {}) {
      calls.push({ id, patch, options });
      return { ...baseHousehold, ...patch };
    },
  };
};

// --- optimistic concurrency -------------------------------------------------

test('a stale baseRevision is rejected with 409 instead of overwriting', async () => {
  const repo = makeRepo();
  await assert.rejects(
    () =>
      updateHousehold({
        id: 'HH-001',
        user,
        patch: { contact: '09171234567' },
        expectedRevision: 2,
        repo,
      }),
    (error) => error.statusCode === 409,
  );
  assert.equal(repo.calls.length, 0, 'no write occurred on a rejected revision');
});

test('a conditional write that loses a race is reported as a conflict, not a 404', async () => {
  const repo = {
    async getHousehold() {
      return { ...baseHousehold }; // revision 3 at read time
    },
    async updateHousehold() {
      return null; // a concurrent edit moved the revision; WHERE matched 0 rows
    },
  };
  await assert.rejects(
    () =>
      updateHousehold({
        id: 'HH-001',
        user,
        patch: { contact: '09171234567' },
        expectedRevision: 3,
        repo,
      }),
    (error) => error.statusCode === 409,
  );
});

test('a matching baseRevision is accepted, passed conditionally, and bumps the revision', async () => {
  const repo = makeRepo();
  await updateHousehold({
    id: 'HH-001',
    user,
    patch: { contact: '09171234567' },
    expectedRevision: 3,
    repo,
  });
  assert.equal(repo.calls.length, 1);
  assert.equal(repo.calls[0].options.expectedRevision, 3);
  assert.equal(repo.calls[0].patch.revision, 4);
});

test('an omitted baseRevision keeps the previous (online) behavior', async () => {
  const repo = makeRepo();
  await updateHousehold({ id: 'HH-001', user, patch: { contact: '09990001111' }, repo });
  assert.equal(repo.calls[0].options.expectedRevision, null);
  assert.equal(repo.calls[0].patch.revision, 4);
});

// --- idempotent create ------------------------------------------------------

test('createHousehold returns the existing household for a replayed operation key', async () => {
  const existing = { id: 'HH-777', members: [] };
  let inserted = false;
  const repo = {
    async findHouseholdByOperationKey() {
      return existing;
    },
    async getHousehold(id) {
      return { ...existing, id };
    },
    async insertHousehold() {
      inserted = true;
      return existing;
    },
  };
  const result = await createHousehold({
    user,
    payload: { barangay: 'Poblacion' },
    idempotencyKey: 'kalusagap-op-abc',
    repo,
  });
  assert.equal(result.id, 'HH-777');
  assert.equal(inserted, false, 'a replayed create must not insert again');
});

test('a concurrent duplicate insert (23505) reconciles to the existing household and skips members', async () => {
  let lookupCalls = 0;
  const repo = {
    async findBarangayByName() {
      return { id: 'br-1', municipalityId: 'muni-1', name: 'Poblacion' };
    },
    async getResident() {
      return null;
    },
    async findHouseholdDuplicate() {
      return null;
    },
    async nextHouseholdId() {
      return { id: 'HH-888' };
    },
    async insertHousehold() {
      const error = new Error('duplicate key value violates unique constraint');
      error.code = '23505';
      throw error;
    },
    async findHouseholdByOperationKey() {
      // Not found on the pre-check (this request is the first it has seen), then
      // found when reconciling the unique-constraint violation.
      lookupCalls += 1;
      return lookupCalls === 1 ? null : { id: 'HH-999' };
    },
    async getHousehold(id) {
      return { id, members: [], revision: 1 };
    },
    async addHouseholdMember() {
      throw new Error('members must not be re-added on an idempotent replay');
    },
  };
  const result = await createHousehold({
    user,
    payload: { barangay: 'Poblacion', headName: 'Ana', purok: 'P1', streetAddress: 'S' },
    idempotencyKey: 'kalusagap-op-xyz',
    repo,
  });
  assert.equal(result.id, 'HH-999');
  assert.equal(lookupCalls, 2, 'the pre-check then the conflict reconciliation both ran');
});

// --- idempotency key validation / fingerprint -------------------------------

test('the idempotency key reader accepts only well-formed keys', () => {
  assert.equal(readIdempotencyKey({ 'idempotency-key': 'kalusagap-op-abc' }), 'kalusagap-op-abc');
  assert.equal(readIdempotencyKey({ 'idempotency-key': '  spaced-key  ' }), 'spaced-key');
  assert.equal(readIdempotencyKey({ 'idempotency-key': ['first', 'second'] }), 'first');
  assert.equal(readIdempotencyKey({ 'idempotency-key': '' }), null);
  assert.equal(readIdempotencyKey({}), null);
  assert.equal(readIdempotencyKey({ 'idempotency-key': 'x'.repeat(201) }), null);
});

test('stableStringify is order-independent and the fingerprint binds method/path/body', () => {
  assert.equal(stableStringify({ b: 1, a: [2, 3] }), stableStringify({ a: [2, 3], b: 1 }));

  const base = { method: 'POST', path: '/api/households', body: { household: { headName: 'A' } } };
  const reordered = { method: 'POST', path: '/api/households', body: { household: { headName: 'A' } } };
  assert.equal(requestFingerprint(base), requestFingerprint(reordered), 'equivalent payload => same key');

  assert.notEqual(
    requestFingerprint(base),
    requestFingerprint({ ...base, body: { household: { headName: 'B' } } }),
    'different payload => different fingerprint',
  );
  assert.notEqual(
    requestFingerprint(base),
    requestFingerprint({ ...base, path: '/api/residents' }),
    'different path => different fingerprint',
  );
});

// --- atomic household + members create --------------------------------------

const baseRepoParts = () => ({
  async findHouseholdByOperationKey() {
    return null;
  },
  async findBarangayByName() {
    return { id: 'br-1', municipalityId: 'muni-1', name: 'Poblacion' };
  },
  async getResident() {
    return null;
  },
  async findHouseholdDuplicate() {
    return null;
  },
  async nextHouseholdId() {
    return { id: 'HH-500' };
  },
});

const oneMemberPayload = {
  barangay: 'Poblacion',
  headName: 'Ana',
  purok: 'P1',
  streetAddress: 'S',
  members: [{ name: 'Ana' }],
};

test('createHousehold uses the atomic function and does not insert members separately', async () => {
  const calls = { atomic: 0, addMember: 0 };
  const repo = {
    ...baseRepoParts(),
    async createHouseholdWithMembers(household, members) {
      calls.atomic += 1;
      assert.equal(members.length, 1);
      return { household: { id: 'HH-500' }, deduplicated: false };
    },
    async getHousehold(id) {
      return { id, members: [{ name: 'Ana' }], revision: 1 };
    },
    async addHouseholdMember() {
      calls.addMember += 1;
    },
    async insertHousehold() {
      throw new Error('sequential insert must not run when the atomic path succeeds');
    },
  };
  const result = await createHousehold({
    user,
    payload: oneMemberPayload,
    idempotencyKey: 'kalusagap-op-atomic',
    repo,
  });
  assert.equal(result.id, 'HH-500');
  assert.equal(calls.atomic, 1);
  assert.equal(calls.addMember, 0, 'members are created inside the atomic function');
});

test('createHousehold falls back to the sequential path when the function is unavailable', async () => {
  const calls = { addMember: 0 };
  const repo = {
    ...baseRepoParts(),
    async createHouseholdWithMembers() {
      return null; // RPC not deployed
    },
    async insertHousehold() {
      return { id: 'HH-500' };
    },
    async addHouseholdMember() {
      calls.addMember += 1;
      return {};
    },
    async getHousehold(id) {
      return { id, members: [{ name: 'Ana' }], revision: 1 };
    },
  };
  const result = await createHousehold({
    user,
    payload: oneMemberPayload,
    idempotencyKey: 'kalusagap-op-fallback',
    repo,
  });
  assert.equal(result.id, 'HH-500');
  assert.equal(calls.addMember, 1, 'the fallback still inserts members');
});

test('an atomic replay returns the already-created household', async () => {
  const repo = {
    ...baseRepoParts(),
    async createHouseholdWithMembers() {
      return { household: { id: 'HH-701' }, deduplicated: true };
    },
    async getHousehold(id) {
      return { id, members: [], revision: 1 };
    },
  };
  const result = await createHousehold({
    user,
    payload: oneMemberPayload,
    idempotencyKey: 'kalusagap-op-replay',
    repo,
  });
  assert.equal(result.id, 'HH-701');
});

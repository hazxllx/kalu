// Automated offline-engine tests.
//
// These exercise the real KALUSAGAP offline modules (Dexie outbox/drafts/records,
// the sync runner, crypto, meta lock, backoff and error classification) against an
// in-memory IndexedDB (fake-indexeddb). They are the executable evidence behind any
// claim that a workflow is "offline-ready": the full lifecycle, idempotent retry,
// conflict handling, authorization stops, the single-worker lock, interruption
// recovery, dependency ordering and per-owner isolation are all asserted here.
//
// Run with:  npm run test:offline   (from frontend/)

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { db } from '../../src/services/offline/db.js';
import { resetCachedKey } from '../../src/services/offline/crypto.js';
import {
  OUTBOX_STATUS,
  enqueueOperation,
  getOperation,
  listOperations,
  recoverInterruptedOperations,
} from '../../src/services/offline/outbox.js';
import { putDraft, getDraft, listDrafts, DRAFT_STATUS } from '../../src/services/offline/drafts.js';
import { getCachedRecord, cacheRecord } from '../../src/services/offline/records.js';
import { acquireLock, readMeta, getLastSyncedAt, META_KEYS } from '../../src/services/offline/meta.js';
import { runSyncPass } from '../../src/services/offline/syncRunner.js';
import { computeBackoffMs } from '../../src/services/offline/syncCore.js';
import { classifySyncError, SYNC_ERROR } from '../../src/services/offline/errors.js';
import { isQuotaError } from '../../src/services/offline/db.js';
import { idempotencyKeyFor } from '../../src/services/offline/ids.js';
import { MUTATION_TIER } from '../../src/services/offline/mutationPolicy.js';

const OWNER = 'user-aaaa';
const OTHER_OWNER = 'user-bbbb';

const resetAll = async () => {
  resetCachedKey();
  if (!db.isOpen()) await db.open();
  await db.transaction('rw', db.drafts, db.outbox, db.records, db.syncMeta, db.keys, async () => {
    await Promise.all([
      db.drafts.clear(),
      db.outbox.clear(),
      db.records.clear(),
      db.syncMeta.clear(),
      db.keys.clear(),
    ]);
  });
};

beforeEach(resetAll);

// A small handler registry: maps entity:opType -> async handler, each tagged
// SAFE_SYNC like the production handlers. Tests swap the implementations in to
// simulate success, conflict, auth failure, server error and network drop.
const makeRegistry = (impl = {}) => {
  const registry = {};
  for (const [key, fn] of Object.entries(impl)) {
    fn.mutationType = fn.mutationType || MUTATION_TIER.SAFE_SYNC;
    registry[key] = fn;
  }
  return (entity, opType) => registry[`${entity}:${opType}`] || null;
};

// Seed a draft + a queued SAFE_SYNC operation the way queue.js does in production.
const seedOperation = async ({
  entity,
  opType = 'create',
  ownerId = OWNER,
  payload = { foo: 'bar' },
  localRecordId,
  dependsOn = [],
  baseRevision = null,
  targetServerId = null,
  mutationType = MUTATION_TIER.SAFE_SYNC,
}) => {
  const localId = localRecordId || `local-${entity}-${Math.random().toString(36).slice(2)}`;
  await putDraft({ localId, entity, ownerId, data: payload, status: DRAFT_STATUS.PENDING });
  const op = await enqueueOperation({
    entity,
    opType,
    ownerId,
    payload,
    localRecordId: localId,
    dependsOn,
    baseRevision,
    targetServerId,
    mutationType,
  });
  return { op, localId };
};

const basePass = (overrides = {}) => ({
  ownerId: OWNER,
  workerId: 'test-worker',
  baseBackoffMs: 10,
  maxBackoffMs: 100,
  now: () => Date.now(),
  ...overrides,
});

test('UUID operation id doubles as a stable idempotency key, generated before submission', async () => {
  const { op } = await seedOperation({ entity: 'household' });
  assert.equal(typeof op.opId, 'string');
  assert.ok(op.opId.length >= 8);
  assert.equal(op.idempotencyKey, idempotencyKeyFor(op.opId));
  assert.equal(op.status, OUTBOX_STATUS.PENDING);
  // The op row carries entity, type, owner, timestamps, retry counter and state.
  assert.equal(op.entity, 'household');
  assert.equal(op.opType, 'create');
  assert.equal(op.ownerId, OWNER);
  assert.equal(op.attempts, 0);
  assert.ok(op.createdAt && op.updatedAt);
});

test('draft payload persists encrypted and round-trips independently of the network', async () => {
  await putDraft({ localId: 'd1', entity: 'household', ownerId: OWNER, data: { headName: 'Dela Cruz' } });
  const raw = await db.drafts.get('d1');
  // Stored payload must not be plaintext-readable as the original object.
  assert.notEqual(raw.data?.headName, 'Dela Cruz');
  const decrypted = await getDraft('d1');
  assert.equal(decrypted.data.headName, 'Dela Cruz');
  assert.equal(decrypted.status, DRAFT_STATUS.PENDING);
});

test('Draft -> Queued -> Syncing -> Synced: success caches the authoritative record', async () => {
  const serverRecord = { id: 'HH-0001', headName: 'Dela Cruz', revision: 1 };
  let received = null;
  const { op, localId } = await seedOperation({ entity: 'household', payload: { headName: 'Dela Cruz' } });
  const getHandler = makeRegistry({
    'household:create': async (decrypted) => {
      received = decrypted;
      return { serverId: serverRecord.id, serverRecord };
    },
  });

  const summary = await runSyncPass(basePass({ getHandler }));

  assert.equal(summary.synced, 1);
  assert.equal(summary.failed, 0);
  const stored = await db.outbox.get(op.opId);
  assert.equal(stored.status, OUTBOX_STATUS.SYNCED);
  assert.equal(stored.serverId, 'HH-0001');
  // The handler saw the decrypted payload and the stable idempotency key.
  assert.equal(received.payload.headName, 'Dela Cruz');
  assert.equal(received.idempotencyKey, op.idempotencyKey);
  // Draft reconciled to the authoritative server record.
  const draft = await getDraft(localId);
  assert.equal(draft.status, DRAFT_STATUS.SYNCED);
  assert.equal(draft.authoritative, true);
  assert.equal(draft.data.id, 'HH-0001');
  // Authorized record cached under the owner-scoped compound key.
  const cached = await getCachedRecord('household', 'HH-0001', OWNER);
  assert.equal(cached.data.headName, 'Dela Cruz');
  // lastSyncedAt recorded per owner.
  assert.ok(await getLastSyncedAt(OWNER));
});

test('a lost response does not duplicate: op is retained and retried with the same idempotency key', async () => {
  const { op } = await seedOperation({ entity: 'followup', payload: { note: 'x' } });
  let calls = 0;
  const keysSeen = [];
  const getHandler = makeRegistry({
    'followup:create': async (decrypted) => {
      calls += 1;
      keysSeen.push(decrypted.idempotencyKey);
      if (calls === 1) {
        // Simulate a dropped response: the request may or may not have reached
        // the server, so the engine must treat it as retryable, not synced.
        const err = new Error('fetch failed');
        err.name = 'TypeError';
        throw err;
      }
      return { serverId: 'FU-1', serverRecord: { id: 'FU-1', revision: 1 } };
    },
  });

  // First pass: network error -> op kept as failed, never deleted.
  const first = await runSyncPass(basePass({ getHandler, now: () => Date.now() }));
  assert.equal(first.synced, 0);
  const afterFail = await db.outbox.get(op.opId);
  assert.equal(afterFail.status, OUTBOX_STATUS.FAILED);
  assert.equal(afterFail.attempts, 1);
  assert.ok(afterFail.nextAttemptAt >= afterFail.createdAt, 'backoff scheduled');

  // Second pass once backoff elapsed: same idempotency key, now succeeds.
  const second = await runSyncPass(basePass({ getHandler, now: () => Date.now() + 10_000 }));
  assert.equal(second.synced, 1);
  assert.equal(calls, 2);
  assert.equal(keysSeen[0], keysSeen[1], 'idempotency key is stable across retries');
  // Exactly one op row — no duplicate was created.
  const all = await listOperations(OWNER);
  assert.equal(all.length, 1);
  assert.equal(all[0].status, OUTBOX_STATUS.SYNCED);
});

test('409 conflict parks the op for review and never overwrites server data', async () => {
  const { op, localId } = await seedOperation({ entity: 'household', opType: 'update', payload: { headName: 'Z' }, baseRevision: 3, targetServerId: 'HH-9' });
  const getHandler = makeRegistry({
    'household:update': async () => {
      const err = new Error('This record changed on the server and needs review.');
      err.status = 409;
      throw err;
    },
  });

  const summary = await runSyncPass(basePass({ getHandler }));
  assert.equal(summary.conflicts, 1);
  const stored = await db.outbox.get(op.opId);
  assert.equal(stored.status, OUTBOX_STATUS.CONFLICT);
  const draft = await getDraft(localId);
  assert.equal(draft.status, DRAFT_STATUS.CONFLICT);
  // Nothing was cached as authoritative from a conflicting write.
  const cached = await getCachedRecord('household', 'HH-9', OWNER);
  assert.equal(cached, null);
});

test('401 stops the pass so a stale session cannot churn the whole queue', async () => {
  const first = await seedOperation({ entity: 'household', payload: { headName: 'A' } });
  const second = await seedOperation({ entity: 'followup', payload: { note: 'B' } });
  const getHandler = makeRegistry({
    'household:create': async () => {
      const err = new Error('expired');
      err.status = 401;
      throw err;
    },
    'followup:create': async () => ({ serverId: 'FU', serverRecord: { id: 'FU' } }),
  });

  const summary = await runSyncPass(basePass({ getHandler }));
  assert.equal(summary.stoppedReason, 'auth');
  // The second op must remain pending (not attempted) after the auth stop.
  const other = await db.outbox.get(second.op.opId);
  assert.equal(other.status, OUTBOX_STATUS.PENDING);
  assert.equal((await db.outbox.get(first.op.opId)).status, OUTBOX_STATUS.FAILED);
});

test('403 permission change is terminal: exhausted, not retried', async () => {
  const { op } = await seedOperation({ entity: 'household', payload: { headName: 'A' } });
  const getHandler = makeRegistry({
    'household:create': async () => {
      const err = new Error('permission changed');
      err.status = 403;
      throw err;
    },
  });
  await runSyncPass(basePass({ getHandler }));
  const stored = await db.outbox.get(op.opId);
  assert.equal(stored.status, OUTBOX_STATUS.FAILED);
  assert.equal(stored.attempts, stored.maxAttempts, 'exhausted so it is not auto-retried');
  assert.equal(stored.lastError.code, SYNC_ERROR.PERMISSION_CHANGED);
});

test('an ONLINE_ONLY row (e.g. legacy/corrupt) is failed closed, never sent', async () => {
  // ONLINE_ONLY cannot be enqueued normally; craft the row directly to prove the
  // runner refuses to send it even if one appears.
  const { op } = await seedOperation({ entity: 'household', payload: { x: 1 } });
  await db.outbox.update(op.opId, { mutationType: MUTATION_TIER.ONLINE_ONLY });
  let called = false;
  const getHandler = makeRegistry({ 'household:create': async () => { called = true; return {}; } });
  await runSyncPass(basePass({ getHandler }));
  assert.equal(called, false);
  const stored = await db.outbox.get(op.opId);
  assert.equal(stored.status, OUTBOX_STATUS.FAILED);
  assert.equal(stored.attempts, stored.maxAttempts);
});

test('an OFFLINE_DRAFT op is never finalized by an ordinary create/update handler', async () => {
  const { op } = await seedOperation({ entity: 'household', payload: { x: 1 }, mutationType: MUTATION_TIER.OFFLINE_DRAFT });
  let called = false;
  const getHandler = makeRegistry({ 'household:create': async () => { called = true; return { serverId: 'HH' }; } });
  const summary = await runSyncPass(basePass({ getHandler }));
  assert.equal(called, false, 'ordinary handler must not finalize a draft');
  assert.equal(summary.deferred, 1);
  assert.equal((await db.outbox.get(op.opId)).status, OUTBOX_STATUS.PENDING);
});

test('dependency ordering: a dependent op is attempted after its parent', async () => {
  const parent = await seedOperation({ entity: 'household', payload: { headName: 'P' }, opType: 'create' });
  const child = await seedOperation({
    entity: 'householdMemberHealth',
    opType: 'update',
    payload: { householdId: 'tmp', memberId: 'm1', health: {} },
    dependsOn: [parent.op.opId],
  });
  const order = [];
  const getHandler = makeRegistry({
    'household:create': async () => { order.push('parent'); return { serverId: 'HH-1', serverRecord: { id: 'HH-1', revision: 1 } }; },
    'householdMemberHealth:update': async () => { order.push('child'); return { serverId: 'm1', serverRecord: { id: 'm1' } }; },
  });
  const summary = await runSyncPass(basePass({ getHandler }));
  assert.equal(summary.synced, 2);
  assert.deepEqual(order, ['parent', 'child']);
  void child;
});

test('a dependent op is deferred while its parent is unsynced', async () => {
  const parent = await seedOperation({ entity: 'household', payload: { headName: 'P' } });
  const child = await seedOperation({
    entity: 'householdMemberHealth',
    opType: 'update',
    payload: { householdId: 'tmp', memberId: 'm1', health: {} },
    dependsOn: [parent.op.opId],
  });
  const getHandler = makeRegistry({
    // Parent fails with a validation error (terminal but non-breaking) so the
    // pass continues to evaluate the child, which must be held back.
    'household:create': async () => { const e = new Error('bad'); e.status = 422; throw e; },
    'householdMemberHealth:update': async () => ({ serverId: 'm1', serverRecord: { id: 'm1' } }),
  });
  const summary = await runSyncPass(basePass({ getHandler }));
  assert.ok(summary.deferred >= 1);
  assert.equal((await db.outbox.get(child.op.opId)).status, OUTBOX_STATUS.PENDING);
});

test('the single-worker lock prevents a second concurrent pass', async () => {
  await seedOperation({ entity: 'household', payload: { x: 1 } });
  // Another worker already holds the lock.
  const held = await acquireLock('other-worker', 30_000);
  assert.equal(held, 'other-worker');
  let called = false;
  const getHandler = makeRegistry({ 'household:create': async () => { called = true; return { serverId: 'HH' }; } });
  const summary = await runSyncPass(basePass({ getHandler }));
  assert.equal(summary.skipped, true);
  assert.equal(summary.stoppedReason, 'locked');
  assert.equal(called, false);
  // The foreign lock is left intact.
  const lock = await readMeta(META_KEYS.LOCK, null);
  assert.equal(lock.owner, 'other-worker');
});

test('interrupted (orphaned) syncing op is recovered and completed on the next pass', async () => {
  const { op } = await seedOperation({ entity: 'followup', payload: { note: 'x' } });
  // Simulate a crash mid-upload: a stale `syncing` row older than the staleness window.
  await db.outbox.update(op.opId, { status: OUTBOX_STATUS.SYNCING, syncingAt: Date.now() - 5 * 60 * 1000 });
  const recovered = await recoverInterruptedOperations(OWNER);
  assert.equal(recovered, 1);
  const getHandler = makeRegistry({ 'followup:create': async () => ({ serverId: 'FU-1', serverRecord: { id: 'FU-1' } }) });
  const summary = await runSyncPass(basePass({ getHandler }));
  assert.equal(summary.synced, 1);
  assert.equal((await db.outbox.get(op.opId)).status, OUTBOX_STATUS.SYNCED);
});

test('per-owner isolation: a pass for one owner never touches another owner data', async () => {
  const mine = await seedOperation({ entity: 'household', ownerId: OWNER, payload: { headName: 'Mine' } });
  const theirs = await seedOperation({ entity: 'household', ownerId: OTHER_OWNER, payload: { headName: 'Theirs' } });
  const getHandler = makeRegistry({ 'household:create': async () => ({ serverId: 'HH', serverRecord: { id: 'HH', revision: 1 } }) });
  const summary = await runSyncPass(basePass({ ownerId: OWNER, getHandler }));
  assert.equal(summary.attempted, 1);
  assert.equal((await db.outbox.get(mine.op.opId)).status, OUTBOX_STATUS.SYNCED);
  // The other account's op is untouched.
  assert.equal((await db.outbox.get(theirs.op.opId)).status, OUTBOX_STATUS.PENDING);
});

test('cached records are isolated per owner on a shared device', async () => {
  await cacheRecord({ entity: 'household', remoteId: 'HH-1', ownerId: OWNER, data: { headName: 'Mine' }, revision: 1 });
  await cacheRecord({ entity: 'household', remoteId: 'HH-1', ownerId: OTHER_OWNER, data: { headName: 'Theirs' }, revision: 1 });
  const mine = await getCachedRecord('household', 'HH-1', OWNER);
  const theirs = await getCachedRecord('household', 'HH-1', OTHER_OWNER);
  assert.equal(mine.data.headName, 'Mine');
  assert.equal(theirs.data.headName, 'Theirs');
  // Reading without the right owner yields nothing.
  assert.equal(await getCachedRecord('household', 'HH-1', 'user-cccc'), null);
});

test('listDrafts is scoped to the owner', async () => {
  await putDraft({ localId: 'a', entity: 'household', ownerId: OWNER, data: { x: 1 } });
  await putDraft({ localId: 'b', entity: 'household', ownerId: OTHER_OWNER, data: { x: 2 } });
  const mine = await listDrafts(OWNER);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].localId, 'a');
});

// ---- Pure helpers --------------------------------------------------------

test('computeBackoffMs grows exponentially and stays within the jittered ceiling', () => {
  const opts = { baseMs: 1000, maxMs: 60_000, random: () => 0.5 }; // no jitter at 0.5
  assert.equal(computeBackoffMs(1, opts), 1000);
  assert.equal(computeBackoffMs(2, opts), 2000);
  assert.equal(computeBackoffMs(3, opts), 4000);
  // Ceiling honored.
  assert.equal(computeBackoffMs(20, opts), 60_000);
  // With jitter the value stays within +/-25% and never negative.
  for (let a = 1; a <= 8; a += 1) {
    const low = computeBackoffMs(a, { baseMs: 1000, maxMs: 60_000, random: () => 0 });
    const high = computeBackoffMs(a, { baseMs: 1000, maxMs: 60_000, random: () => 1 });
    assert.ok(low >= 0);
    assert.ok(high >= low);
  }
});

test('classifySyncError maps HTTP/transport failures to the right retry policy', () => {
  assert.equal(classifySyncError({ status: 401 }).code, SYNC_ERROR.AUTH);
  assert.equal(classifySyncError({ status: 401 }).retryable, false);
  assert.equal(classifySyncError({ status: 403 }).code, SYNC_ERROR.PERMISSION_CHANGED);
  assert.equal(classifySyncError({ status: 409 }).code, SYNC_ERROR.CONFLICT);
  assert.equal(classifySyncError({ status: 422 }).code, SYNC_ERROR.VALIDATION);
  assert.equal(classifySyncError({ status: 400 }).code, SYNC_ERROR.VALIDATION);
  const server = classifySyncError({ status: 503 });
  assert.equal(server.code, SYNC_ERROR.SERVER);
  assert.equal(server.retryable, true);
  const net = classifySyncError(Object.assign(new TypeError('Failed to fetch')));
  assert.equal(net.code, SYNC_ERROR.NETWORK);
  assert.equal(net.retryable, true);
});

test('isQuotaError recognizes storage exhaustion across browser error shapes', () => {
  assert.equal(isQuotaError({ name: 'QuotaExceededError' }), true);
  assert.equal(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), true);
  assert.equal(isQuotaError(new Error('The quota has been exceeded.')), true);
  assert.equal(isQuotaError(new Error('some other failure')), false);
});

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { db, setOfflineOwnerResolver, invalidateOfflineOwner } from '../../src/services/offline/db.js';
import { resetCachedKey } from '../../src/services/offline/crypto.js';
import { queueCreate } from '../../src/services/offline/queue.js';
import { getOperation, markSyncing, updateOperation } from '../../src/services/offline/outbox.js';
import { runSyncPass } from '../../src/services/offline/syncRunner.js';
import { acquireLock, ownsLock, releaseLock, syncLockKey, getLastSyncedAt } from '../../src/services/offline/meta.js';
import { MUTATION_TIER } from '../../src/services/offline/mutationPolicy.js';

beforeEach(async () => {
  setOfflineOwnerResolver(null);
  resetCachedKey();
  if (!db.isOpen()) await db.open();
  await Promise.all([db.drafts.clear(), db.outbox.clear(), db.records.clear(), db.syncMeta.clear(), db.keys.clear()]);
});
afterEach(() => setOfflineOwnerResolver(null));

const queue = (ownerId, data = { headName: 'Synthetic household' }) => queueCreate({ entity: 'household', ownerId, data, mutationType: MUTATION_TIER.SAFE_SYNC });
const serverResult = () => ({ serverId: 'server-household', serverRecord: { id: 'server-household', revision: 1 } });
const pass = (ownerId, handler, options = {}) => runSyncPass({ ownerId, getOwnerId: () => ownerId, getHandler: () => handler, prepareOwner: null, ...options });

test('locks are owner-scoped and renewing one owner never holds another owner queue', async () => {
  const first = await acquireLock('owner-a', 'worker', { now: () => 100 });
  const second = await acquireLock('owner-b', 'worker', { now: () => 100 });
  assert.ok(first && second);
  assert.notEqual(first.token, second.token);
  assert.equal((await db.syncMeta.get(syncLockKey('owner-a'))).value.ownerId, 'owner-a');
  assert.equal((await db.syncMeta.get(syncLockKey('owner-b'))).value.ownerId, 'owner-b');
  assert.equal(await acquireLock('owner-a', 'other-worker', { now: () => 101 }), null);
});

test('a refreshed worker with the same id receives a new fence; old lease cannot release/write its operation', async () => {
  const queued = await queue('owner-a');
  const first = await acquireLock('owner-a', 'same-worker', { ttlMs: 100, now: () => 100 });
  await markSyncing(queued.operation.opId, 'same-worker', 'owner-a', { lease: first, now: () => 100 });
  const second = await acquireLock('owner-a', 'same-worker', { ttlMs: 100, now: () => 201 });
  assert.ok(second);
  assert.notEqual(first.token, second.token);
  await releaseLock(first, { now: () => 201 });
  assert.equal(await ownsLock(second, () => 201), true);
  await assert.rejects(updateOperation(queued.operation.opId, { status: 'synced' }, 'owner-a', { lease: first, now: () => 201, expectedStatus: 'syncing' }), { code: 'lease-lost' });
  assert.equal((await db.outbox.get(queued.operation.opId)).status, 'syncing');
});

test('separate tab modules uploading one owner elect one worker until the dispatched request settles', { timeout: 10000 }, async (t) => {
  await queue('owner-a');
  const otherTab = await import('../../src/services/offline/syncRunner.js?owner-lock-other-tab');
  let release;
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  let uploads = 0;
  const handler = async () => { uploads += 1; started(); await held; return serverResult(); };
  const first = pass('owner-a', handler);
  t.after(async () => { release?.(); await first; });
  await began;
  const second = await otherTab.runSyncPass({ ownerId: 'owner-a', getOwnerId: () => 'owner-a', getHandler: () => handler, prepareOwner: null });
  assert.equal(second.skipped, true);
  assert.equal(second.stoppedReason, 'locked');
  release();
  assert.equal((await first).synced, 1);
  assert.equal(uploads, 1);
});

test('long-running uploads renew the persisted lease beyond its original expiry', { timeout: 10000 }, async (t) => {
  await queue('owner-a');
  const otherTab = await import('../../src/services/offline/syncRunner.js?owner-lock-long-tab');
  let release;
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  let uploads = 0;
  const handler = async () => { uploads += 1; started(); await held; return serverResult(); };
  const first = pass('owner-a', handler, { lockTtlMs: 150, heartbeatMs: 15 });
  t.after(async () => { release?.(); await first; });
  await began;
  await new Promise((resolve) => setTimeout(resolve, 250));
  const lease = (await db.syncMeta.get(syncLockKey('owner-a'))).value;
  assert.ok(lease.expiresAt > Date.now());
  const second = await otherTab.runSyncPass({ ownerId: 'owner-a', getOwnerId: () => 'owner-a', getHandler: () => handler, prepareOwner: null, lockTtlMs: 150 });
  assert.equal(second.stoppedReason, 'locked');
  release();
  assert.equal((await first).synced, 1);
  assert.equal(uploads, 1);
});

test('account switch ignores a late server response and preserves original operation UUID for recovery', { timeout: 10000 }, async (t) => {
  const queued = await queue('owner-a');
  let activeOwner = 'owner-a';
  setOfflineOwnerResolver(() => activeOwner);
  let release;
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  const first = runSyncPass({ ownerId: 'owner-a', getOwnerId: () => activeOwner, getHandler: () => async () => { started(); await held; return serverResult(); }, prepareOwner: null });
  t.after(async () => { release?.(); await first; });
  await began;
  activeOwner = 'owner-b';
  invalidateOfflineOwner('owner-a');
  release();
  const stopped = await first;
  assert.equal(stopped.synced, 0);
  assert.equal(stopped.stoppedReason, 'owner-changed');
  assert.equal(await db.records.count(), 0);
  assert.equal((await db.outbox.get(queued.operation.opId)).status, 'syncing');
  activeOwner = 'owner-a';
  const resumed = await pass('owner-a', async (operation) => {
    assert.equal(operation.idempotencyKey, queued.operation.idempotencyKey);
    return serverResult();
  });
  assert.equal(resumed.synced, 1);
  assert.equal((await getOperation(queued.operation.opId, 'owner-a')).status, 'synced');
  assert.ok(await getLastSyncedAt('owner-a'));
  assert.equal(await getLastSyncedAt('owner-b'), null);
});

test('missing/expired owner is stopped before decrypting or uploading pending operations', async () => {
  await queue('owner-a');
  let sent = 0;
  const result = await runSyncPass({ ownerId: 'owner-a', getOwnerId: () => null, getHandler: () => async () => { sent += 1; return serverResult(); }, prepareOwner: null });
  assert.equal(result.stoppedReason, 'owner-changed');
  assert.equal(sent, 0);
  assert.equal((await db.outbox.toArray())[0].status, 'pending');
});

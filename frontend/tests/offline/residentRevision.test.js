import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { db } from '../../src/services/offline/db.js';
import { resetCachedKey } from '../../src/services/offline/crypto.js';
import { residentsApi } from '../../src/services/api/residentsApi.js';
import { cacheRecord } from '../../src/services/offline/records.js';
import { queueUpdate } from '../../src/services/offline/queue.js';
import { getOperation, markConflict } from '../../src/services/offline/outbox.js';
import { markDraftStatus } from '../../src/services/offline/drafts.js';
import { configureSyncEngine, resetSyncEngine } from '../../src/services/offline/syncEngine.js';
import { MUTATION_TIER } from '../../src/services/offline/mutationPolicy.js';
import { residentRevisionOf, isResidentRevision } from '../../src/services/offline/residentRevision.js';
import { reviewResidentConflict, resolveResidentConflict } from '../../src/services/offline/residentConflictService.js';
import { updateResidentOffline } from '../../src/services/offline/residentOfflineService.js';

const ownerId = 'revision-owner';
const residentId = 'revision-resident';
const originalGet = residentsApi.get;
const originalUpdate = residentsApi.update;
let server;

beforeEach(async () => {
  resetCachedKey();
  if (!db.isOpen()) await db.open();
  await Promise.all([db.drafts.clear(), db.outbox.clear(), db.records.clear(), db.syncMeta.clear(), db.keys.clear()]);
  server = { id: residentId, revision: 4, currentAddress: 'Newest address', religion: 'Unchanged server value' };
  residentsApi.get = async () => ({ resident: { ...server } });
  configureSyncEngine({ getOwnerId: () => ownerId, getHandler: () => null });
});
afterEach(() => { residentsApi.get = originalGet; residentsApi.update = originalUpdate; resetSyncEngine(); });

const conflict = async () => {
  const queued = await queueUpdate({ entity: 'resident', ownerId, serverId: residentId, data: { currentAddress: 'Local address' }, baseRevision: 3, mutationType: MUTATION_TIER.SAFE_SYNC });
  await markConflict(queued.operation.opId, { code: 'conflict', retryable: false }, ownerId);
  await markDraftStatus(queued.localId, 'conflict', {}, ownerId);
  return queued;
};

test('resident revisions prefer integers and still recognize cached legacy timestamps', () => {
  assert.equal(residentRevisionOf({ revision: 4, updatedAt: '2026-11-05T09:00:00Z' }), 4);
  assert.equal(residentRevisionOf({ updatedAt: '2026-11-05T09:00:00Z' }), '2026-11-05T09:00:00Z');
  assert.equal(residentRevisionOf({}), null);
  for (const value of [0, -1, '*', '', null]) assert.equal(isResidentRevision(value), false);
});

test('offline resident changes store an integer base revision and reject mismatched cached versions', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  try {
    await cacheRecord({ entity: 'resident', remoteId: residentId, ownerId, data: { ...server, revision: 3 }, revision: 3 });
    const result = await updateResidentOffline({ ownerId, residentId, baseRevision: 3, payload: { resident: { currentAddress: 'Local address' } } });
    assert.equal(result.queued, true);
    const op = (await db.outbox.where('ownerId').equals(ownerId).toArray())[0];
    assert.equal(op.baseRevision, 3);
    await assert.rejects(updateResidentOffline({ ownerId, residentId, baseRevision: 2, payload: { resident: { currentAddress: 'Wrong base' } } }), /changed after it was cached/);
    assert.equal(await db.outbox.count(), 1);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('conflict review compares actual latest server values and never decrypts another owner operation', async () => {
  const queued = await conflict();
  const review = await reviewResidentConflict({ ownerId, opId: queued.operation.opId });
  assert.equal(review.revision, 4);
  assert.deepEqual(review.fields, [{ field: 'currentAddress', localValue: 'Local address', serverValue: 'Newest address' }]);
  await assert.rejects(reviewResidentConflict({ ownerId: 'other-owner', opId: queued.operation.opId }), { status: 401 });
  configureSyncEngine({ getOwnerId: () => 'other-owner', getHandler: () => null });
  await assert.rejects(reviewResidentConflict({ ownerId: 'other-owner', opId: queued.operation.opId }), /not available/);
});

test('keeping server version resolves local conflict honestly and retains its encrypted clinical work', async () => {
  const queued = await conflict();
  const result = await resolveResidentConflict({ ownerId, opId: queued.operation.opId, reviewedRevision: 4, useServer: true });
  assert.equal(result.queued, false);
  const operation = await getOperation(queued.operation.opId, ownerId);
  assert.equal(operation.status, 'resolved');
  assert.equal(operation.syncedAt, null);
  assert.deepEqual(operation.payload, { currentAddress: 'Local address' });
  assert.equal((await db.drafts.get(queued.localId)).status, 'resolved');
  assert.equal(server.currentAddress, 'Newest address');
});

test('reviewed local fields get a new operation UUID/current revision and leave original values intact', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  try {
    const queued = await conflict();
    const result = await resolveResidentConflict({ ownerId, opId: queued.operation.opId, reviewedRevision: 4, selectedFields: ['currentAddress'] });
    assert.equal(result.queued, true);
    const rows = await db.outbox.where('ownerId').equals(ownerId).toArray();
    const next = rows.find((row) => row.opId !== queued.operation.opId);
    assert.equal(next.status, 'pending');
    assert.equal(next.baseRevision, 4);
    assert.notEqual(next.idempotencyKey, queued.operation.idempotencyKey);
    assert.deepEqual((await getOperation(next.opId, ownerId)).payload, { currentAddress: 'Local address' });
    assert.equal(server.religion, 'Unchanged server value');
    assert.equal((await db.drafts.get(queued.localId)).status, 'resolved');
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('a conflict cannot be resolved from an obsolete comparison or with protected fields', async () => {
  const queued = await conflict();
  await assert.rejects(resolveResidentConflict({ ownerId, opId: queued.operation.opId, reviewedRevision: 3, useServer: true }), /changed again/);
  await assert.rejects(resolveResidentConflict({ ownerId, opId: queued.operation.opId, reviewedRevision: 4, selectedFields: ['authUserId'] }), /saved local fields/);
  assert.equal((await db.outbox.get(queued.operation.opId)).status, 'conflict');
  assert.equal(await db.outbox.count(), 1);
});

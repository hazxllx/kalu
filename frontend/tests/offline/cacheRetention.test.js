import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { db, setOfflineOwnerResolver } from '../../src/services/offline/db.js';
import { encryptJson, resetCachedKey } from '../../src/services/offline/crypto.js';
import {
  CACHE_TTL_MS, MAX_CACHED_RECORDS, cacheRecord, clearAccountSensitiveCache,
  countCachedRecords, getCachedRecord, listCachedRecords, pruneRecordCache, removeCachedRecord,
} from '../../src/services/offline/records.js';
import { queueCreate, queueUpdate, queueOfflineDraft } from '../../src/services/offline/queue.js';
import { getDraft, putDraft, deleteDraft } from '../../src/services/offline/drafts.js';
import { enqueueOperation, getOperation, markSynced, deleteOperation } from '../../src/services/offline/outbox.js';

const OWNER = 'cache-owner-a';
const OTHER = 'cache-owner-b';
const policy = (at, extra = {}) => ({ now: () => at, ttlMs: 1000, maxRecords: 20, ...extra });
const cache = (entity, id, data = { id }, ownerId = OWNER, at = 1000, extra = {}) =>
  cacheRecord({ entity, remoteId: id, data, ownerId }, policy(at, extra));
const queuedUpdate = (id, data = {}, extra = {}) => queueUpdate({
  entity: 'resident', ownerId: OWNER, serverId: id, data, mutationType: 'SAFE_SYNC', ...extra,
});

beforeEach(async () => {
  setOfflineOwnerResolver(null); // Store fixtures are not an authenticated application session.
  resetCachedKey();
  if (!db.isOpen()) await db.open();
  await db.transaction('rw', db.records, db.outbox, db.drafts, db.syncMeta, db.keys, async () => {
    await Promise.all([db.records.clear(), db.outbox.clear(), db.drafts.clear(), db.syncMeta.clear(), db.keys.clear()]);
  });
});

test('missing-owner writes and reads fail closed, including explicit guard overrides', async () => {
  const input = { entity: 'resident', remoteId: 'R', data: { id: 'R' } };
  await assert.rejects(cacheRecord(input), { code: 'no-owner' });
  await assert.rejects(cacheRecord(input, { isOwnerCurrent: () => true }), { code: 'no-owner' });
  await assert.rejects(pruneRecordCache(null), { code: 'no-owner' });
  await assert.rejects(listCachedRecords(null), { code: 'no-owner' });
  await assert.rejects(queueCreate({ entity: 'resident', data: {}, mutationType: 'SAFE_SYNC' }), { code: 'no-owner' });
  await assert.rejects(queueUpdate({ entity: 'resident', serverId: 'R', data: {}, mutationType: 'SAFE_SYNC' }), { code: 'no-owner' });
  await assert.rejects(queueOfflineDraft({ entity: 'consultationDraft', data: {} }), { code: 'no-owner' });
  await assert.rejects(putDraft({ localId: 'missing-owner', entity: 'resident', data: {} }), { code: 'no-owner' });
  await assert.rejects(enqueueOperation({ entity: 'resident', opType: 'create', payload: {}, localRecordId: 'd', mutationType: 'SAFE_SYNC' }), { code: 'no-owner' });
  await assert.rejects(getOperation('unknown'), { code: 'no-owner' });
  await assert.rejects(clearAccountSensitiveCache(null), { code: 'no-owner' });
  assert.equal(await db.records.count(), 0);
  assert.equal(await db.outbox.count(), 0);
  assert.equal(await db.drafts.count(), 0);
});

test('LRU uses last successful access, not insertion order, and retains complete form data', async () => {
  const options = { maxRecords: 3 };
  const form = { id: 'R1', firstName: 'Rosa', cellphoneNo: '09170000000', dateOfBirth: '1980-02-01', pregnancy: { gravida: 2 }, members: [] };
  await cache('resident', 'R1', form, OWNER, 1000, options);
  await cache('resident', 'R2', undefined, OWNER, 1010, options);
  await cache('resident', 'R3', undefined, OWNER, 1020, options);
  assert.deepEqual((await getCachedRecord('resident', 'R1', OWNER, policy(1030, options))).data, form);
  await cache('resident', 'R4', undefined, OWNER, 1040, options);
  assert.equal(await db.records.get([OWNER, 'resident', 'R2']), undefined);
  assert.ok(await db.records.get([OWNER, 'resident', 'R1']));
  assert.equal((await db.records.get([OWNER, 'resident', 'R1'])).lastAccessedAt, 1030);
  assert.equal(await countCachedRecords(OWNER, policy(1040, options)), 3);
  assert.equal((await db.records.get([OWNER, 'resident', 'R1'])).data.enc, true);
});

test('TTL has a controllable clock and is not extended by frequent reads', async () => {
  await cache('resident', 'R1', undefined, OWNER, 1000, { ttlMs: 100 });
  assert.ok(await getCachedRecord('resident', 'R1', OWNER, policy(1099, { ttlMs: 100 })));
  const raw = await db.records.get([OWNER, 'resident', 'R1']);
  assert.equal(raw.cachedAt, 1000);
  assert.equal(raw.lastAccessedAt, 1099);
  assert.equal(await getCachedRecord('resident', 'R1', OWNER, policy(1100, { ttlMs: 100 })), null);
  assert.equal(await db.records.count(), 0);
  await cache('resident', 'future', undefined, OWNER, 2000);
  assert.equal(await getCachedRecord('resident', 'future', OWNER, policy(1999)), null);
  assert.ok(CACHE_TTL_MS > 0);
});

test('the default record bound evicts only the current owner disposable cache', async () => {
  const data = await encryptJson({ authorized: true });
  await db.records.bulkPut(Array.from({ length: MAX_CACHED_RECORDS + 2 }, (_, index) => ({
    ownerId: OWNER, entity: 'resident', remoteId: `R-${index}`, data,
    cachedAt: 1000, lastAccessedAt: 1000 + index,
  })));
  await cache('resident', 'other', { sensitive: 'Other account' }, OTHER);
  const result = await pruneRecordCache(OWNER, { now: () => 2000 });
  assert.equal(result.removed, 2);
  assert.equal(result.retained, MAX_CACHED_RECORDS);
  assert.equal(await db.records.get([OWNER, 'resident', 'R-0']), undefined);
  assert.ok(await db.records.get([OTHER, 'resident', 'other']));
});

test('pending, failed, syncing and conflict bases outlive TTL and may exceed the disposable limit', async () => {
  for (const status of ['pending', 'failed', 'syncing', 'conflict']) {
    await cache('resident', status);
    const queued = await queuedUpdate(status, { currentAddress: 'Unsent address' });
    await db.outbox.update(queued.operation.opId, { status });
    await db.drafts.update(queued.localId, { status });
  }
  await cache('resident', 'disposable');
  const result = await pruneRecordCache(OWNER, policy(50_000, { ttlMs: 0, maxRecords: 0 }));
  assert.equal(result.protected, 4);
  assert.equal(result.retained, 4);
  assert.equal(await db.records.get([OWNER, 'resident', 'disposable']), undefined);
  assert.equal(await removeCachedRecord('resident', 'conflict', OWNER), false);
  assert.equal((await getCachedRecord('resident', 'conflict', OWNER, policy(50_000, { ttlMs: 0, maxRecords: 0 }))).stale, true);
  for (const op of await db.outbox.toArray()) assert.equal(op.payload.enc, true);
  for (const draft of await db.drafts.toArray()) assert.equal(draft.data.enc, true);
});

test('clinical drafts retain resident identity and linked household/member dependencies', async () => {
  await cache('resident', 'R1', { id: 'R1', firstName: 'Rosa', householdId: 'HH1' });
  await cache('residentDirectory', 'R1', { id: 'R1', name: 'Rosa', contactNumber: '09170000000' });
  await cache('rhuResidentIdentity', 'R1', { id: 'R1', birthDate: '1980-02-01' });
  await cache('resident', 'R2', { id: 'R2', firstName: 'Ana' });
  await cache('household', 'HH1', { id: 'HH1', members: [{ id: 'M1', residentId: 'R1' }, { residentId: 'R2' }] });
  await cache('householdMemberHealth', 'M1', { id: 'M1', householdId: 'HH1', residentId: 'R1', heightCm: 160 });
  await cache('resident', 'unused');
  await queueOfflineDraft({ entity: 'rhuTriage', ownerId: OWNER, data: { patient: { id: 'R1' }, vitals: { bp: '120/80' } } });
  const result = await pruneRecordCache(OWNER, policy(100_000, { ttlMs: 0, maxRecords: 1 }));
  assert.equal(result.retained, 6);
  assert.equal(result.protected, 6);
  assert.equal(await db.records.get([OWNER, 'resident', 'unused']), undefined);
  const household = await getCachedRecord('household', 'HH1', OWNER, policy(100_000, { ttlMs: 0, maxRecords: 1 }));
  assert.equal(household.data.members.length, 2);
});

test('logout cleanup retains synchronized dependencies and all unsynced work without touching another account', async () => {
  await cache('household', 'HH1', { id: 'HH1', members: [{ residentId: 'R1' }] });
  await cache('resident', 'R1');
  await cache('resident', 'disposable');
  await cache('resident', 'foreign', { id: 'foreign' }, OTHER);
  const parent = await queueCreate({ entity: 'household', ownerId: OWNER, data: { members: [{ residentId: 'R1' }] }, mutationType: 'SAFE_SYNC' });
  await markSynced(parent.operation.opId, { serverId: 'HH1', serverRecord: { id: 'HH1' } }, OWNER);
  await db.drafts.update(parent.localId, { status: 'synced', serverId: 'HH1' });
  const child = await queuedUpdate('R1', { householdId: 'HH1' }, { dependsOn: [parent.operation.opId] });
  const clinical = await queueOfflineDraft({ entity: 'consultationDraft', ownerId: OWNER, data: { residentId: 'R1', diagnosis: 'Unsent clinical note' } });
  for (const status of ['synced', 'resolved']) {
    const disposable = await queuedUpdate(`done-${status}`);
    await db.outbox.update(disposable.operation.opId, { status });
    await db.drafts.update(disposable.localId, { status });
  }
  const foreign = await queueCreate({ entity: 'resident', ownerId: OTHER, data: { firstName: 'Other' }, mutationType: 'SAFE_SYNC' });
  setOfflineOwnerResolver(() => OTHER);
  const result = await clearAccountSensitiveCache(OWNER);
  assert.equal(result.recordsRemoved, 1);
  assert.equal(result.operationsRemoved, 2);
  assert.equal(result.draftsRemoved, 2);
  assert.ok(await db.outbox.get(parent.operation.opId), 'synced dependency is not disposable yet');
  assert.ok(await db.drafts.get(parent.localId));
  assert.ok(await db.outbox.get(child.operation.opId));
  assert.ok(await db.drafts.get(clinical.localId));
  assert.ok(await db.outbox.get(foreign.operation.opId));
  assert.ok(await db.drafts.get(foreign.localId));
  assert.ok(await db.records.get([OTHER, 'resident', 'foreign']));
  assert.ok(await db.keys.count(), 'the device key is required to recover retained work');
  await assert.rejects(getDraft(clinical.localId, OWNER), { code: 'owner-changed' });
  setOfflineOwnerResolver(() => OWNER);
  assert.equal((await getDraft(clinical.localId, OWNER)).data.diagnosis, 'Unsent clinical note');
  assert.equal((await getOperation(parent.operation.opId, OWNER)).serverRecord.id, 'HH1');
  assert.equal((await db.outbox.get(parent.operation.opId)).serverRecord.enc, true);
  await db.outbox.update(child.operation.opId, { status: 'synced' });
  await db.drafts.update(child.localId, { status: 'synced' });
  await db.drafts.update(clinical.localId, { status: 'resolved' });
  await clearAccountSensitiveCache(OWNER);
  assert.equal(await db.records.where('ownerId').equals(OWNER).count(), 0);
  assert.equal(await db.outbox.where('ownerId').equals(OWNER).count(), 0);
  assert.equal(await db.drafts.where('ownerId').equals(OWNER).count(), 0);
  assert.equal(await db.outbox.where('ownerId').equals(OTHER).count(), 1);
});

test('owner-scoped IDs cannot be decrypted, overwritten, or deleted by another account', async () => {
  const queued = await queuedUpdate('R1', { firstName: 'Private' });
  assert.equal(await getDraft(queued.localId, OTHER), null);
  assert.equal(await getOperation(queued.operation.opId, OTHER), null);
  assert.equal(await deleteDraft(queued.localId, OTHER), false);
  assert.equal(await deleteOperation(queued.operation.opId, OTHER), false);
  await assert.rejects(putDraft({ localId: queued.localId, entity: 'resident', ownerId: OTHER, data: {} }), /cannot change owner/);
  assert.equal((await getDraft(queued.localId, OWNER)).data.firstName, 'Private');
});

test('switch during cache encryption or decryption cannot expose data or recreate a logged-out cache', async () => {
  let current = OWNER;
  setOfflineOwnerResolver(() => current);
  await cache('resident', 'R1');
  const read = getCachedRecord('resident', 'R1', OWNER, policy(1001));
  current = OTHER;
  await assert.rejects(read, { code: 'owner-changed' });
  current = OWNER;
  const write = cache('resident', 'late');
  const cleanup = clearAccountSensitiveCache(OWNER);
  current = OTHER;
  await assert.rejects(write, { code: 'owner-changed' });
  await cleanup;
  assert.equal(await db.records.where('ownerId').equals(OWNER).count(), 0);
});

test('undecodable pending payloads fail retention closed instead of discarding possible bases', async () => {
  await cache('resident', 'R1');
  await cache('household', 'HH1');
  const queued = await queuedUpdate('R1');
  await db.outbox.update(queued.operation.opId, { payload: { enc: true, v: 1, iv: 'bad', ct: 'corrupt' } });
  const result = await pruneRecordCache(OWNER, policy(100_000, { ttlMs: 0, maxRecords: 0 }));
  assert.equal(result.retained, 2);
  assert.equal(result.protected, 2);
  assert.equal((await clearAccountSensitiveCache(OWNER)).recordsRemoved, 0);
});

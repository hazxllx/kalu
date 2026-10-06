import 'fake-indexeddb/auto';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { db, purgeOfflineDb } from '../src/services/offline/db.js';
import { resetCachedKey, encryptJson, decryptJson } from '../src/services/offline/crypto.js';
import { queueCreate } from '../src/services/offline/queue.js';
import {
  OUTBOX_STATUS,
  countByStatus,
  getOperation,
  recoverInterruptedOperations,
} from '../src/services/offline/outbox.js';
import { getDraft } from '../src/services/offline/drafts.js';
import { getCachedRecord } from '../src/services/offline/records.js';
import { runSyncPass } from '../src/services/offline/syncRunner.js';

const OWNER = 'user-1';
const noJitter = () => 0.5;

beforeEach(async () => {
  await db.open();
  await db.transaction(
    'rw',
    db.drafts,
    db.outbox,
    db.records,
    db.syncMeta,
    db.keys,
    async () => {
      await Promise.all([
        db.drafts.clear(),
        db.outbox.clear(),
        db.records.clear(),
        db.syncMeta.clear(),
        db.keys.clear(),
      ]);
    },
  );
  resetCachedKey();
});

test('payloads are encrypted at rest and round-trip cleanly', async () => {
  const envelope = await encryptJson({ headName: 'Juan Dela Cruz', contact: '09171234567' });
  assert.equal(envelope.enc, true);
  assert.ok(envelope.iv && envelope.ct);
  const plain = await decryptJson(envelope);
  assert.deepEqual(plain, { headName: 'Juan Dela Cruz', contact: '09171234567' });
});

test('queueCreate writes a draft and its operation atomically, encrypted', async () => {
  const { localId, operation } = await queueCreate({
    entity: 'household',
    ownerId: OWNER,
    data: { headName: 'Ana', purok: 'Purok 1' },
  });

  const storedOp = await db.outbox.get(operation.opId);
  assert.equal(storedOp.status, OUTBOX_STATUS.PENDING);
  assert.equal(storedOp.ownerId, OWNER);
  assert.equal(storedOp.payload.enc, true, 'operation payload is stored encrypted');
  assert.match(storedOp.idempotencyKey, /^kalusagap-op-/);

  const storedDraft = await db.drafts.get(localId);
  assert.equal(storedDraft.status, 'pending');
  assert.equal(storedDraft.payload, undefined);
  assert.equal(storedDraft.data.enc, true, 'draft payload is stored encrypted');

  const counts = await countByStatus(OWNER);
  assert.equal(counts.pending, 1);
});

test('a successful pass marks the operation synced and reconciles the server id', async () => {
  const { localId, operation } = await queueCreate({
    entity: 'household',
    ownerId: OWNER,
    data: { headName: 'Ana' },
  });

  let calls = 0;
  const handler = async (op) => {
    calls += 1;
    assert.equal(op.idempotencyKey, operation.idempotencyKey);
    return { serverId: 'HH-001', serverRecord: { id: 'HH-001', revision: 1, headName: 'Ana' } };
  };

  const summary = await runSyncPass({ ownerId: OWNER, getHandler: () => handler, random: noJitter });
  assert.equal(summary.synced, 1);
  assert.equal(summary.failed, 0);

  const op = await getOperation(operation.opId);
  assert.equal(op.status, OUTBOX_STATUS.SYNCED);
  assert.equal(op.serverId, 'HH-001');

  const draft = await getDraft(localId);
  assert.equal(draft.status, 'synced');
  assert.equal(draft.serverId, 'HH-001');
  assert.equal(draft.data.headName, 'Ana');

  const cached = await getCachedRecord('household', 'HH-001', OWNER);
  assert.equal(cached.data.headName, 'Ana');

  // A second pass must not re-send an already-confirmed operation.
  const second = await runSyncPass({ ownerId: OWNER, getHandler: () => handler, random: noJitter });
  assert.equal(second.attempted, 0);
  assert.equal(calls, 1, 'the handler ran exactly once — no duplicate upload');
});

test('a transport failure backs off and stops the pass without marking synced', async () => {
  const { operation } = await queueCreate({ entity: 'household', ownerId: OWNER, data: { headName: 'B' } });
  const t0 = 1_000_000;
  const handler = async () => {
    throw new TypeError('Failed to fetch');
  };

  const summary = await runSyncPass({
    ownerId: OWNER,
    getHandler: () => handler,
    now: () => t0,
    random: noJitter,
  });

  assert.equal(summary.synced, 0);
  assert.equal(summary.failed, 1);
  assert.equal(summary.stoppedReason, 'network');

  const op = await db.outbox.get(operation.opId);
  assert.equal(op.status, OUTBOX_STATUS.FAILED);
  assert.equal(op.attempts, 1);
  assert.ok(op.nextAttemptAt > t0, 'a retry is scheduled in the future');
  assert.equal(op.lastError.code, 'network');
});

test('a validation (422) failure is terminal and is not retried automatically', async () => {
  const { operation } = await queueCreate({ entity: 'household', ownerId: OWNER, data: { headName: 'C' } });
  const handler = async () => {
    throw Object.assign(new Error('Household head name is required.'), { status: 422 });
  };

  const first = await runSyncPass({ ownerId: OWNER, getHandler: () => handler, random: noJitter });
  assert.equal(first.failed, 1);

  const op = await db.outbox.get(operation.opId);
  assert.equal(op.status, OUTBOX_STATUS.FAILED);
  assert.equal(op.attempts, op.maxAttempts, 'terminal failure exhausts the attempt budget');

  // A later pass must not automatically retry a validation failure.
  const second = await runSyncPass({ ownerId: OWNER, getHandler: () => handler, random: noJitter });
  assert.equal(second.attempted, 0);
});

test('a conflict is recorded for review and never overwrites the local record', async () => {
  const { operation } = await queueCreate({
    entity: 'household',
    ownerId: OWNER,
    data: { headName: 'D' },
  });
  const handler = async () => {
    throw Object.assign(new Error('This household was updated on another device.'), { status: 409 });
  };

  const summary = await runSyncPass({ ownerId: OWNER, getHandler: () => handler, random: noJitter });
  assert.equal(summary.conflicts, 1);

  const op = await db.outbox.get(operation.opId);
  assert.equal(op.status, OUTBOX_STATUS.CONFLICT);
  const counts = await countByStatus(OWNER);
  assert.equal(counts.conflict, 1);
});

test('an interrupted upload is recovered and retried exactly once', async () => {
  const { operation } = await queueCreate({ entity: 'household', ownerId: OWNER, data: { headName: 'E' } });
  // Simulate a crash mid-upload: the op is stuck in `syncing` with an old stamp.
  await db.outbox.update(operation.opId, {
    status: OUTBOX_STATUS.SYNCING,
    syncingAt: Date.now() - 10 * 60 * 1000,
  });

  const recovered = await recoverInterruptedOperations(OWNER, 60_000);
  assert.equal(recovered, 1);
  const afterRecovery = await db.outbox.get(operation.opId);
  assert.equal(afterRecovery.status, OUTBOX_STATUS.PENDING);

  let calls = 0;
  const handler = async () => {
    calls += 1;
    return { serverId: 'HH-002', serverRecord: { id: 'HH-002' } };
  };
  const summary = await runSyncPass({ ownerId: OWNER, getHandler: () => handler, random: noJitter });
  assert.equal(summary.synced, 1);
  assert.equal(calls, 1);
});

test('dependencies are synchronized before their dependents', async () => {
  const parent = await queueCreate({ entity: 'household', ownerId: OWNER, data: { headName: 'Parent' } });
  await queueCreate({
    entity: 'household',
    ownerId: OWNER,
    data: { headName: 'Child' },
    dependsOn: [parent.operation.opId],
  });

  const order = [];
  const handler = async (op) => {
    order.push(op.payload.headName);
    return { serverId: op.payload.headName, serverRecord: { id: op.payload.headName } };
  };

  const summary = await runSyncPass({ ownerId: OWNER, getHandler: () => handler, random: noJitter });
  assert.equal(summary.synced, 2);
  assert.deepEqual(order, ['Parent', 'Child']);
});

test('a malformed queued operation is failed, not silently dropped', async () => {
  await db.outbox.put({
    opId: 'malformed-1',
    ownerId: OWNER,
    opType: 'create',
    status: OUTBOX_STATUS.PENDING,
    attempts: 0,
    maxAttempts: 6,
    nextAttemptAt: 0,
    createdAt: 1,
    idempotencyKey: 'kalusagap-op-malformed-1',
    localRecordId: 'none',
    payload: { enc: false, v: 1, plain: {} },
    // `entity` is intentionally missing.
  });

  const handler = async () => ({ serverId: 'x' });
  const summary = await runSyncPass({ ownerId: OWNER, getHandler: () => handler, random: noJitter });
  assert.equal(summary.failed, 1);
  const op = await db.outbox.get('malformed-1');
  assert.equal(op.status, OUTBOX_STATUS.FAILED);
  assert.equal(op.lastError.code, 'malformed');
});

test('logout purge destroys all local records and the device key', async () => {
  await queueCreate({ entity: 'household', ownerId: OWNER, data: { headName: 'Purge Me' } });
  await encryptJson({ probe: true }); // ensure a device key exists
  assert.equal(await db.drafts.count(), 1);
  assert.equal(await db.outbox.count(), 1);
  assert.ok((await db.keys.count()) >= 1);

  resetCachedKey();
  await purgeOfflineDb();

  // Reopening recreates an empty database — a shared device keeps nothing.
  await db.open();
  assert.equal(await db.drafts.count(), 0);
  assert.equal(await db.outbox.count(), 0);
  assert.equal(await db.records.count(), 0);
  assert.equal(await db.keys.count(), 0);
});

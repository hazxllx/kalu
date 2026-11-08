import { assertCurrentOwner, captureOwnerGuard, db, requireEncryptedPayload, requireOwnerId, safeWrite } from './db.js';
import { decryptJson, encryptJson, isEncryptedEnvelope } from './crypto.js';
import { idempotencyKeyFor, newId } from './ids.js';
import { MUTATION_TIER, assertQueueableMutation, isKnownMutationTier } from './mutationPolicy.js';
import { ownsLock, syncLockKey } from './meta.js';

/**
 * Synchronization outbox — the durable write-ahead log of pending writes.
 *
 * State machine:
 *   pending  -> syncing -> synced
 *                       -> failed   (retryable; re-queued after backoff)
 *                       -> conflict (server/version conflict; needs review)
 *
 * A `syncing` op is never deleted until the server returns a durable response;
 * if the app is interrupted mid-upload, `recoverInterruptedOperations` returns
 * stale `syncing` rows to `pending` so they are retried (idempotently) rather
 * than lost.
 */

export const OUTBOX_STATUS = Object.freeze({
  PENDING: 'pending',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  FAILED: 'failed',
  CONFLICT: 'conflict',
  RESOLVED: 'resolved',
});

export class MalformedOperationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MalformedOperationError';
    this.code = 'malformed';
  }
}

const DEFAULT_MAX_ATTEMPTS = 6;

export const isValidOperation = (op) =>
  Boolean(
    op &&
      typeof op.opId === 'string' &&
      op.opId &&
      typeof op.entity === 'string' &&
      op.entity &&
      typeof op.ownerId === 'string' &&
      op.ownerId.trim() &&
      op.ownerId === op.ownerId.trim() &&
      typeof op.localRecordId === 'string' &&
      op.localRecordId &&
      (op.opType === 'create' || op.opType === 'update') &&
      typeof op.idempotencyKey === 'string' &&
      op.idempotencyKey &&
      isKnownMutationTier(op.mutationType),
  );

/**
 * Build an operation row without writing it. Split out so a draft and its
 * operation can be written in one atomic IndexedDB transaction.
 */
export const buildOperation = (input, encryptedPayload) => {
  const {
    entity,
    opType,
    ownerId,
    localRecordId,
    dependsOn = [],
    baseRevision = null,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    targetServerId = null,
    mutationType = MUTATION_TIER.ONLINE_ONLY,
    opId = newId(),
    idempotencyKey = idempotencyKeyFor(opId),
  } = input;

  requireOwnerId(ownerId);
  assertQueueableMutation(mutationType);
  const now = Date.now();
  return {
    opId,
    entity,
    opType,
    mutationType,
    ownerId,
    localRecordId,
    targetServerId,
    payload: encryptedPayload,
    dependsOn: Array.isArray(dependsOn) ? dependsOn : [],
    idempotencyKey,
    status: OUTBOX_STATUS.PENDING,
    attempts: 0,
    maxAttempts,
    nextAttemptAt: now,
    lastError: null,
    baseRevision,
    serverId: null,
    serverRecord: null,
    createdAt: now,
    updatedAt: now,
    syncedAt: null,
  };
};

/**
 * Queue a new write operation. `payload` is encrypted at rest before it is
 * stored, and the operation id doubles as the idempotency key.
 *
 * @param {{entity:string, opType:'create'|'update', ownerId:string, payload:any, localRecordId:string, dependsOn?:string[], baseRevision?:number|null, maxAttempts?:number}} input
 */
export const enqueueOperation = async (input) => {
  const isOwnerCurrent = captureOwnerGuard(input.ownerId);
  assertCurrentOwner(isOwnerCurrent);
  const op = buildOperation(input, requireEncryptedPayload(await encryptJson(input.payload)));
  assertCurrentOwner(isOwnerCurrent);
  if (!isValidOperation(op)) throw new MalformedOperationError('A complete, owner-scoped operation is required.');
  await safeWrite(() => db.transaction('rw', db.outbox, db.drafts, async () => {
    assertCurrentOwner(isOwnerCurrent);
    const draft = await db.drafts.get(op.localRecordId);
    assertCurrentOwner(isOwnerCurrent);
    if (draft && draft.ownerId !== op.ownerId) throw new MalformedOperationError('The operation draft belongs to another owner.');
    for (const dependencyId of op.dependsOn) {
      const dependency = await db.outbox.get(dependencyId);
      assertCurrentOwner(isOwnerCurrent);
      if (dependency && dependency.ownerId !== op.ownerId) throw new MalformedOperationError('An operation dependency belongs to another owner.');
    }
    await db.outbox.add(op);
    assertCurrentOwner(isOwnerCurrent);
  }));
  return op;
};

/** Read an operation and decrypt its payload. */
export const getOperation = async (opId, ownerId, { isOwnerCurrent = captureOwnerGuard(ownerId) } = {}) => {
  requireOwnerId(ownerId);
  assertCurrentOwner(isOwnerCurrent);
  const op = await db.outbox.get(opId);
  assertCurrentOwner(isOwnerCurrent);
  if (!op || op.ownerId !== ownerId) return null;
  const payload = op.payload ? await decryptJson(op.payload) : null;
  assertCurrentOwner(isOwnerCurrent);
  const serverRecord = isEncryptedEnvelope(op.serverRecord) ? await decryptJson(op.serverRecord) : op.serverRecord;
  assertCurrentOwner(isOwnerCurrent);
  return { ...op, payload, serverRecord };
};

/** All operations for a user, newest last. */
export const listOperations = async (ownerId) => {
  const isOwnerCurrent = captureOwnerGuard(ownerId);
  assertCurrentOwner(isOwnerCurrent);
  const rows = await db.outbox.where('ownerId').equals(ownerId).toArray();
  assertCurrentOwner(isOwnerCurrent);
  return rows.sort((a, b) => a.createdAt - b.createdAt);
};

/**
 * Operations that are ready to be attempted now: fresh `pending` ops and
 * `failed` ops whose backoff window has elapsed and that still have attempts
 * left. Ordering is by creation time; the engine additionally respects the
 * `dependsOn` graph.
 */
export const listReadyOperations = async (ownerId, now = Date.now()) => {
  const rows = await listOperations(ownerId);
  return rows.filter((op) => {
    if (op.status === OUTBOX_STATUS.PENDING) return true;
    if (
      op.status === OUTBOX_STATUS.FAILED &&
      (op.lastError?.retryable === true ||
        (op.lastError?.retryable === undefined && op.attempts < op.maxAttempts)) &&
      (op.nextAttemptAt || 0) <= now
    ) {
      return true;
    }
    return false;
  });
};

export const updateOperation = async (opId, patch, ownerId, {
  isOwnerCurrent = captureOwnerGuard(ownerId), lease = null, expectedStatus = null, now = Date.now,
} = {}) => {
  requireOwnerId(ownerId);
  assertCurrentOwner(isOwnerCurrent);
  if ('ownerId' in patch && patch.ownerId !== ownerId) throw new MalformedOperationError('An operation cannot change owner.');
  return safeWrite(() => db.transaction('rw', db.outbox, db.syncMeta, async () => {
    assertCurrentOwner(isOwnerCurrent);
    const op = await db.outbox.get(opId);
    assertCurrentOwner(isOwnerCurrent);
    if (!op || op.ownerId !== ownerId || (expectedStatus && op.status !== expectedStatus)) return false;
    if (lease) {
      if (lease.ownerId !== ownerId || !(await ownsLock(lease, now)) ||
        (op.status === OUTBOX_STATUS.SYNCING && op.workerToken !== lease.token)) {
        throw Object.assign(new Error('The synchronization lease is no longer held.'), { code: 'lease-lost' });
      }
      assertCurrentOwner(isOwnerCurrent);
    }
    await db.outbox.update(opId, { ...patch, updatedAt: now() });
    assertCurrentOwner(isOwnerCurrent);
    return true;
  }));
};

export const markSyncing = async (opId, workerId, ownerId, context = {}) =>
  updateOperation(opId, {
    status: OUTBOX_STATUS.SYNCING, workerId, workerToken: context.lease?.token ?? null,
    syncingAt: (context.now || Date.now)(),
  }, ownerId, context);

/** Only called after a confirmed, durable server response. */
export const markSynced = async (opId, { serverId = null, serverRecord = null } = {}, ownerId, context = {}) => {
  const isOwnerCurrent = context.isOwnerCurrent || captureOwnerGuard(ownerId);
  assertCurrentOwner(isOwnerCurrent);
  const encryptedRecord = serverRecord ? requireEncryptedPayload(await encryptJson(serverRecord)) : null;
  assertCurrentOwner(isOwnerCurrent);
  const at = (context.now || Date.now)();
  return updateOperation(opId, {
      status: OUTBOX_STATUS.SYNCED,
      serverId,
      serverRecord: encryptedRecord,
      lastError: null,
      syncedAt: at,
      workerId: null,
      workerToken: null,
      syncingAt: null,
    }, ownerId, { ...context, isOwnerCurrent });
};

/**
 * Mark an operation failed. Retryable failures keep a bounded attempt counter
 * and a backoff timestamp; terminal failures (validation, authorization) are
 * exhausted immediately so they are not retried until the user acts.
 */
export const markFailed = async (opId, errorInfo, nextAttemptAt = null, { ownerId, exhaust = false, ...context } = {}) => {
  const isOwnerCurrent = context.isOwnerCurrent || captureOwnerGuard(ownerId);
  assertCurrentOwner(isOwnerCurrent);
  const op = await db.outbox.get(opId);
  assertCurrentOwner(isOwnerCurrent);
  if (!op || op.ownerId !== ownerId) return null;
  const attempts = exhaust ? op?.maxAttempts || DEFAULT_MAX_ATTEMPTS : (op?.attempts || 0) + 1;
  const updated = await updateOperation(opId, {
      status: OUTBOX_STATUS.FAILED,
      attempts,
      lastError: errorInfo,
      nextAttemptAt: nextAttemptAt ?? (context.now || Date.now)(),
      workerId: null,
      workerToken: null,
      syncingAt: null,
    }, ownerId, { ...context, isOwnerCurrent });
  return updated ? attempts : null;
};

export const markConflict = async (opId, errorInfo, ownerId, context = {}) =>
  updateOperation(opId, {
      status: OUTBOX_STATUS.CONFLICT,
      lastError: errorInfo,
      workerId: null,
      workerToken: null,
      syncingAt: null,
    }, ownerId, context);

export const requeueOperation = async (opId, ownerId, context = {}) => {
  const isOwnerCurrent = context.isOwnerCurrent || captureOwnerGuard(ownerId);
  assertCurrentOwner(isOwnerCurrent);
  const op = await db.outbox.get(opId);
  assertCurrentOwner(isOwnerCurrent);
  if (!op || op.ownerId !== ownerId || op.status !== OUTBOX_STATUS.FAILED) return false;
  return updateOperation(opId, {
    status: OUTBOX_STATUS.PENDING,
    nextAttemptAt: (context.now || Date.now)(),
    lastError: null,
    attempts: 0,
  }, ownerId, { ...context, isOwnerCurrent, expectedStatus: OUTBOX_STATUS.FAILED });
};

export const deleteOperation = async (opId, ownerId) => {
  const isOwnerCurrent = captureOwnerGuard(ownerId);
  return safeWrite(() => db.transaction('rw', db.outbox, async () => {
    assertCurrentOwner(isOwnerCurrent);
    const op = await db.outbox.get(opId);
    assertCurrentOwner(isOwnerCurrent);
    if (!op || op.ownerId !== ownerId) return false;
    await db.outbox.delete(opId);
    assertCurrentOwner(isOwnerCurrent);
    return true;
  }));
};

/**
 * Counts by status for the UI. `pending` folds in `failed`-but-retryable so the
 * "pending changes" badge reflects everything still waiting to reach the server.
 */
export const countByStatus = async (ownerId) => {
  const rows = await listOperations(ownerId);
  const counts = {
    pending: 0,
    syncing: 0,
    synced: 0,
    failed: 0,
    conflict: 0,
    total: rows.length,
  };
  for (const op of rows) {
    if (op.status in counts) counts[op.status] += 1;
  }
  return counts;
};

/**
 * Crash/interruption recovery: a `syncing` op older than `staleMs` was orphaned
 * (tab closed, browser killed) — return it to `pending` so it is retried. The
 * idempotency key makes this safe even if the original request reached the
 * server.
 */
export const recoverInterruptedOperations = async (ownerId, {
  staleMs = 2 * 60 * 1000, lease = null, now = Date.now, isOwnerCurrent = captureOwnerGuard(ownerId),
} = {}) => {
  requireOwnerId(ownerId);
  return safeWrite(() => db.transaction('rw', db.outbox, db.drafts, db.syncMeta, async () => {
    assertCurrentOwner(isOwnerCurrent);
    const row = await db.syncMeta.get(syncLockKey(ownerId));
    assertCurrentOwner(isOwnerCurrent);
    if (lease) {
      if (lease.ownerId !== ownerId || !(await ownsLock(lease, now))) {
        throw Object.assign(new Error('Recovery requires the current owner lease.'), { code: 'lease-lost' });
      }
      assertCurrentOwner(isOwnerCurrent);
    } else if (row?.value?.expiresAt > now()) return 0;
    const rows = await db.outbox.where('ownerId').equals(ownerId).toArray();
    assertCurrentOwner(isOwnerCurrent);
    let recovered = 0;
    for (const op of rows) {
      if (op.status !== OUTBOX_STATUS.SYNCING) continue;
      const orphaned = lease ? op.workerToken !== lease.token : (op.syncingAt || 0) <= now() - staleMs;
      if (!orphaned) continue;
      const at = now();
      await db.outbox.update(op.opId, {
        status: OUTBOX_STATUS.PENDING, nextAttemptAt: at, updatedAt: at,
        workerId: null, workerToken: null, syncingAt: null,
      });
      assertCurrentOwner(isOwnerCurrent);
      const draft = op.localRecordId ? await db.drafts.get(op.localRecordId) : null;
      assertCurrentOwner(isOwnerCurrent);
      if (draft?.ownerId === ownerId && draft.status === OUTBOX_STATUS.SYNCING) {
        await db.drafts.update(draft.localId, { status: OUTBOX_STATUS.PENDING, updatedAt: at });
        assertCurrentOwner(isOwnerCurrent);
      }
      recovered += 1;
    }
    return recovered;
  }));
};

export default {
  OUTBOX_STATUS,
  enqueueOperation,
  getOperation,
  listOperations,
  listReadyOperations,
  updateOperation,
  markSyncing,
  markSynced,
  markFailed,
  markConflict,
  requeueOperation,
  deleteOperation,
  countByStatus,
  recoverInterruptedOperations,
  isValidOperation,
  MalformedOperationError,
};

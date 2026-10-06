import { db, safeWrite } from './db.js';
import { decryptJson, encryptJson } from './crypto.js';
import { idempotencyKeyFor, newId } from './ids.js';

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
      (op.opType === 'create' || op.opType === 'update') &&
      typeof op.idempotencyKey === 'string' &&
      op.idempotencyKey,
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
  } = input;

  const opId = newId();
  const now = Date.now();
  return {
    opId,
    entity,
    opType,
    ownerId,
    localRecordId,
    targetServerId,
    payload: encryptedPayload,
    dependsOn: Array.isArray(dependsOn) ? dependsOn : [],
    idempotencyKey: idempotencyKeyFor(opId),
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
  const op = buildOperation(input, await encryptJson(input.payload));
  await safeWrite(() => db.outbox.put(op));
  return op;
};

/** Read an operation and decrypt its payload. */
export const getOperation = async (opId) => {
  const op = await db.outbox.get(opId);
  if (!op) return null;
  const payload = op.payload ? await decryptJson(op.payload) : null;
  return { ...op, payload };
};

/** All operations for a user, newest last. */
export const listOperations = async (ownerId) => {
  const rows = await db.outbox.where('ownerId').equals(ownerId).toArray();
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
      op.attempts < op.maxAttempts &&
      (op.nextAttemptAt || 0) <= now
    ) {
      return true;
    }
    return false;
  });
};

export const updateOperation = async (opId, patch) => {
  await safeWrite(() => db.outbox.update(opId, { ...patch, updatedAt: Date.now() }));
};

export const markSyncing = async (opId, workerId) =>
  updateOperation(opId, { status: OUTBOX_STATUS.SYNCING, workerId, syncingAt: Date.now() });

/** Only called after a confirmed, durable server response. */
export const markSynced = async (opId, { serverId = null, serverRecord = null } = {}) => {
  const now = Date.now();
  await safeWrite(() =>
    db.outbox.update(opId, {
      status: OUTBOX_STATUS.SYNCED,
      serverId,
      serverRecord,
      lastError: null,
      syncedAt: now,
      updatedAt: now,
    }),
  );
};

/**
 * Mark an operation failed. Retryable failures keep a bounded attempt counter
 * and a backoff timestamp; terminal failures (validation, authorization) are
 * exhausted immediately so they are not retried until the user acts.
 */
export const markFailed = async (opId, errorInfo, nextAttemptAt = null, { exhaust = false } = {}) => {
  const op = await db.outbox.get(opId);
  const attempts = exhaust ? op?.maxAttempts || DEFAULT_MAX_ATTEMPTS : (op?.attempts || 0) + 1;
  await safeWrite(() =>
    db.outbox.update(opId, {
      status: OUTBOX_STATUS.FAILED,
      attempts,
      lastError: errorInfo,
      nextAttemptAt: nextAttemptAt ?? Date.now(),
      updatedAt: Date.now(),
    }),
  );
  return attempts;
};

export const markConflict = async (opId, errorInfo) => {
  await safeWrite(() =>
    db.outbox.update(opId, {
      status: OUTBOX_STATUS.CONFLICT,
      lastError: errorInfo,
      updatedAt: Date.now(),
    }),
  );
};

export const requeueOperation = async (opId) => {
  const op = await db.outbox.get(opId);
  if (!op) return false;
  if (op.status === OUTBOX_STATUS.SYNCED) return false;
  await updateOperation(opId, {
    status: OUTBOX_STATUS.PENDING,
    nextAttemptAt: Date.now(),
    lastError: null,
    attempts: 0,
  });
  return true;
};

export const deleteOperation = async (opId) => {
  await safeWrite(() => db.outbox.delete(opId));
};

/**
 * Counts by status for the UI. `pending` folds in `failed`-but-retryable so the
 * "pending changes" badge reflects everything still waiting to reach the server.
 */
export const countByStatus = async (ownerId) => {
  const rows = await db.outbox.where('ownerId').equals(ownerId).toArray();
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
export const recoverInterruptedOperations = async (ownerId, staleMs = 2 * 60 * 1000) => {
  const cutoff = Date.now() - staleMs;
  const rows = await db.outbox.where('ownerId').equals(ownerId).toArray();
  let recovered = 0;
  for (const op of rows) {
    if (op.status === OUTBOX_STATUS.SYNCING && (op.syncingAt || 0) <= cutoff) {
      await updateOperation(op.opId, { status: OUTBOX_STATUS.PENDING, nextAttemptAt: Date.now() });
      recovered += 1;
    }
  }
  return recovered;
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

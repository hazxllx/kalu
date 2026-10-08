import { db } from './db.js';
import { markDraftStatus, reconcileDraft } from './drafts.js';
import { cacheRecord } from './records.js';
import {
  OUTBOX_STATUS,
  getOperation,
  isValidOperation,
  listOperations,
  markConflict,
  markFailed,
  markSynced,
  markSyncing,
  recoverInterruptedOperations,
} from './outbox.js';
import { releaseLock, renewLock, acquireLock, writeMeta, META_KEYS } from './meta.js';
import { classifySyncError, SYNC_ERROR } from './errors.js';
import { MUTATION_TIER } from './mutationPolicy.js';
import {
  computeBackoffMs,
  dependenciesSatisfied,
  orderOperations,
} from './syncCore.js';

/**
 * Execute one synchronization pass over the outbox.
 *
 * The runner is deliberately free of any network/UI import: the caller injects
 * `getHandler` (the real API handlers in production, fakes in tests). This keeps
 * the retry/ordering/reconciliation logic independently testable and prevents
 * two code paths from disagreeing about what "synced" means.
 */
export const runSyncPass = async ({
  ownerId,
  workerId,
  getHandler,
  now = () => Date.now(),
  random = Math.random,
  baseBackoffMs = 1000,
  maxBackoffMs = 60_000,
  maxOps = Number.POSITIVE_INFINITY,
  onProgress = null,
}) => {
  const summary = {
    attempted: 0,
    synced: 0,
    failed: 0,
    conflicts: 0,
    deferred: 0,
    skipped: false,
    stoppedReason: null,
  };
  if (!ownerId) {
    summary.skipped = true;
    summary.stoppedReason = 'no-owner';
    return summary;
  }

  const lockOwner = workerId || `worker-${now()}-${random().toString(36).slice(2)}`;
  const acquired = await acquireLock(lockOwner);
  if (!acquired) {
    summary.skipped = true;
    summary.stoppedReason = 'locked';
    return summary;
  }

  try {
    await recoverInterruptedOperations(ownerId);

    const allOps = await listOperations(ownerId);
    const allById = new Map(allOps.map((op) => [op.opId, op]));

    const isReady = (op) =>
      op.status === OUTBOX_STATUS.PENDING ||
      (op.status === OUTBOX_STATUS.FAILED &&
        op.attempts < op.maxAttempts &&
        (op.nextAttemptAt || 0) <= now());

    const ready = allOps.filter(isReady);
    const { ordered } = orderOperations(ready, allById);

    let processed = 0;
    const total = ordered.length;

    for (const candidate of ordered) {
      if (processed >= maxOps) {
        summary.stoppedReason = 'max-ops';
        break;
      }

      // Always work from the freshest row: a previous op in this pass may have
      // changed dependency status or the row may have been handled elsewhere.
      const op = await db.outbox.get(candidate.opId);
      if (!op || !isReady(op)) continue;
      allById.set(op.opId, op);

      if (!dependenciesSatisfied(op, allById)) {
        summary.deferred += 1;
        continue;
      }

      summary.attempted += 1;
      processed += 1;

      if (!isValidOperation(op)) {
        const info = {
          code: SYNC_ERROR.MALFORMED,
          status: 0,
          retryable: false,
          message: 'This queued change is malformed and cannot be sent.',
        };
        await markFailed(op.opId, info, Number.MAX_SAFE_INTEGER - 1);
        await markDraftStatus(op.localRecordId, OUTBOX_STATUS.FAILED, { lastError: info });
        summary.failed += 1;
        continue;
      }

      const mutationType = op.mutationType;
      if (mutationType === MUTATION_TIER.ONLINE_ONLY) {
        const info = {
          code: SYNC_ERROR.MALFORMED,
          status: 0,
          retryable: false,
          message: 'This action requires an internet connection.',
        };
        await markFailed(op.opId, info, Number.MAX_SAFE_INTEGER - 1, { exhaust: true });
        await markDraftStatus(op.localRecordId, OUTBOX_STATUS.FAILED, { lastError: info });
        summary.failed += 1;
        continue;
      }

      const handler = getHandler ? getHandler(op.entity, op.opType) : null;
      if (
        mutationType === MUTATION_TIER.OFFLINE_DRAFT &&
        (!handler || handler.mutationType !== MUTATION_TIER.OFFLINE_DRAFT || handler.syncsDraft !== true)
      ) {
        // Never send a draft to a normal create/update handler: that could
        // finalize a clinical decision instead of preserving draft state.
        summary.deferred += 1;
        continue;
      }
      if (typeof handler !== 'function') {
        const info = {
          code: SYNC_ERROR.MALFORMED,
          status: 0,
          retryable: false,
          message: `No synchronization handler is registered for ${op.entity}:${op.opType}.`,
        };
        await markFailed(op.opId, info, Number.MAX_SAFE_INTEGER - 1);
        await markDraftStatus(op.localRecordId, OUTBOX_STATUS.FAILED, { lastError: info });
        summary.failed += 1;
        continue;
      }
      if (handler.mutationType && handler.mutationType !== mutationType) {
        const info = {
          code: SYNC_ERROR.MALFORMED,
          status: 0,
          retryable: false,
          message: `The ${mutationType} change is not supported by its synchronization handler.`,
        };
        await markFailed(op.opId, info, Number.MAX_SAFE_INTEGER - 1, { exhaust: true });
        await markDraftStatus(op.localRecordId, OUTBOX_STATUS.FAILED, { lastError: info });
        summary.failed += 1;
        continue;
      }

      await markSyncing(op.opId, lockOwner);
      await markDraftStatus(op.localRecordId, OUTBOX_STATUS.SYNCING);
      allById.set(op.opId, { ...op, status: OUTBOX_STATUS.SYNCING });

      const decrypted = await getOperation(op.opId);

      try {
        const result = await handler(decrypted);
        if (mutationType === MUTATION_TIER.OFFLINE_DRAFT && result?.draft !== true) {
          const error = new Error('The server did not confirm that this change remains a draft.');
          error.code = SYNC_ERROR.MALFORMED;
          throw error;
        }
        const serverId = result?.serverId ?? null;
        const serverRecord = result?.serverRecord ?? null;

        // A handler only returns after a confirmed, durable response; anything
        // thrown is handled below and never marks the operation synced.
        await markSynced(op.opId, { serverId, serverRecord });
        await reconcileDraft(op.localRecordId, serverRecord, { serverId });
        if (serverRecord && serverId) {
          await cacheRecord({
            entity: op.entity,
            remoteId: serverId,
            ownerId,
            data: serverRecord,
            revision: serverRecord?.revision ?? null,
          });
        }
        allById.set(op.opId, { ...op, status: OUTBOX_STATUS.SYNCED, serverId });
        await writeMeta(META_KEYS.LAST_SYNCED_AT, now());
        summary.synced += 1;
      } catch (error) {
        const info = classifySyncError(error);

        if (info.code === SYNC_ERROR.CONFLICT) {
          await markConflict(op.opId, info);
          await markDraftStatus(op.localRecordId, OUTBOX_STATUS.CONFLICT, { lastError: info });
          allById.set(op.opId, { ...op, status: OUTBOX_STATUS.CONFLICT });
          summary.conflicts += 1;
          continue;
        }

        const terminal = !info.retryable;
        const attempts = await markFailed(
          op.opId,
          info,
          terminal
            ? now()
            : now() + computeBackoffMs(op.attempts + 1, { baseMs: baseBackoffMs, maxMs: maxBackoffMs, random }),
          { exhaust: terminal },
        );
        await markDraftStatus(op.localRecordId, OUTBOX_STATUS.FAILED, { lastError: info });
        allById.set(op.opId, { ...op, status: OUTBOX_STATUS.FAILED, attempts });
        summary.failed += 1;

        if (info.code === SYNC_ERROR.NETWORK) {
          // No point continuing while the network is down.
          summary.stoppedReason = 'network';
          break;
        }
        if (info.code === SYNC_ERROR.AUTH) {
          summary.stoppedReason = 'auth';
          break;
        }
      } finally {
        if (onProgress) {
          onProgress({ processed, total, opId: op.opId, entity: op.entity });
        }
      }

      await renewLock(lockOwner);
    }

    return summary;
  } finally {
    await releaseLock(lockOwner);
  }
};

export default { runSyncPass };

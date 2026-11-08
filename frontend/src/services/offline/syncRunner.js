import { assertCurrentOwner, captureOwnerGuard, db, requireEncryptedPayload } from './db.js';
import { encryptJson } from './crypto.js';
import { markDraftStatus } from './drafts.js';
import { pruneRecordCache } from './records.js';
import {
  OUTBOX_STATUS,
  getOperation,
  isValidOperation,
  listOperations,
  markConflict,
  markFailed,
  updateOperation,
  markSyncing,
  recoverInterruptedOperations,
} from './outbox.js';
import { releaseLock, renewLock, acquireLock, ownsLock, writeMeta, readMeta, lastSyncedKey, syncLockKey, META_KEYS, DEFAULT_LOCK_TTL_MS } from './meta.js';
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
const activeOwners = new Set();

export const runSyncPass = async ({
  ownerId,
  getOwnerId = null,
  workerId = null,
  getHandler,
  prepareOwner = undefined,
  onlyOperationId = null,
  operationIds = null,
  now = () => Date.now(),
  random = Math.random,
  baseBackoffMs = 1000,
  maxBackoffMs = 60_000,
  maxOps = Number.POSITIVE_INFINITY,
  onProgress = null,
  lockTtlMs = DEFAULT_LOCK_TTL_MS,
  heartbeatMs = Math.max(1, Math.floor(lockTtlMs / 3)),
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
  if (typeof ownerId !== 'string' || !ownerId.trim()) {
    summary.skipped = true;
    summary.stoppedReason = 'no-owner';
    return summary;
  }

  const isOwnerCurrent = captureOwnerGuard(ownerId, getOwnerId);
  if (!isOwnerCurrent()) {
    summary.skipped = true;
    summary.stoppedReason = 'owner-changed';
    return summary;
  }
  if (activeOwners.has(ownerId)) {
    summary.skipped = true;
    summary.stoppedReason = 'locked';
    const lock = await readMeta(syncLockKey(ownerId));
    summary.retryAt = lock?.expiresAt ?? now() + lockTtlMs;
    return summary;
  }
  activeOwners.add(ownerId);
  const execute = async () => {
    const lockOwner = workerId || `worker-${now()}-${random().toString(36).slice(2)}`;
    const lease = await acquireLock(ownerId, lockOwner, { ttlMs: lockTtlMs, now });
    if (!lease) {
      summary.skipped = true;
      summary.stoppedReason = 'locked';
      const lock = await readMeta(syncLockKey(ownerId)) || await readMeta(META_KEYS.LOCK);
      summary.retryAt = lock?.expiresAt ?? now() + lockTtlMs;
      return summary;
    }
    let leaseLost = false;
    let heartbeatWork = null;
    const abortController = new AbortController();
    const check = () => {
      assertCurrentOwner(isOwnerCurrent);
      if (leaseLost) throw Object.assign(new Error('The synchronization lease expired or was replaced.'), { code: 'lease-lost' });
    };
    const verifyLease = async () => {
      check();
      leaseLost = !(await ownsLock(lease, now));
      check();
    };
    // Continue fencing an already-dispatched upload until it settles, even if
    // its session ends. No old response or subsequent operation is applied.
    const heartbeat = setInterval(() => {
      if (!isOwnerCurrent()) abortController.abort();
      if (heartbeatWork || leaseLost) return;
      heartbeatWork = renewLock(lease, { ttlMs: lockTtlMs, now })
        .then((renewed) => { if (!renewed) leaseLost = true; })
        .catch(() => { leaseLost = true; })
        .finally(() => { heartbeatWork = null; if (leaseLost) abortController.abort(); });
    }, Math.max(1, Math.min(heartbeatMs, Math.floor(lockTtlMs / 3))));
    const context = { lease, isOwnerCurrent, now };
    try {
      check();
      await recoverInterruptedOperations(ownerId, context);
      check();
      const prepare = prepareOwner === undefined
        ? (await import('./consultationOfflineService.js')).adoptLegacyConsultationDrafts
        : prepareOwner;
      check();
      if (prepare) {
        await prepare(ownerId, { ...context, signal: abortController.signal });
        await verifyLease();
      }
      await pruneRecordCache(ownerId, { now, isOwnerCurrent });
      await verifyLease();
      const allOps = await listOperations(ownerId);
      check();
      const allById = new Map(allOps.map((op) => [op.opId, op]));
      const isReady = (op) => op.status === OUTBOX_STATUS.PENDING ||
        (op.status === OUTBOX_STATUS.FAILED &&
          (op.lastError?.retryable === true || (op.lastError?.retryable === undefined && op.attempts < op.maxAttempts)) &&
          (op.nextAttemptAt || 0) <= now());
      const selectedIds = operationIds ? new Set(operationIds) : null;
      const ready = allOps.filter((op) => isReady(op) && (!onlyOperationId || op.opId === onlyOperationId) &&
        (!selectedIds || selectedIds.has(op.opId)));
      const { ordered, deferred } = orderOperations(ready, allById);
      summary.deferred += deferred.length;
      let processed = 0;
      const total = ordered.length;
      for (const candidate of ordered) {
        await verifyLease();
        if (processed >= maxOps) { summary.stoppedReason = 'max-ops'; break; }
        const op = await db.outbox.get(candidate.opId);
        check();
        if (!op || op.ownerId !== ownerId || !isReady(op)) continue;
        allById.set(op.opId, op);
        if (!dependenciesSatisfied(op, allById)) { summary.deferred += 1; continue; }
        let malformed = !isValidOperation(op);
        const draft = op.localRecordId ? await db.drafts.get(op.localRecordId) : null;
        check();
        if (draft && draft.ownerId !== ownerId) malformed = true;
        for (const dependencyId of op.dependsOn || []) {
          const dependency = await db.outbox.get(dependencyId);
          check();
          if (dependency && dependency.ownerId !== ownerId) malformed = true;
        }
        const mutationType = op.mutationType;
        const handler = getHandler ? getHandler(op.entity, op.opType) : null;
        check();
        if (!malformed && mutationType === MUTATION_TIER.OFFLINE_DRAFT &&
          (!handler || handler.mutationType !== MUTATION_TIER.OFFLINE_DRAFT || handler.syncsDraft !== true)) {
          summary.deferred += 1;
          continue;
        }
        summary.attempted += 1;
        processed += 1;
        const malformedMessage = malformed
          ? 'This queued change is malformed and cannot be sent.'
          : mutationType === MUTATION_TIER.ONLINE_ONLY
            ? 'This action requires an internet connection.'
            : typeof handler !== 'function'
              ? `No synchronization handler is registered for ${op.entity}:${op.opType}.`
              : handler.mutationType && handler.mutationType !== mutationType
                ? `The ${mutationType} change is not supported by its synchronization handler.`
                : null;
        if (malformedMessage) {
          const info = { code: SYNC_ERROR.MALFORMED, status: 0, retryable: false, message: malformedMessage };
          await db.transaction('rw', db.outbox, db.drafts, db.syncMeta, async () => {
            await markFailed(op.opId, info, Number.MAX_SAFE_INTEGER - 1, { ...context, ownerId, exhaust: true, expectedStatus: op.status });
            check();
            await markDraftStatus(op.localRecordId, OUTBOX_STATUS.FAILED, { lastError: info }, ownerId, context);
            check();
          });
          summary.failed += 1;
          continue;
        }
        const claimed = await db.transaction('rw', db.outbox, db.drafts, db.syncMeta, async () => {
          const updated = await markSyncing(op.opId, lockOwner, ownerId, { ...context, expectedStatus: op.status });
          check();
          if (!updated) return false;
          await markDraftStatus(op.localRecordId, OUTBOX_STATUS.SYNCING, {}, ownerId, context);
          check();
          return true;
        });
        check();
        if (!claimed) continue;
        allById.set(op.opId, { ...op, status: OUTBOX_STATUS.SYNCING });
        const resultContext = { ...context, expectedStatus: OUTBOX_STATUS.SYNCING };
        try {
          const decrypted = await getOperation(op.opId, ownerId, { isOwnerCurrent });
          await verifyLease();
          if (!decrypted || decrypted.workerToken !== lease.token) {
            throw Object.assign(new Error('The queued operation changed before dispatch.'), { code: 'lease-lost' });
          }
          check();
          const result = await handler(decrypted, { ownerId, isOwnerCurrent, signal: abortController.signal, lease });
          await verifyLease();
          if (mutationType === MUTATION_TIER.OFFLINE_DRAFT && result?.draft !== true) {
            throw Object.assign(new Error('The server did not confirm that this change remains a draft.'), { code: SYNC_ERROR.MALFORMED });
          }
          const serverId = result?.serverId ?? null;
          const serverRecord = result?.serverRecord ?? null;
          const encryptedRecord = serverRecord ? requireEncryptedPayload(await encryptJson(serverRecord)) : null;
          await verifyLease();
          // Commit reconciliation as one fenced unit. A switch during crypto or
          // an IndexedDB await rolls back every status/cache/metadata write.
          await db.transaction('rw', db.outbox, db.drafts, db.records, db.syncMeta, db.keys, async () => {
            const at = now();
            const synced = await updateOperation(op.opId, {
              status: OUTBOX_STATUS.SYNCED, serverId, serverRecord: encryptedRecord,
              lastError: null, syncedAt: at, workerId: null, workerToken: null, syncingAt: null,
            }, ownerId, resultContext);
            check();
            if (!synced) throw Object.assign(new Error('The synchronization claim changed.'), { code: 'lease-lost' });
            const currentDraft = await db.drafts.get(op.localRecordId);
            check();
            if (currentDraft?.ownerId === ownerId) {
              await markDraftStatus(op.localRecordId, OUTBOX_STATUS.SYNCED, {
                data: encryptedRecord || currentDraft.data,
                serverId: serverId ?? serverRecord?.id ?? currentDraft.serverId ?? null,
                revision: serverRecord?.revision ?? currentDraft.revision ?? null,
                authoritative: true,
              }, ownerId, context);
            }
            check();
            if (serverRecord && serverId !== null) {
              await db.records.put({
                entity: op.entity, remoteId: String(serverId), ownerId, data: encryptedRecord,
                revision: serverRecord?.revision ?? null, cachedAt: at, lastAccessedAt: at,
              });
              check();
            }
            await pruneRecordCache(ownerId, { now, isOwnerCurrent });
            check();
            await writeMeta(lastSyncedKey(ownerId), now());
            check();
          });
          check();
          allById.set(op.opId, { ...op, status: OUTBOX_STATUS.SYNCED, serverId });
          summary.synced += 1;
        } catch (error) {
          check();
          if (error?.code === 'lease-lost' || error?.code === 'owner-changed') throw error;
          const info = classifySyncError(error);
          if (info.code === SYNC_ERROR.CONFLICT) {
            await db.transaction('rw', db.outbox, db.drafts, db.syncMeta, async () => {
              await markConflict(op.opId, info, ownerId, resultContext);
              check();
              await markDraftStatus(op.localRecordId, OUTBOX_STATUS.CONFLICT, { lastError: info }, ownerId, context);
              check();
            });
            allById.set(op.opId, { ...op, status: OUTBOX_STATUS.CONFLICT });
            summary.conflicts += 1;
          } else {
            const terminal = !info.retryable;
            const attempts = await db.transaction('rw', db.outbox, db.drafts, db.syncMeta, async () => {
              const count = await markFailed(op.opId, info,
                terminal ? now() : now() + computeBackoffMs(op.attempts + 1, { baseMs: baseBackoffMs, maxMs: maxBackoffMs, random }),
                { ...resultContext, ownerId, exhaust: terminal });
              check();
              await markDraftStatus(op.localRecordId, OUTBOX_STATUS.FAILED, { lastError: info }, ownerId, context);
              check();
              return count;
            });
            allById.set(op.opId, { ...op, status: OUTBOX_STATUS.FAILED, attempts });
            summary.failed += 1;
            if (info.code === SYNC_ERROR.NETWORK || info.code === SYNC_ERROR.AUTH) {
              summary.stoppedReason = info.code;
              break;
            }
          }
        } finally {
          if (onProgress && isOwnerCurrent() && !leaseLost) {
            try { onProgress({ processed, total, opId: op.opId, entity: op.entity }); } catch { /* observer only */ }
          }
        }
      }
      return summary;
    } catch (error) {
      if (error?.code !== 'owner-changed' && error?.code !== 'lease-lost') throw error;
      summary.stoppedReason = error.code;
      return summary;
    } finally {
      clearInterval(heartbeat);
      if (heartbeatWork) await heartbeatWork;
      await releaseLock(lease, { now });
    }
  };
  try {
    // Native locks remain held while a live tab is suspended, unlike a timer
    // lease alone. IndexedDB fencing is still required for orphan recovery.
    const locks = globalThis.navigator?.locks;
    return locks?.request
      ? await locks.request(`kalusagap:sync:${ownerId}`, { mode: 'exclusive', ifAvailable: true }, (lock) => {
        if (lock) return execute();
        summary.skipped = true;
        summary.stoppedReason = 'locked';
        summary.retryAt = now() + lockTtlMs;
        return summary;
      })
      : await execute();
  } finally {
    activeOwners.delete(ownerId);
  }
};

export default { runSyncPass };

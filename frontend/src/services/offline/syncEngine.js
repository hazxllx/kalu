import { isNavigatorOnline, subscribeConnectivity } from './connectivity.js';
import { lastSyncedKey, readMeta } from './meta.js';
import { runSyncPass } from './syncRunner.js';
import { listOperations, requeueOperation } from './outbox.js';
import { earliestRetryAt, summarizeOperations } from './syncCore.js';
import { getOfflineDraftCount } from './drafts.js';
import { setOfflineOwnerResolver } from './db.js';
import { isRecoverableFailure } from './errors.js';

/**
 * Central synchronization engine.
 *
 * One engine instance owns all synchronization for the signed-in user:
 *   - it reacts to connectivity changes, the app becoming visible, and explicit
 *     retry requests;
 *   - it runs at most ONE pass at a time (in-memory guard + a database lock so a
 *     second tab cannot process the same operation concurrently);
 *   - it never fabricates success: an operation becomes `synced` only after the
 *     injected handler returns a confirmed server response.
 *
 * The UI subscribes through `subscribe`/`getSnapshot` (a useSyncExternalStore
 * store) and never calls the API directly for queued work.
 */

const defaultState = () => ({
  initialized: false,
  online: isNavigatorOnline(),
  serverAvailable: null,
  syncing: false,
  ownerId: null,
  lastSyncedAt: null,
  counts: { pending: 0, syncing: 0, synced: 0, resolved: 0, failed: 0, conflict: 0, offlineDraft: 0, total: 0 },
  failed: [],
  conflicts: [],
  progress: null,
  lastResult: null,
  lastError: null,
});

let state = defaultState();
const listeners = new Set();
let running = null;
let queued = false;
let engineGeneration = 0;
const hiddenOwnerState = defaultState();
let debounceTimer = null;
let retryTimer = null;
let stopConnectivity = null;
let visibilityHandler = null;
/** @type {(() => string | null) | null} */
let ownerResolver = null;
/** @type {((entity: string, opType: string) => Function | null) | null} */
let handlerResolver = null;

const emit = () => {
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch {
      /* a listener error must not break the engine */
    }
  });
};

const setState = (patch) => {
  state = { ...state, ...patch };
  emit();
};

export const getSnapshot = () => state.ownerId && state.ownerId !== currentOwner() ? hiddenOwnerState : state;

export const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Wire the engine to the authenticated session's user id resolver. */
export const configureSyncEngine = ({ getOwnerId, getHandler = null }) => {
  engineGeneration += 1;
  ownerResolver = getOwnerId;
  handlerResolver = getHandler;
  setOfflineOwnerResolver(getOwnerId);
  setState({ ...defaultState(), ownerId: currentOwner() });
};

const currentOwner = () => {
  try {
    return ownerResolver ? ownerResolver() : null;
  } catch {
    return null;
  }
};

/** Re-read persisted state (counts, problems, last sync) from the database. */
export const refreshSyncState = async () => {
  const ownerId = currentOwner();
  const generation = engineGeneration;
  const isCurrent = () => generation === engineGeneration && currentOwner() === ownerId;
  if (!ownerId) {
    setState({ ...defaultState(), initialized: true, online: isNavigatorOnline() });
    return state;
  }
  try {
    const ops = await listOperations(ownerId);
    if (!isCurrent()) return getSnapshot();
    const { counts, failed, conflicts } = summarizeOperations(ops);
    const offlineDraftCount = await getOfflineDraftCount(ownerId);
    if (!isCurrent()) return getSnapshot();
    const lastSyncedAt = await readMeta(lastSyncedKey(ownerId), null);
    if (!isCurrent()) return getSnapshot();
    setState({
      ownerId,
      counts: { ...counts, offlineDraft: offlineDraftCount },
      failed,
      conflicts,
      lastSyncedAt,
      initialized: true,
    });
  } catch (error) {
    if (!isCurrent()) return getSnapshot();
    // IndexedDB unavailable (private mode, blocked storage): the app still works
    // online; only offline queueing is affected.
    setState({
      ownerId,
      initialized: true,
      lastError: { message: 'Offline storage is unavailable on this device.' },
    });
  }
  return state;
};

/**
 * Run a synchronization pass if one is not already running. Additional requests
 * during a run are coalesced into a single follow-up pass.
 */
export const requestSync = async (reason = 'manual') => {
  const ownerId = currentOwner();
  const generation = engineGeneration;
  const isCurrent = () => generation === engineGeneration && currentOwner() === ownerId;
  if (!ownerId) {
    await refreshSyncState();
    return state.lastResult;
  }
  if (running?.generation === generation && running.ownerId === ownerId) {
    queued = true;
    return state.lastResult;
  }
  if (!isNavigatorOnline()) {
    setState({ online: false, ownerId });
    await refreshSyncState();
    return { skipped: true, stoppedReason: 'offline', reason };
  }

  const pass = { generation, ownerId };
  running = pass;
  setState({ syncing: true, online: true, ownerId, lastError: null, progress: { processed: 0, total: 0 } });
  try {
    const getHandler = handlerResolver || (await import('./handlers.js')).getSyncHandler;
    if (!isCurrent()) return { skipped: true, stoppedReason: 'owner-changed' };
    const result = await runSyncPass({
      ownerId,
      getOwnerId: () => isCurrent() ? ownerId : null,
      getHandler,
      onProgress: ({ processed, total }) => { if (isCurrent()) setState({ progress: { processed, total } }); },
    });
    if (!isCurrent()) return result;
    const serverAvailable = result.stoppedReason === 'network'
      ? false
      : result.attempted > 0
        ? true
        : state.serverAvailable;
    const lastError = result.stoppedReason === 'network'
      ? { code: 'network', message: 'The backend is not reachable. Changes remain saved on this device and will retry automatically.' }
      : result.stoppedReason === 'auth'
        ? { code: 'auth', message: 'Your session expired. Sign in again before synchronizing.' }
        : result.stoppedReason
          ? state.lastError
          : null;
    setState({ lastResult: { ...result, reason }, serverAvailable, lastError });
    return result;
  } catch (error) {
    if (isCurrent()) setState({ lastError: { code: 'unknown', message: error?.message || 'Synchronization failed.' } });
    return { failed: 0, error };
  } finally {
    if (running === pass) {
      running = null;
      if (isCurrent()) {
        setState({ syncing: false, progress: null });
        await refreshSyncState();
        if (isCurrent()) await scheduleRetryForPending(ownerId, generation);
        if (queued && isCurrent()) {
          queued = false;
          await requestSync('follow-up');
        }
      }
    }
  }
};

/** Manual retry: requeue everything retryable, then sync. */
export const retryAll = async () => {
  const ownerId = currentOwner();
  const generation = engineGeneration;
  const isCurrent = () => generation === engineGeneration && currentOwner() === ownerId;
  if (!ownerId) return state;
  const ops = await listOperations(ownerId);
  if (!isCurrent()) return getSnapshot();
  for (const op of ops) {
    if (!isCurrent()) return getSnapshot();
    if (op.status === 'failed' && isRecoverableFailure(op.lastError)) {
      await requeueOperation(op.opId, ownerId, { isOwnerCurrent: isCurrent });
      if (!isCurrent()) return getSnapshot();
    }
  }
  await refreshSyncState();
  if (!isCurrent()) return getSnapshot();
  return requestSync('retry-all');
};

/** Retry a single failed/conflicted operation. */
export const retryOperation = async (opId) => {
  const ownerId = currentOwner();
  const generation = engineGeneration;
  const isCurrent = () => generation === engineGeneration && currentOwner() === ownerId;
  if (!ownerId) return state;
  const ops = await listOperations(ownerId);
  if (!isCurrent()) return getSnapshot();
  const op = ops.find((row) => row.opId === opId);
  if (!op || !isRecoverableFailure(op.lastError)) return state;
  const requeued = await requeueOperation(opId, ownerId, { isOwnerCurrent: isCurrent });
  if (!isCurrent()) return getSnapshot();
  if (!requeued) return state;
  await refreshSyncState();
  if (!isCurrent()) return getSnapshot();
  return requestSync('retry-one');
};

const scheduleRetryForPending = async (ownerId, generation = engineGeneration) => {
  const isCurrent = () => generation === engineGeneration && currentOwner() === ownerId;
  if (!isCurrent()) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (!ownerId || !isNavigatorOnline()) return;

  try {
    const ops = await listOperations(ownerId);
    if (!isCurrent()) return;
    const retryAt = earliestRetryAt(ops);
    const lockedRetryAt = state.lastResult?.stoppedReason === 'locked' ? state.lastResult.retryAt : null;
    const deadlines = [retryAt, lockedRetryAt].filter(Number.isFinite);
    const nextAttemptAt = deadlines.length ? Math.min(...deadlines) : null;
    if (nextAttemptAt === null) return;

    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (isCurrent()) requestSync('retry-backoff');
    }, Math.max(0, nextAttemptAt - Date.now()));
  } catch (error) {
    if (isCurrent()) setState({ lastError: { code: 'storage', message: error?.message || 'Could not schedule the next synchronization retry.' } });
  }
};

const requeueExpiredSessionOperations = async (ownerId, generation) => {
  const isCurrent = () => generation === engineGeneration && currentOwner() === ownerId;
  const ops = await listOperations(ownerId);
  if (!isCurrent()) return;
  for (const op of ops) {
    if (!isCurrent()) return;
    if (op.status === 'failed' && op.lastError?.code === 'auth') {
      await requeueOperation(op.opId, ownerId, { isOwnerCurrent: isCurrent });
      if (!isCurrent()) return;
    }
  }
};

const scheduleSync = (delayMs = 750) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    requestSync('scheduled');
  }, delayMs);
};

/** Attach connectivity/visibility listeners and perform an initial refresh. */
export const startSyncEngine = () => {
  stopSyncEngine();
  const generation = engineGeneration;
  stopConnectivity = subscribeConnectivity((online) => {
    setState({ online: currentOwner() ? online : state.online });
    if (online) scheduleSync(300);
  });
  if (typeof document !== 'undefined') {
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') scheduleSync(1500);
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }
  setState({ online: isNavigatorOnline() });
  refreshSyncState()
    .then(async () => {
      const ownerId = currentOwner();
      if (generation === engineGeneration && ownerId && isNavigatorOnline()) {
        await requeueExpiredSessionOperations(ownerId, generation);
        if (generation === engineGeneration && currentOwner() === ownerId) scheduleSync(1000);
      }
    })
    .catch((error) => {
      if (generation === engineGeneration) setState({ lastError: { code: 'storage', message: error?.message || 'Could not prepare synchronization.' } });
    });
};

export const stopSyncEngine = () => {
  engineGeneration += 1;
  queued = false;
  if (stopConnectivity) {
    stopConnectivity();
    stopConnectivity = null;
  }
  if (visibilityHandler && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
};

/** Reset the in-memory state — used on logout/account switch. */
export const resetSyncEngine = () => {
  stopSyncEngine();
  running = null;
  ownerResolver = null;
  handlerResolver = null;
  // Authentication owns the live account binding. Resetting synchronization
  // must not clear a valid session during sign-in or token refresh.
  state = defaultState();
  emit();
};

export default {
  configureSyncEngine,
  startSyncEngine,
  stopSyncEngine,
  resetSyncEngine,
  requestSync,
  retryAll,
  retryOperation,
  refreshSyncState,
  subscribe,
  getSnapshot,
};

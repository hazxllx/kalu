/**
 * Pure synchronization helpers (no network, no browser globals) so they can be
 * unit-tested directly and reused by the engine/runner.
 */

export const SYNC_STATE = Object.freeze({
  PENDING: 'pending',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  FAILED: 'failed',
  CONFLICT: 'conflict',
});

/**
 * Exponential backoff with bounded ceiling and symmetric jitter.
 *
 * @param {number} attempts number of failed attempts so far (>= 1)
 */
export const computeBackoffMs = (
  attempts,
  { baseMs = 1000, maxMs = 60_000, jitterRatio = 0.25, random = Math.random } = {},
) => {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));
  const jitter = exp * jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(exp + jitter));
};

/**
 * Topologically order ready operations so dependencies (e.g. a household) are
 * attempted before the records that depend on them. Deferred operations are
 * those whose dependency has not synchronised yet.
 *
 * @param {Array<any>} ready operations eligible this pass
 * @param {Map<string, any>} allOpsById every known operation by id
 */
export const orderOperations = (ready, allOpsById) => {
  const readyIds = new Set(ready.map((op) => op.opId));
  const byId = new Map(ready.map((op) => [op.opId, op]));
  const indegree = new Map();
  const dependents = new Map();

  for (const op of ready) {
    const internalDeps = (op.dependsOn || []).filter((dep) => readyIds.has(dep));
    indegree.set(op.opId, internalDeps.length);
    for (const dep of internalDeps) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep).push(op.opId);
    }
  }

  // Deterministic: tie-break by creation time then id.
  const queue = ready
    .filter((op) => (indegree.get(op.opId) || 0) === 0)
    .sort((a, b) => a.createdAt - b.createdAt || a.opId.localeCompare(b.opId));

  const ordered = [];
  const seen = new Set();
  while (queue.length) {
    const op = queue.shift();
    ordered.push(op);
    seen.add(op.opId);
    for (const dependentId of dependents.get(op.opId) || []) {
      indegree.set(dependentId, (indegree.get(dependentId) || 0) - 1);
      if (indegree.get(dependentId) === 0) {
        const dependent = byId.get(dependentId);
        if (dependent) {
          queue.push(dependent);
          queue.sort((a, b) => a.createdAt - b.createdAt || a.opId.localeCompare(b.opId));
        }
      }
    }
  }

  const deferred = ready.filter((op) => !seen.has(op.opId) && _hasInternalCycle(op, readyIds, byId));
  return { ordered, deferred };
};

const _hasInternalCycle = (op, readyIds, byId) => {
  // Any ready op not emitted by Kahn's algorithm sits on a dependency cycle.
  const stack = [...(op.dependsOn || [])].filter((dep) => readyIds.has(dep));
  const visited = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (id === op.opId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const next = byId.get(id);
    stack.push(...((next?.dependsOn || []).filter((d) => readyIds.has(d))));
  }
  return false;
};

/**
 * True when every dependency of `op` has already synchronised. A missing
 * dependency is treated as satisfied (it was produced and removed in an earlier
 * session); a dependency still queued or failed blocks this operation.
 */
export const dependenciesSatisfied = (op, allOpsById) =>
  (op.dependsOn || []).every((dep) => {
    const dependency = allOpsById.get(dep);
    return !dependency || dependency.status === SYNC_STATE.SYNCED;
  });

/** Build the user-facing status summary consumed by the UI. */
export const summarizeOperations = (ops) => {
  const counts = { pending: 0, syncing: 0, synced: 0, failed: 0, conflict: 0, total: ops.length };
  for (const op of ops) {
    if (op.status in counts) counts[op.status] += 1;
  }
  const failed = ops
    .filter((op) => op.status === SYNC_STATE.FAILED)
    .map((op) => ({
      opId: op.opId,
      entity: op.entity,
      opType: op.opType,
      attempts: op.attempts,
      code: op.lastError?.code || 'unknown',
      message: op.lastError?.message || 'Synchronization failed.',
    }));
  const conflicts = ops
    .filter((op) => op.status === SYNC_STATE.CONFLICT)
    .map((op) => ({
      opId: op.opId,
      entity: op.entity,
      opType: op.opType,
      code: op.lastError?.code || 'conflict',
      message: op.lastError?.message || 'This record needs review.',
    }));
  return { counts, failed, conflicts };
};

export default {
  SYNC_STATE,
  computeBackoffMs,
  orderOperations,
  dependenciesSatisfied,
  summarizeOperations,
};

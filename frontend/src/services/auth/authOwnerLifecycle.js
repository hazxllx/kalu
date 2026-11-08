/** Authentication boundaries invalidate late work, not encrypted pending data. */
export const createAuthOwnerLifecycle = ({ bindOwner, clearCache, resetStores, stopSync, now = Date.now }) => {
  let ownerId = null;
  let expiresAt = null;
  const cleanups = new Map();
  const currentOwner = () => expiresAt && expiresAt <= now() ? null : ownerId;
  const cleanup = (id) => {
    if (!id) return Promise.resolve();
    if (!cleanups.has(id)) {
      const job = Promise.resolve(clearCache(id));
      cleanups.set(id, job);
      job.finally(() => { if (cleanups.get(id) === job) cleanups.delete(id); }).catch(() => {});
    }
    return cleanups.get(id);
  };
  return {
    get ownerId() { return ownerId; },
    currentOwner,
    cleanup,
    install() { bindOwner(currentOwner); resetStores(); },
    change(id, expiration = null) {
      const previous = ownerId;
      ownerId = id || null;
      expiresAt = expiration || null;
      if (previous === ownerId) return Promise.resolve();
      // Rebinding also fences an A -> B -> A switch while A's cleanup is pending.
      bindOwner(currentOwner);
      stopSync();
      resetStores();
      return cleanup(previous);
    },
    dispose() { const job = this.change(null); bindOwner(() => null); return job; },
  };
};

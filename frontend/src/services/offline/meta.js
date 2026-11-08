import { db, requireOwnerId, safeWrite } from './db.js';
import { newId } from './ids.js';

/**
 * Small key/value metadata helpers for the offline layer: last successful
 * synchronization time and owner-scoped, fenced worker leases.
 */

export const META_KEYS = Object.freeze({
  LAST_SYNCED_AT: 'lastSyncedAt',
  LOCK: 'syncLock',
});

export const lastSyncedKey = (ownerId) => `${META_KEYS.LAST_SYNCED_AT}:${requireOwnerId(ownerId)}`;
export const syncLockKey = (ownerId) => `${META_KEYS.LOCK}:${requireOwnerId(ownerId)}`;
export const DEFAULT_LOCK_TTL_MS = 30_000;

export const readMeta = async (key, fallback = null) => {
  const row = await db.syncMeta.get(key);
  return row ? row.value : fallback;
};

export const writeMeta = async (key, value) => {
  await safeWrite(() => db.syncMeta.put({ key, value, updatedAt: Date.now() }));
};

export const getLastSyncedAt = (ownerId) => readMeta(lastSyncedKey(ownerId), null);

/**
 * Acquire a fresh fence, even when a worker id is reused after a refresh.
 * An unexpired legacy global lease is quarantined until it expires; deleting
 * it eagerly could overlap a worker from a still-open, older application tab.
 */
export const acquireLock = async (ownerId, workerId, { ttlMs = DEFAULT_LOCK_TTL_MS, now = Date.now } = {}) => {
  requireOwnerId(ownerId);
  if (!workerId || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('A worker and positive lease TTL are required.');
  return db.transaction('rw', db.syncMeta, async () => {
    const at = now();
    const legacy = await db.syncMeta.get(META_KEYS.LOCK);
    if (legacy?.value && legacy.value.expiresAt > at) return null;
    if (legacy) await db.syncMeta.delete(META_KEYS.LOCK);
    const key = syncLockKey(ownerId);
    const existing = await db.syncMeta.get(key);
    if (existing?.value && existing.value.expiresAt > at) return null;
    const lease = { ownerId, workerId, token: newId(), expiresAt: at + ttlMs };
    await db.syncMeta.put({
      key,
      value: lease,
      updatedAt: at,
    });
    return lease;
  });
};

export const lockMatches = (value, lease, at = Date.now()) => Boolean(
  value && lease && value.ownerId === lease.ownerId && value.workerId === lease.workerId &&
  value.token === lease.token && value.expiresAt > at,
);

/** Also usable within a transaction including syncMeta for atomic fenced writes. */
export const ownsLock = async (lease, now = Date.now) => {
  if (!lease?.ownerId || !lease?.token) return false;
  const row = await db.syncMeta.get(syncLockKey(lease.ownerId));
  return lockMatches(row?.value, lease, now());
};

export const renewLock = async (lease, { ttlMs = DEFAULT_LOCK_TTL_MS, now = Date.now } = {}) => {
  requireOwnerId(lease?.ownerId);
  return db.transaction('rw', db.syncMeta, async () => {
    const key = syncLockKey(lease.ownerId);
    const row = await db.syncMeta.get(key);
    const at = now();
    if (!lockMatches(row?.value, lease, at)) return false;
    await db.syncMeta.put({
      key,
      value: { ...row.value, expiresAt: at + ttlMs },
      updatedAt: at,
    });
    return true;
  });
};

export const releaseLock = async (lease, { now = Date.now } = {}) => {
  requireOwnerId(lease?.ownerId);
  await db.transaction('rw', db.syncMeta, async () => {
    const key = syncLockKey(lease.ownerId);
    const existing = await db.syncMeta.get(key);
    if (existing?.value?.token === lease.token && existing.value.workerId === lease.workerId) {
      await db.syncMeta.put({ key, value: null, updatedAt: now() });
    }
  });
};

export default {
  META_KEYS,
  lastSyncedKey,
  syncLockKey,
  readMeta,
  writeMeta,
  getLastSyncedAt,
  acquireLock,
  ownsLock,
  renewLock,
  releaseLock,
};

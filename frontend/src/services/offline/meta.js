import { db, safeWrite } from './db.js';

/**
 * Small key/value metadata helpers for the offline layer: last successful
 * synchronization time and the single-worker lock.
 */

export const META_KEYS = Object.freeze({
  LAST_SYNCED_AT: 'lastSyncedAt',
  LOCK: 'syncLock',
});

export const lastSyncedKey = (ownerId) =>
  ownerId ? `${META_KEYS.LAST_SYNCED_AT}:${ownerId}` : META_KEYS.LAST_SYNCED_AT;

export const readMeta = async (key, fallback = null) => {
  const row = await db.syncMeta.get(key);
  return row ? row.value : fallback;
};

export const writeMeta = async (key, value) => {
  await safeWrite(() => db.syncMeta.put({ key, value, updatedAt: Date.now() }));
};

export const getLastSyncedAt = (ownerId = null) => readMeta(lastSyncedKey(ownerId), null);

/**
 * Acquire the single-worker lock. Returns the worker id when acquired, or null
 * when another live worker holds it. A stale lock (owner crashed) is reclaimed.
 */
export const acquireLock = async (workerId, ttlMs = 30_000) => {
  const now = Date.now();
  return db.transaction('rw', db.syncMeta, async () => {
    const existing = await db.syncMeta.get(META_KEYS.LOCK);
    if (existing?.value?.owner && existing.value.expiresAt > now && existing.value.owner !== workerId) {
      return null;
    }
    await db.syncMeta.put({
      key: META_KEYS.LOCK,
      value: { owner: workerId, expiresAt: now + ttlMs },
      updatedAt: now,
    });
    return workerId;
  });
};

export const renewLock = async (workerId, ttlMs = 30_000) => {
  const now = Date.now();
  return db.transaction('rw', db.syncMeta, async () => {
    const row = await db.syncMeta.get(META_KEYS.LOCK);
    if (!row?.value || row.value.owner !== workerId) return false;
    await db.syncMeta.put({
      key: META_KEYS.LOCK,
      value: { owner: workerId, expiresAt: now + ttlMs },
      updatedAt: now,
    });
    return true;
  });
};

export const releaseLock = async (workerId) => {
  await db.transaction('rw', db.syncMeta, async () => {
    const existing = await db.syncMeta.get(META_KEYS.LOCK);
    if (existing?.value?.owner === workerId) {
      await db.syncMeta.put({ key: META_KEYS.LOCK, value: null, updatedAt: Date.now() });
    }
  });
};

export default {
  META_KEYS,
  lastSyncedKey,
  readMeta,
  writeMeta,
  getLastSyncedAt,
  acquireLock,
  renewLock,
  releaseLock,
};

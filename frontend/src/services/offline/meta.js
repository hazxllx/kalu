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
  const existing = await readMeta(META_KEYS.LOCK, null);
  if (existing && existing.owner && existing.expiresAt > now && existing.owner !== workerId) {
    return null;
  }
  await writeMeta(META_KEYS.LOCK, { owner: workerId, expiresAt: now + ttlMs });
  // Re-read to detect a race where two workers wrote concurrently — last write
  // wins, so only the confirmed owner proceeds.
  const confirmed = await readMeta(META_KEYS.LOCK, null);
  return confirmed && confirmed.owner === workerId ? workerId : null;
};

export const renewLock = async (workerId, ttlMs = 30_000) => {
  const existing = await readMeta(META_KEYS.LOCK, null);
  if (!existing || existing.owner !== workerId) return false;
  await writeMeta(META_KEYS.LOCK, { owner: workerId, expiresAt: Date.now() + ttlMs });
  return true;
};

export const releaseLock = async (workerId) => {
  const existing = await readMeta(META_KEYS.LOCK, null);
  if (existing && existing.owner === workerId) {
    await writeMeta(META_KEYS.LOCK, null);
  }
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

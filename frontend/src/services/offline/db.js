import Dexie from 'dexie';

/**
 * KALUSAGAP offline database (IndexedDB via Dexie).
 *
 * Stores ONLY explicitly approved offline data:
 *   - `drafts`   locally created/edited records awaiting server confirmation
 *   - `outbox`   queued synchronization operations (the write-ahead log)
 *   - `records`  a minimal, authorized cache of records the user may read offline
 *   - `syncMeta` synchronization metadata (last success, worker lock, counters)
 *   - `keys`     the device's non-extractable AES-GCM key material
 *
 * It never stores Supabase tokens, passwords, or the service-role key — those
 * never reach the browser. Every row is namespaced by `ownerId` (the Supabase
 * user id) so one account can never read or synchronize another account's data.
 *
 * The schema is versioned. Adding a store or index means bumping the version and
 * adding an upgrade function; downgrades are not supported by Dexie/IndexedDB.
 */
export const OFFLINE_DB_NAME = 'kalusagap-offline';

/** Current local schema version. Bump together with a new `.version(n)` block. */
export const OFFLINE_DB_VERSION = 1;

export class OfflineStorageError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {any} [cause]
   */
  constructor(code, message, cause) {
    super(message);
    this.name = 'OfflineStorageError';
    this.code = code;
    this.cause = cause;
  }
}

export const db = new Dexie(OFFLINE_DB_NAME);

db.version(1).stores({
  // Local drafts keyed by a stable client-generated id.
  drafts: 'localId, entity, ownerId, status, updatedAt',
  // Synchronization operations. The operation id is the primary key and is also
  // the idempotency key basis, so retries can never duplicate a record.
  outbox:
    'opId, entity, ownerId, status, localRecordId, nextAttemptAt, updatedAt, [ownerId+status]',
  // Minimal cached reads, keyed by entity + server id.
  records: '[entity+remoteId], entity, ownerId, cachedAt',
  // Simple key/value metadata (lastSyncedAt, worker lock, ...).
  syncMeta: 'key',
  // Device key material for at-rest encryption.
  keys: 'id',
});

/** True when an error is an IndexedDB storage-quota exhaustion. */
export const isQuotaError = (error) => {
  if (!error) return false;
  const name = error.name || '';
  const message = String(error.message || error);
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    /quota|storage.*full|exceeded the quota/i.test(message)
  );
};

/**
 * Run a database write, translating a storage-quota failure into a typed
 * OfflineStorageError so the UI can tell the user to free space instead of
 * showing a generic error.
 */
export const safeWrite = async (fn) => {
  try {
    return await fn();
  } catch (error) {
    if (isQuotaError(error)) {
      throw new OfflineStorageError(
        'quota',
        'Device storage is full. Free up space or synchronize while online to continue saving offline.',
        error,
      );
    }
    throw error;
  }
};

/** Resolve once the database is open (used before first read/write in the UI). */
export const openOfflineDb = async () => {
  if (!db.isOpen()) await db.open();
  return db;
};

/**
 * Delete the entire offline database. Called on logout and on account switch so
 * a shared device never leaves one user's queued health data for the next user.
 */
export const purgeOfflineDb = async () => {
  try {
    db.close();
    await Dexie.delete(OFFLINE_DB_NAME);
  } catch {
    /* best effort — a locked DB is retried on next load */
  }
};

export default db;

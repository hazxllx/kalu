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
export const OFFLINE_DB_VERSION = 4;

/**
 * @typedef {Record<string, unknown> & {
 *   localId: string,
 *   entity: string,
 *   ownerId: string,
 *   data: unknown,
 *   status: string,
 *   createdAt: number,
 *   updatedAt: number,
 *   serverId?: string | null,
 *   revision?: number | null,
 *   localRef?: string,
 *   targetServerId?: string | null,
 *   lastError?: unknown,
 *   mutationType?: string
 * }} OfflineDraftRow
 */

/**
 * @typedef {Record<string, unknown> & {
 *   opId: string,
 *   entity: string,
 *   opType: 'create' | 'update',
 *   mutationType: string,
 *   ownerId: string,
 *   localRecordId: string,
 *   payload: unknown,
 *   dependsOn: string[],
 *   idempotencyKey: string,
 *   status: string,
 *   attempts: number,
 *   maxAttempts: number,
 *   nextAttemptAt: number,
 *   createdAt: number,
 *   updatedAt: number,
 *   targetServerId?: string | null,
 *   baseRevision?: number | null,
 *   serverId?: string | null,
 *   serverRecord?: unknown,
 *   syncingAt?: number,
 *   workerId?: string,
 *   syncedAt?: number | null,
 *   lastError?: unknown
 * }} OfflineOutboxRow
 */

/**
 * @typedef {Record<string, unknown> & {
 *   entity: string,
 *   remoteId: string,
 *   ownerId: string,
 *   data: unknown,
 *   cachedAt: number,
 *   revision?: number | null
 * }} OfflineRecordRow
 */

/**
 * @typedef {Record<string, unknown> & {
 *   key: string,
 *   value: any,
 *   updatedAt: number
 * }} OfflineMetaRow
 */

/**
 * @typedef {Record<string, unknown> & {
 *   id: string,
 *   cryptoKey?: CryptoKey,
 *   raw?: string,
 *   kind?: string,
 *   createdAt?: string
 * }} OfflineKeyRow
 */

/**
 * Dexie creates each declared store property when its schema is registered.
 * Declare their types here because the base JavaScript type does not know the
 * configured store names.
 */
export class OfflineDatabase extends Dexie {
  /** @type {import('dexie').Table<OfflineDraftRow, string>} */
  drafts;

  /** @type {import('dexie').Table<OfflineOutboxRow, string>} */
  outbox;

  /** @type {import('dexie').Table<OfflineRecordRow, import('dexie').IndexableType>} */
  records;

  /** @type {import('dexie').Table<OfflineMetaRow, string>} */
  syncMeta;

  /** @type {import('dexie').Table<OfflineKeyRow, string>} */
  keys;
}

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

export const db = new OfflineDatabase(OFFLINE_DB_NAME);

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

// Migration from v1 to v4: the original direct primary-key change
// (`[entity+remoteId]` -> `[ownerId+entity+remoteId]`) is unsupported by
// Dexie/IndexedDB and throws `UpgradeError: Not yet support for changing
// primary key`. That error blocked the entire PHN check-up queue because the
// offline DB failed to open and the workflow API surfaced it as a server
// failure. Dexie can only change a primary key by deleting and recreating the
// object store. We do that safely in three steps, preserving drafts/outbox
// and all records via a temporary table so the migration is retry-safe and
// never discards offline work.
//
//  v2: copy existing `records` -> `records_backup` (same new key, deduplicated)
//  v3: delete the old `records` store (frees the name) while keeping the backup
//  v4: recreate `records` with the correct owner-scoped key and restore.
db.version(2)
  .stores({
    drafts: 'localId, entity, ownerId, status, updatedAt',
    outbox:
      'opId, entity, ownerId, status, localRecordId, nextAttemptAt, updatedAt, [ownerId+status]',
    records: '[entity+remoteId], entity, ownerId, cachedAt',
    records_backup: '[ownerId+entity+remoteId], ownerId, entity, remoteId, cachedAt',
    syncMeta: 'key',
    keys: 'id',
  })
  .upgrade(async (tx) => {
    const all = await tx.table('records').toArray();
    if (all.length === 0) return;
    // Deduplicate on the future compound key; keep newest cachedAt.
    const byKey = new Map();
    for (const row of all) {
      if (!row.ownerId || !row.entity || row.remoteId == null) continue;
      const key = `${row.ownerId}|${row.entity}|${String(row.remoteId)}`;
      const prev = byKey.get(key);
      if (!prev || (row.cachedAt || 0) > (prev.cachedAt || 0)) byKey.set(key, row);
    }
    const deduped = Array.from(byKey.values());
    // Use bulkPut inside the versionchange transaction: atomic, retry-safe.
    // If this throws the whole IndexedDB version stays at 1 and will retry.
    await tx.table('records_backup').bulkPut(deduped);
  });

db.version(3)
  .stores({
    drafts: 'localId, entity, ownerId, status, updatedAt',
    outbox:
      'opId, entity, ownerId, status, localRecordId, nextAttemptAt, updatedAt, [ownerId+status]',
    records: null,
    records_backup: '[ownerId+entity+remoteId], ownerId, entity, remoteId, cachedAt',
    syncMeta: 'key',
    keys: 'id',
  })
  .upgrade(async (tx) => {
    // Fresh installs that were created directly at v2 (new schema) skip the
    // v2 upgrade, so records_backup is empty. Preserve their cached records
    // before the declarative delete by copying them now.
    const backupCount = await tx.table('records_backup').count();
    if (backupCount > 0) return;
    // `records` still exists in this transaction's scope even though the
    // declarative schema deletes it afterwards (Dexie keeps old schema for
    // upgrade). If it has rows, back them up.
    try {
      const all = await tx.table('records').toArray();
      if (all.length > 0) await tx.table('records_backup').bulkPut(all);
    } catch {
      // If the store truly does not exist (fresh DB already at v3), ignore.
    }
  });

db.version(4)
  .stores({
    drafts: 'localId, entity, ownerId, status, updatedAt',
    outbox:
      'opId, entity, ownerId, status, localRecordId, nextAttemptAt, updatedAt, [ownerId+status]',
    records: '[ownerId+entity+remoteId], ownerId, entity, remoteId, cachedAt',
    records_backup: null,
    syncMeta: 'key',
    keys: 'id',
  })
  .upgrade(async (tx) => {
    const backup = await tx.table('records_backup').toArray();
    if (backup.length > 0) {
      // Deduplicate again on restore (defensive; retry-safe).
      const byKey = new Map();
      for (const row of backup) {
        if (!row.ownerId || !row.entity || row.remoteId == null) continue;
        const key = `${row.ownerId}|${row.entity}|${String(row.remoteId)}`;
        const prev = byKey.get(key);
        if (!prev || (row.cachedAt || 0) > (prev.cachedAt || 0)) byKey.set(key, row);
      }
      await tx.table('records').bulkPut(Array.from(byKey.values()));
    }
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

/** True when an error is the Dexie primary-key migration failure. */
export const isUpgradeError = (error) => {
  if (!error) return false;
  const name = String(error.name || '');
  const msg = String(error.message || error);
  return /UpgradeError/i.test(name) || /Not yet support for changing primary key/i.test(msg);
};

/**
 * Delete the entire offline database for an explicit device cleanup action.
 * Normal logout/session expiry must not call this: pending work is retained
 * and remains inaccessible to other accounts through owner-scoped queries.
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

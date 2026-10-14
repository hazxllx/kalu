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
export const OFFLINE_DB_UPGRADE_BLOCKED_EVENT = 'kalusagap:offline-db-upgrade-blocked';
export const OFFLINE_DB_READY_EVENT = 'kalusagap:offline-db-ready';
let offlineDbUpgradeBlocked = false;

export const isOfflineDbUpgradeBlocked = () => offlineDbUpgradeBlocked;

/** Current local schema version. Bump together with a new `.version(n)` block. */
export const OFFLINE_DB_VERSION = 5;
const OFFLINE_DB_IDB_VERSION = OFFLINE_DB_VERSION * 10;

const RECORDS_KEY_PATH = ['ownerId', 'entity', 'remoteId'];

const ensureIndex = (store, name, keyPath) => {
  if (store.indexNames.contains(name)) {
    const existing = store.index(name);
    if (JSON.stringify(existing.keyPath) === JSON.stringify(keyPath)) return;
    store.deleteIndex(name);
  }
  store.createIndex(name, keyPath, { unique: false });
};

const migrateRecordRows = (rows) => {
  const byKey = new Map();
  for (const row of rows) {
    if (!row || !row.entity || row.remoteId == null) continue;
    const ownerId = typeof row.ownerId === 'string' ? row.ownerId : '';
    const migrated = { ...row, ownerId, remoteId: String(row.remoteId) };
    const key = JSON.stringify([ownerId, migrated.entity, migrated.remoteId]);
    const previous = byKey.get(key);
    if (!previous || (migrated.cachedAt || 0) > (previous.cachedAt || 0)) {
      byKey.set(key, migrated);
    }
  }
  return Array.from(byKey.values());
};

/**
 * Migrate the physical IndexedDB schema before Dexie validates its declared
 * historical versions. Some deployed v2 databases already have the new
 * compound key on `records`; Dexie cannot reconcile that with a v2 declaration
 * that still describes the old key, so its upgrader fails before callbacks run.
 * A single native versionchange transaction inspects the actual store, copies
 * cached records, recreates only that store, and leaves drafts/outbox/keys intact.
 */
export const prepareOfflineDatabase = async () => {
  if (typeof indexedDB === 'undefined') return;

  const probe = indexedDB.open(OFFLINE_DB_NAME);
  const currentVersion = await new Promise((resolve, reject) => {
    probe.onerror = () => reject(probe.error || new Error('Could not inspect offline storage.'));
    probe.onblocked = () => reject(new Error('Offline storage inspection is blocked by another browser tab.'));
    probe.onsuccess = () => {
      const version = probe.result.version;
      probe.result.close();
      resolve(version);
    };
  });

  if (currentVersion === OFFLINE_DB_IDB_VERSION) return;
  if (currentVersion > OFFLINE_DB_IDB_VERSION) {
    throw new Error(`Offline storage version ${currentVersion} is newer than this application supports.`);
  }

  const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_IDB_VERSION);
  await new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error || new Error('Could not migrate offline storage.'));
    request.onblocked = () => reject(new Error('Offline storage migration is blocked by another browser tab. Close other KALUSAGAP tabs and reload.'));
    request.onupgradeneeded = () => {
      const database = request.result;
      const transaction = request.transaction;
      const sourceRows = [];
      const sourceNames = ['records', 'records_backup'].filter((name) =>
        database.objectStoreNames.contains(name),
      );

      const requests = sourceNames.map((name) => transaction.objectStore(name).getAll());
      const finishMigration = () => {
        const migratedRows = migrateRecordRows(sourceRows.flat());

        for (const name of ['drafts', 'outbox', 'syncMeta', 'keys']) {
          if (!database.objectStoreNames.contains(name)) {
            const keyPaths = { drafts: 'localId', outbox: 'opId', syncMeta: 'key', keys: 'id' };
            database.createObjectStore(name, { keyPath: keyPaths[name] });
          }
        }

        if (database.objectStoreNames.contains('records')) database.deleteObjectStore('records');
        if (database.objectStoreNames.contains('records_backup')) database.deleteObjectStore('records_backup');
        const records = database.createObjectStore('records', { keyPath: RECORDS_KEY_PATH });
        for (const name of ['ownerId', 'entity', 'remoteId', 'cachedAt']) {
          ensureIndex(records, name, name);
        }

        const drafts = transaction.objectStore('drafts');
        for (const name of ['entity', 'ownerId', 'status', 'updatedAt']) ensureIndex(drafts, name, name);
        const outbox = transaction.objectStore('outbox');
        for (const name of ['entity', 'ownerId', 'status', 'localRecordId', 'nextAttemptAt', 'updatedAt']) {
          ensureIndex(outbox, name, name);
        }
        ensureIndex(outbox, '[ownerId+status]', ['ownerId', 'status']);

        for (const row of migratedRows) records.put(row);
      };

      if (requests.length === 0) {
        finishMigration();
      } else {
        let completed = 0;
        requests.forEach((sourceRequest, index) => {
          sourceRequest.onsuccess = () => {
            sourceRows[index] = sourceRequest.result;
            completed += 1;
            if (completed === requests.length) finishMigration();
          };
        });
      }

    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  }).catch(async (error) => {
    if (error?.name !== 'VersionError') throw error;
    const latest = indexedDB.open(OFFLINE_DB_NAME);
    const latestVersion = await new Promise((resolve, reject) => {
      latest.onerror = () => reject(latest.error || error);
      latest.onsuccess = () => {
        const version = latest.result.version;
        latest.result.close();
        resolve(version);
      };
    });
    if (latestVersion !== OFFLINE_DB_IDB_VERSION) throw error;
  });
};

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
  open() {
    if (this.isOpen()) return super.open();
    return prepareOfflineDatabase().then(() => super.open());
  }

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

db.on('blocked', () => {
  offlineDbUpgradeBlocked = true;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OFFLINE_DB_UPGRADE_BLOCKED_EVENT));
  }
});
db.on('ready', () => {
  offlineDbUpgradeBlocked = false;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OFFLINE_DB_READY_EVENT));
  }
});

db.version(OFFLINE_DB_VERSION).stores({
    drafts: 'localId, entity, ownerId, status, updatedAt',
    outbox:
      'opId, entity, ownerId, status, localRecordId, nextAttemptAt, updatedAt, [ownerId+status]',
    records: '[ownerId+entity+remoteId], ownerId, entity, remoteId, cachedAt',
    syncMeta: 'key',
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

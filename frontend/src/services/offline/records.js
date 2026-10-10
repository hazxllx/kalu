import { db, safeWrite } from './db.js';
import { decryptJson, encryptJson } from './crypto.js';

/**
 * Minimal cache of authorized records for offline reads.
 *
 * Only records the signed-in user is authorized to see are written here, and
 * only a bounded set (callers decide what to cache). Payloads are encrypted at
 * rest by the same device key as drafts. Cache entries are advisory: the server
 * remains authoritative, and a cached record is never used to bypass server
 * authorization after reconnection.
 */

export const cacheRecord = async ({ entity, remoteId, ownerId, data, revision = null }) => {
  const encrypted = await encryptJson(data);
  await safeWrite(() =>
    db.records.put({
      entity,
      remoteId: String(remoteId),
      ownerId,
      data: encrypted,
      revision,
      cachedAt: Date.now(),
    }),
  );
};

export const getCachedRecord = async (entity, remoteId, ownerId) => {
  if (!ownerId) return null;
  const row = await db.records.get([ownerId, entity, String(remoteId)]);
  if (!row) return null;
  return { ...row, data: row.data ? await decryptJson(row.data) : null };
};

export const listCachedRecords = async (ownerId, entity = null) => {
  const rows = await db.records.where('ownerId').equals(ownerId).toArray();
  const filtered = entity ? rows.filter((row) => row.entity === entity) : rows;
  const out = [];
  for (const row of filtered) {
    out.push({ ...row, data: row.data ? await decryptJson(row.data) : null });
  }
  return out.sort((a, b) => b.cachedAt - a.cachedAt);
};

export const removeCachedRecord = async (entity, remoteId, ownerId) => {
  if (!ownerId) return;
  await safeWrite(() => db.records.delete([ownerId, entity, String(remoteId)]));
};

export const countCachedRecords = async (ownerId) => {
  if (!ownerId) return 0;
  return db.records.where('ownerId').equals(ownerId).count();
};

export default {
  cacheRecord,
  getCachedRecord,
  listCachedRecords,
  removeCachedRecord,
  countCachedRecords,
};

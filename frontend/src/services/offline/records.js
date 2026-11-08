import {
  assertCurrentOwner,
  captureOwnerGuard,
  db,
  invalidateOfflineOwner,
  requireEncryptedPayload,
  requireOwnerId,
  safeWrite,
  waitForOfflineCrypto,
} from './db.js';
import { decryptJson, encryptJson, isEncryptedEnvelope } from './crypto.js';

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_CACHED_RECORDS = 500;
const settled = (row) => row.status === 'synced' || row.status === 'resolved';
const recordKey = (row) => JSON.stringify([row.entity, String(row.remoteId)]);

const referenceEntity = (entity) => {
  if (/^(resident|residentDirectory|consultationResidentDirectory|rhuResidentIdentity|patient)$/i.test(entity)) return 'resident';
  if (/^(householdMember.*|member)$/i.test(entity)) return 'member';
  if (entity === 'consultationDraft') return 'consultation';
  return entity;
};
const referenceKey = (entity, id) => JSON.stringify([referenceEntity(entity), String(id)]);

const addReference = (references, entity, id) => {
  if (!entity || id === null || id === undefined || id === '' || typeof id === 'object') return;
  references.add(referenceKey(entity, id));
  // Household member ids often identify their underlying registered resident.
  if (referenceEntity(entity) === 'member') references.add(referenceKey('resident', id));
};

const collectReferences = (data, entity, references) => {
  if (!data || typeof data !== 'object') return;
  if (Array.isArray(data)) {
    for (const value of data) {
      if (typeof value === 'object') collectReferences(value, entity, references);
      else addReference(references, entity, value);
    }
    return;
  }
  for (const [key, value] of Object.entries(data)) {
    const normalized = key.replace(/[_-]/g, '').toLowerCase();
    const relation = normalized.match(/(resident|patient|household|member|consultation|visit)ids?$/)?.[1];
    if (relation) {
      for (const id of Array.isArray(value) ? value : [value]) addReference(references, relation, id);
    } else if (['id', 'remoteid', 'serverid', 'targetserverid'].includes(normalized)) {
      addReference(references, entity, value);
    }
    const nestedEntity = /^(resident|residents|patient|patients)$/.test(normalized)
      ? 'resident'
      : /^(member|members|householdmembers)$/.test(normalized)
        ? 'member'
        : /^(household|households)$/.test(normalized)
          ? 'household'
          : entity;
    if (value && typeof value === 'object') collectReferences(value, nestedEntity, references);
  }
};

/** Must run in a transaction covering records/outbox/drafts/keys. */
const retentionState = async (ownerId, isOwnerCurrent) => {
  requireOwnerId(ownerId);
  assertCurrentOwner(isOwnerCurrent);
  const [records, operations, drafts] = await Promise.all([
    db.records.where('ownerId').equals(ownerId).toArray(),
    db.outbox.where('ownerId').equals(ownerId).toArray(),
    db.drafts.where('ownerId').equals(ownerId).toArray(),
  ]);
  assertCurrentOwner(isOwnerCurrent);
  const byId = new Map(operations.map((op) => [op.opId, op]));
  const protectedOperations = new Set();
  const protectedDrafts = new Set(drafts.filter((row) => !settled(row)).map((row) => row.localId));
  const visitOperation = (op) => {
    if (!op || protectedOperations.has(op.opId)) return;
    protectedOperations.add(op.opId);
    if (op.localRecordId) protectedDrafts.add(op.localRecordId);
    for (const dependency of op.dependsOn || []) visitOperation(byId.get(dependency));
  };
  for (const op of operations) if (!settled(op)) visitOperation(op);
  const references = new Set();
  let protectAll = false;
  const decode = async (value) => {
    try {
      const result = isEncryptedEnvelope(value)
        ? await waitForOfflineCrypto(decryptJson(value))
        : value;
      assertCurrentOwner(isOwnerCurrent);
      return result;
    } catch {
      assertCurrentOwner(isOwnerCurrent);
      // Corrupt pending data is not evidence that its base records are unused.
      protectAll = true;
      return null;
    }
  };
  for (const op of operations) {
    if (!protectedOperations.has(op.opId)) continue;
    addReference(references, op.entity, op.targetServerId);
    addReference(references, op.entity, op.serverId);
    collectReferences(await decode(op.payload), op.entity, references);
    if (op.serverRecord) collectReferences(await decode(op.serverRecord), op.entity, references);
  }
  for (const draft of drafts) {
    if (!protectedDrafts.has(draft.localId)) continue;
    addReference(references, draft.entity, draft.targetServerId);
    addReference(references, draft.entity, draft.serverId);
    collectReferences(await decode(draft.data), draft.entity, references);
  }

  const protectedRecords = new Set();
  if (protectedOperations.size || protectedDrafts.size) {
    const links = new Map();
    for (const record of records) {
      const recordReferences = new Set();
      collectReferences(await decode(record.data), record.entity, recordReferences);
      links.set(recordKey(record), recordReferences);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of records) {
        const key = recordKey(record);
        if (protectedRecords.has(key)) continue;
        const linked = links.get(key);
        const reverseHouseholdLink = /^(household|householdMember.*)$/.test(record.entity) &&
          [...linked].some((reference) => references.has(reference));
        if (!references.has(referenceKey(record.entity, record.remoteId)) && !reverseHouseholdLink) continue;
        protectedRecords.add(key);
        for (const reference of linked) references.add(reference);
        changed = true;
      }
    }
  }
  if (protectAll) for (const record of records) protectedRecords.add(recordKey(record));
  return { records, operations, drafts, protectedRecords, protectedOperations, protectedDrafts };
};

const retainRecords = async (snapshot, {
  now = Date.now,
  ttlMs = CACHE_TTL_MS,
  maxRecords = MAX_CACHED_RECORDS,
  clearDisposable = false,
} = {}) => {
  if (!Number.isFinite(ttlMs) || ttlMs < 0 || !Number.isInteger(maxRecords) || maxRecords < 0) {
    throw new Error('Cache TTL and record limit must be non-negative.');
  }
  const at = now();
  const pinned = snapshot.records.filter((row) => snapshot.protectedRecords.has(recordKey(row)));
  const disposable = snapshot.records.filter((row) => !snapshot.protectedRecords.has(recordKey(row)));
  const reusable = clearDisposable ? [] : disposable
    .filter((row) => row.cachedAt <= at && at - row.cachedAt < ttlMs)
    .sort((a, b) => (b.lastAccessedAt ?? b.cachedAt) - (a.lastAccessedAt ?? a.cachedAt) ||
      b.cachedAt - a.cachedAt || recordKey(a).localeCompare(recordKey(b)))
    .slice(0, Math.max(0, maxRecords - pinned.length));
  const retained = new Set([...pinned, ...reusable].map(recordKey));
  const removed = snapshot.records.filter((row) => !retained.has(recordKey(row)));
  if (removed.length) {
    await db.records.bulkDelete(removed.map((row) => [row.ownerId, row.entity, row.remoteId]));
  }
  return snapshot.records.filter((row) => retained.has(recordKey(row)));
};

const cacheTransaction = (fn) => safeWrite(() =>
  db.transaction('rw', db.records, db.outbox, db.drafts, db.keys, fn),
);

/** Authorized form data is preserved, not projected into an unusable summary. */
export const cacheRecord = async ({ entity, remoteId, ownerId, data, revision = null }, options = {}) => {
  requireOwnerId(ownerId);
  const isOwnerCurrent = options.isOwnerCurrent || captureOwnerGuard(ownerId);
  assertCurrentOwner(isOwnerCurrent);
  if (!entity || remoteId === null || remoteId === undefined || remoteId === '') throw new Error('A record identity is required.');
  const encrypted = requireEncryptedPayload(await encryptJson(data));
  assertCurrentOwner(isOwnerCurrent);
  return cacheTransaction(async () => {
    assertCurrentOwner(isOwnerCurrent);
    const at = (options.now || Date.now)();
    await db.records.put({ entity, remoteId: String(remoteId), ownerId, data: encrypted, revision, cachedAt: at, lastAccessedAt: at });
    assertCurrentOwner(isOwnerCurrent);
    const snapshot = await retentionState(ownerId, isOwnerCurrent);
    const retained = await retainRecords(snapshot, options);
    assertCurrentOwner(isOwnerCurrent);
    return retained.some((row) => row.entity === entity && row.remoteId === String(remoteId));
  });
};

export const pruneRecordCache = async (ownerId, options = {}) => {
  const isOwnerCurrent = options.isOwnerCurrent || captureOwnerGuard(ownerId);
  return cacheTransaction(async () => {
    const snapshot = await retentionState(ownerId, isOwnerCurrent);
    const retained = await retainRecords(snapshot, options);
    assertCurrentOwner(isOwnerCurrent);
    return { removed: snapshot.records.length - retained.length, retained: retained.length, protected: snapshot.protectedRecords.size };
  });
};

export const getCachedRecord = async (entity, remoteId, ownerId, options = {}) => {
  const isOwnerCurrent = options.isOwnerCurrent || captureOwnerGuard(ownerId);
  return cacheTransaction(async () => {
    const snapshot = await retentionState(ownerId, isOwnerCurrent);
    const target = snapshot.records.find((row) => row.entity === entity && row.remoteId === String(remoteId));
    if (!target) return null;
    const at = (options.now || Date.now)();
    target.lastAccessedAt = at;
    const retained = await retainRecords(snapshot, options);
    assertCurrentOwner(isOwnerCurrent);
    if (!retained.includes(target)) return null;
    const data = target.data ? await waitForOfflineCrypto(decryptJson(target.data)) : null;
    assertCurrentOwner(isOwnerCurrent);
    await db.records.update([ownerId, entity, String(remoteId)], { lastAccessedAt: at });
    assertCurrentOwner(isOwnerCurrent);
    return { ...target, data, stale: at - target.cachedAt >= (options.ttlMs ?? CACHE_TTL_MS) };
  });
};

export const listCachedRecords = async (ownerId, entity = null, options = {}) => {
  const isOwnerCurrent = options.isOwnerCurrent || captureOwnerGuard(ownerId);
  return cacheTransaction(async () => {
    const snapshot = await retentionState(ownerId, isOwnerCurrent);
    const retained = await retainRecords(snapshot, options);
    assertCurrentOwner(isOwnerCurrent);
    const at = (options.now || Date.now)();
    const out = [];
    for (const row of retained) {
      if (entity && row.entity !== entity) continue;
      const data = row.data ? await waitForOfflineCrypto(decryptJson(row.data)) : null;
      assertCurrentOwner(isOwnerCurrent);
      await db.records.update([ownerId, row.entity, row.remoteId], { lastAccessedAt: at });
      assertCurrentOwner(isOwnerCurrent);
      out.push({ ...row, data, lastAccessedAt: at, stale: at - row.cachedAt >= (options.ttlMs ?? CACHE_TTL_MS) });
    }
    return out.sort((a, b) => b.cachedAt - a.cachedAt);
  });
};

export const removeCachedRecord = async (entity, remoteId, ownerId) => {
  const isOwnerCurrent = captureOwnerGuard(ownerId);
  return cacheTransaction(async () => {
    const snapshot = await retentionState(ownerId, isOwnerCurrent);
    if (snapshot.protectedRecords.has(recordKey({ entity, remoteId }))) return false;
    await db.records.delete([ownerId, entity, String(remoteId)]);
    assertCurrentOwner(isOwnerCurrent);
    return true;
  });
};

export const countCachedRecords = async (ownerId, options = {}) => (await pruneRecordCache(ownerId, options)).retained;

/** Explicit old-owner cleanup: authentication may already have switched. */
export const clearAccountSensitiveCache = async (ownerId) => {
  requireOwnerId(ownerId);
  invalidateOfflineOwner(ownerId);
  return cacheTransaction(async () => {
    const snapshot = await retentionState(ownerId, () => true);
    const retained = await retainRecords(snapshot, { clearDisposable: true });
    const operations = snapshot.operations.filter((op) => settled(op) && !snapshot.protectedOperations.has(op.opId));
    const drafts = snapshot.drafts.filter((draft) => settled(draft) && !snapshot.protectedDrafts.has(draft.localId));
    await db.outbox.bulkDelete(operations.map((op) => op.opId));
    await db.drafts.bulkDelete(drafts.map((draft) => draft.localId));
    return { recordsRemoved: snapshot.records.length - retained.length, operationsRemoved: operations.length, draftsRemoved: drafts.length, recordsRetained: retained.length };
  });
};

export default { cacheRecord, getCachedRecord, listCachedRecords, removeCachedRecord, countCachedRecords, pruneRecordCache, clearAccountSensitiveCache };

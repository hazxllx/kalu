import { assertCurrentOwner, captureOwnerGuard, db, requireEncryptedPayload, requireOwnerId, safeWrite } from './db.js';
import { decryptJson, encryptJson } from './crypto.js';
import { ownsLock } from './meta.js';

/**
 * Local drafts — records created or edited on this device that are not yet
 * confirmed by PostgreSQL.
 *
 * DRAFT_STATUS mirrors the outbox so the UI can label a row consistently:
 *   pending / syncing / synced / failed / conflict
 *
 * A draft is NEVER presented as successfully saved to the server: it stays
 * `pending` (or `failed`/`conflict`) until the sync engine records a confirmed
 * server response and reconciles the authoritative values.
 */

export const DRAFT_STATUS = Object.freeze({
  PENDING: 'pending',
  OFFLINE_DRAFT: 'offline_draft',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  FAILED: 'failed',
  CONFLICT: 'conflict',
  RESOLVED: 'resolved',
});

/** Persist a local draft (payload encrypted at rest). */
export const putDraft = async ({ localId, entity, ownerId, data, status = DRAFT_STATUS.PENDING, serverId = null, revision = null }) => {
  const isOwnerCurrent = captureOwnerGuard(ownerId);
  assertCurrentOwner(isOwnerCurrent);
  const now = Date.now();
  const encrypted = requireEncryptedPayload(await encryptJson(data));
  assertCurrentOwner(isOwnerCurrent);
  const record = await safeWrite(() => db.transaction('rw', db.drafts, async () => {
    assertCurrentOwner(isOwnerCurrent);
    const existing = await db.drafts.get(localId);
    assertCurrentOwner(isOwnerCurrent);
    if (existing && existing.ownerId !== ownerId) throw new Error('A draft cannot change owner.');
    const row = {
      ...existing, localId, entity, ownerId, data: encrypted, status,
      serverId: serverId ?? existing?.serverId ?? null,
      revision: revision ?? existing?.revision ?? null,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    await db.drafts.put(row);
    assertCurrentOwner(isOwnerCurrent);
    return row;
  }));
  return { ...record, data };
};

/** Read and decrypt a single draft. */
export const getDraft = async (localId, ownerId, { isOwnerCurrent = captureOwnerGuard(ownerId) } = {}) => {
  requireOwnerId(ownerId);
  assertCurrentOwner(isOwnerCurrent);
  const record = await db.drafts.get(localId);
  assertCurrentOwner(isOwnerCurrent);
  if (!record || record.ownerId !== ownerId) return null;
  const data = record.data ? await decryptJson(record.data) : null;
  assertCurrentOwner(isOwnerCurrent);
  return { ...record, data };
};

/** List a user's drafts, optionally filtered by entity. */
export const listDrafts = async (ownerId, entity = null) => {
  const isOwnerCurrent = captureOwnerGuard(ownerId);
  assertCurrentOwner(isOwnerCurrent);
  let rows = await db.drafts.where('ownerId').equals(ownerId).toArray();
  assertCurrentOwner(isOwnerCurrent);
  if (entity) rows = rows.filter((row) => row.entity === entity);
  const decrypted = [];
  for (const row of rows) {
    decrypted.push({ ...row, data: row.data ? await decryptJson(row.data) : null });
    assertCurrentOwner(isOwnerCurrent);
  }
  return decrypted.sort((a, b) => b.updatedAt - a.updatedAt);
};

export const getOfflineDraftCount = async (ownerId) => {
  if (!ownerId) return 0;
  const isOwnerCurrent = captureOwnerGuard(ownerId);
  assertCurrentOwner(isOwnerCurrent);
  const count = await db.drafts
    .where('ownerId')
    .equals(ownerId)
    .filter((row) => row.status === DRAFT_STATUS.OFFLINE_DRAFT)
    .count();
  assertCurrentOwner(isOwnerCurrent);
  return count;
};

export const markDraftStatus = async (localId, status, patch = {}, ownerId, {
  isOwnerCurrent = captureOwnerGuard(ownerId), lease = null, now = Date.now,
} = {}) => {
  requireOwnerId(ownerId);
  if ('ownerId' in patch && patch.ownerId !== ownerId) throw new Error('A draft cannot change owner.');
  return safeWrite(() => db.transaction('rw', db.drafts, db.syncMeta, async () => {
    assertCurrentOwner(isOwnerCurrent);
    const existing = localId ? await db.drafts.get(localId) : null;
    assertCurrentOwner(isOwnerCurrent);
    if (!existing || existing.ownerId !== ownerId) return false;
    if (lease && (lease.ownerId !== ownerId || !(await ownsLock(lease, now)))) {
      throw Object.assign(new Error('The synchronization lease is no longer held.'), { code: 'lease-lost' });
    }
    assertCurrentOwner(isOwnerCurrent);
    await db.drafts.update(localId, { status, ...patch, updatedAt: now() });
    assertCurrentOwner(isOwnerCurrent);
    return true;
  }));
};

/**
 * Reconcile a draft with the authoritative server record after a confirmed
 * sync: the server values win and the local status becomes `synced`. The
 * authoritative record is re-encrypted at rest like any other payload.
 */
export const reconcileDraft = async (localId, serverRecord, { serverId = null, ownerId, ...context } = {}) => {
  const isOwnerCurrent = context.isOwnerCurrent || captureOwnerGuard(ownerId);
  const existing = await getDraft(localId, ownerId, { isOwnerCurrent });
  if (!existing) return null;
  const authoritative = serverRecord || null;
  const encrypted = requireEncryptedPayload(await encryptJson(authoritative ?? existing.data));
  assertCurrentOwner(isOwnerCurrent);
  const updated = await markDraftStatus(localId, DRAFT_STATUS.SYNCED, {
      data: encrypted,
      serverId: serverId ?? authoritative?.id ?? existing.serverId ?? null,
      revision: authoritative?.revision ?? existing.revision ?? null,
      authoritative: true,
    }, ownerId, { ...context, isOwnerCurrent });
  return updated ? getDraft(localId, ownerId, { isOwnerCurrent }) : null;
};

export const deleteDraft = async (localId, ownerId) => {
  const isOwnerCurrent = captureOwnerGuard(ownerId);
  return safeWrite(() => db.transaction('rw', db.drafts, async () => {
    assertCurrentOwner(isOwnerCurrent);
    const existing = await db.drafts.get(localId);
    assertCurrentOwner(isOwnerCurrent);
    if (!existing || existing.ownerId !== ownerId) return false;
    await db.drafts.delete(localId);
    assertCurrentOwner(isOwnerCurrent);
    return true;
  }));
};

export default {
  DRAFT_STATUS,
  putDraft,
  getDraft,
  listDrafts,
  getOfflineDraftCount,
  markDraftStatus,
  reconcileDraft,
  deleteDraft,
};

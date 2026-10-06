import { db, safeWrite } from './db.js';
import { decryptJson, encryptJson } from './crypto.js';

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
  SYNCING: 'syncing',
  SYNCED: 'synced',
  FAILED: 'failed',
  CONFLICT: 'conflict',
});

/** Persist a local draft (payload encrypted at rest). */
export const putDraft = async ({ localId, entity, ownerId, data, status = DRAFT_STATUS.PENDING, serverId = null, revision = null }) => {
  const now = Date.now();
  const existing = await db.drafts.get(localId);
  const record = {
    localId,
    entity,
    ownerId,
    data: await encryptJson(data),
    status,
    serverId: serverId ?? existing?.serverId ?? null,
    revision: revision ?? existing?.revision ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await safeWrite(() => db.drafts.put(record));
  return { ...record, data };
};

/** Read and decrypt a single draft. */
export const getDraft = async (localId) => {
  const record = await db.drafts.get(localId);
  if (!record) return null;
  return { ...record, data: record.data ? await decryptJson(record.data) : null };
};

/** List a user's drafts, optionally filtered by entity. */
export const listDrafts = async (ownerId, entity = null) => {
  let rows = await db.drafts.where('ownerId').equals(ownerId).toArray();
  if (entity) rows = rows.filter((row) => row.entity === entity);
  const decrypted = [];
  for (const row of rows) {
    decrypted.push({ ...row, data: row.data ? await decryptJson(row.data) : null });
  }
  return decrypted.sort((a, b) => b.updatedAt - a.updatedAt);
};

export const markDraftStatus = async (localId, status, patch = {}) => {
  await safeWrite(() => db.drafts.update(localId, { status, ...patch, updatedAt: Date.now() }));
};

/**
 * Reconcile a draft with the authoritative server record after a confirmed
 * sync: the server values win and the local status becomes `synced`. The
 * authoritative record is re-encrypted at rest like any other payload.
 */
export const reconcileDraft = async (localId, serverRecord, { serverId = null } = {}) => {
  const existing = await db.drafts.get(localId);
  if (!existing) return null;
  const authoritative = serverRecord || null;
  const encrypted = authoritative === null ? existing.data : await encryptJson(authoritative);
  await safeWrite(() =>
    db.drafts.update(localId, {
      data: encrypted,
      serverId: serverId ?? authoritative?.id ?? existing.serverId ?? null,
      revision: authoritative?.revision ?? existing.revision ?? null,
      status: DRAFT_STATUS.SYNCED,
      authoritative: true,
      updatedAt: Date.now(),
    }),
  );
  return getDraft(localId);
};

export const deleteDraft = async (localId) => {
  await safeWrite(() => db.drafts.delete(localId));
};

export default {
  DRAFT_STATUS,
  putDraft,
  getDraft,
  listDrafts,
  markDraftStatus,
  reconcileDraft,
  deleteDraft,
};

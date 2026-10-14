import { queueOfflineDraft } from './queue.js';
import { listDrafts, getDraft, deleteDraft, markDraftStatus, DRAFT_STATUS } from './drafts.js';
import { cacheRecord, listCachedRecords } from './records.js';
import { isNavigatorOnline } from './connectivity.js';
import { classifySyncError, SYNC_ERROR } from './errors.js';
import { OfflineActionRequiredError } from './mutationPolicy.js';

/**
 * Offline support for the PHN/RHU "Treatment Consultation" workflow
 * (`POST /consultations`, backed by the `visits` table).
 *
 * CLASSIFICATION: OFFLINE_DRAFT (not SAFE_SYNC).
 *
 * A consultation is additive (it does not depend on server-authoritative queue
 * state), so it is architecturally a SAFE_SYNC candidate. It is deliberately
 * NOT auto-synchronized today because the backend does not yet protect
 * `POST /consultations` against duplicate submission: the route has no
 * idempotency middleware and the `visits` table has no `client_operation_key`
 * column (contrast households). Auto-replaying a queued create after a dropped
 * response would therefore insert a DUPLICATE clinical record. Until that
 * server-side idempotency exists, consultations are saved as local drafts and
 * submitted only through an explicit, online, user-initiated action — never by
 * the background sync engine. This preserves data across refresh/restart
 * without ever presenting an unconfirmed consultation as saved on the server,
 * and without weakening authorization or inventing a new backend workflow.
 *
 * The upgrade path to SAFE_SYNC is documented in the delivery notes: add a
 * `visits.client_operation_key` unique column + idempotency middleware on the
 * route (the exact pattern already used by households), then register a
 * `consultation` SAFE_SYNC handler in handlers.js and switch the UI to
 * queueCreate. That change requires an authorized migration.
 *
 * Network calls are INJECTED (`create`, `fetchList`) so this module stays free
 * of the `@/services/api` alias and is unit-testable against fake-indexeddb.
 * Production callers pass the real `consultationsApi` functions.
 */

const ENTITY = 'consultationDraft';
const READ_ENTITY = 'consultation';

const isNetworkFailure = (error) => classifySyncError(error).code === SYNC_ERROR.NETWORK;

/** Strip local-only/display markers before sending to the server. */
export const toServerPayload = (data = {}) => {
  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('_')) continue;
    if (key === 'localId' || key === 'offline' || key === 'syncStatus' || key === 'localRef') continue;
    clean[key] = value;
  }
  return clean;
};

const unwrapConsultation = (result) =>
  (result && typeof result === 'object' && 'consultation' in result ? result.consultation : result) ?? null;

const extractRows = (result) => {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  if (Array.isArray(result.consultations)) return result.consultations;
  return [];
};

/** Shape a draft into a list row the consultation UI can render consistently. */
export const draftToDisplay = (draft) => ({
  ...draft.data,
  id: draft.localRef || draft.localId,
  localId: draft.localId,
  offline: true,
  status: 'Saved Offline',
  syncStatus: 'Saved Offline',
});

/**
 * Save a consultation. When online, submit directly and return the
 * server-confirmed record. When offline (or the request fails on the network),
 * persist a local OFFLINE_DRAFT that survives refresh/restart and is NEVER
 * auto-synchronized. Non-network errors (validation, authorization) are
 * surfaced to the caller rather than silently stored.
 *
 * @param {{ownerId:string, payload:object, create:(data:object)=>Promise<any>, online?:()=>boolean}} args
 */
export const saveConsultationOffline = async ({ ownerId, payload, create, online = isNavigatorOnline }) => {
  if (!ownerId) throw new Error('A signed-in user is required.');
  if (typeof create !== 'function') throw new Error('A consultation create function is required.');

  if (online()) {
    try {
      const result = await create(toServerPayload(payload));
      return { record: unwrapConsultation(result), queued: false, source: 'server', localId: null };
    } catch (error) {
      if (!isNetworkFailure(error)) throw error; // validation/auth/conflict → surface, don't mask
    }
  }

  const { localId, draft } = await queueOfflineDraft({ entity: ENTITY, ownerId, data: payload });
  return { record: draftToDisplay({ ...draft, localId }), queued: true, source: 'local', localId };
};

/** All not-yet-submitted consultation drafts for the owner, newest first. */
export const listConsultationDrafts = async (ownerId) => {
  if (!ownerId) return [];
  const drafts = await listDrafts(ownerId, ENTITY);
  return drafts.filter((draft) => draft.status !== DRAFT_STATUS.SYNCED).map(draftToDisplay);
};

/**
 * Restore a single draft's raw form data (decrypted) so the form can be
 * repopulated after a refresh/restart.
 */
export const restoreConsultationDraft = async ({ ownerId, localId }) => {
  const draft = await getDraft(localId);
  if (!draft || draft.ownerId !== ownerId) return null;
  return { localId: draft.localId, data: draft.data, status: draft.status };
};

export const deleteConsultationDraft = async (localId) => {
  await deleteDraft(localId);
};

/**
 * Explicitly submit a saved draft to the server. Requires connectivity and an
 * authoritative server response. On success the local draft is removed so it
 * cannot be submitted twice (duplicate prevention: there is exactly one, user
 * initiated submit, and the only local copy is deleted once the server
 * confirms). On any failure the draft is preserved so no entered data is lost.
 *
 * A per-draft `syncing` guard prevents a second concurrent submit of the SAME
 * draft within this tab. Cross-tab concurrent submits remain a residual risk
 * until server-side idempotency exists (see module header).
 *
 * @param {{ownerId:string, localId:string, create:(data:object)=>Promise<any>, online?:()=>boolean}} args
 */
export const submitConsultationDraft = async ({ ownerId, localId, create, online = isNavigatorOnline }) => {
  if (!ownerId) throw new Error('A signed-in user is required.');
  if (typeof create !== 'function') throw new Error('A consultation create function is required.');
  if (!online()) throw new OfflineActionRequiredError();

  const draft = await getDraft(localId);
  if (!draft || draft.ownerId !== ownerId) {
    throw Object.assign(
      new Error('This consultation draft is no longer available. It may already be submitted.'),
      { code: 'draft_not_found' },
    );
  }
  if (draft.status === DRAFT_STATUS.SYNCING) {
    throw Object.assign(
      new Error('This consultation is already being submitted.'),
      { code: 'draft_in_progress' },
    );
  }

  await markDraftStatus(localId, DRAFT_STATUS.SYNCING);
  try {
    const result = await create(toServerPayload(draft.data));
    const record = unwrapConsultation(result);
    // Confirmed by the server → remove the only local copy so it cannot be
    // submitted again and become a duplicate.
    await deleteDraft(localId);
    if (record?.id && ownerId) {
      await cacheRecord({ entity: READ_ENTITY, remoteId: record.id, ownerId, data: record, revision: record?.revision ?? null });
    }
    return { record, submitted: true, localId };
  } catch (error) {
    // Never lose the draft: revert it to an editable offline draft and surface
    // the classified error (auth/validation/conflict/network) to the caller.
    await markDraftStatus(localId, DRAFT_STATUS.OFFLINE_DRAFT, { lastError: classifySyncError(error) });
    throw error;
  }
};

/**
 * Consultation history with an offline cache. Online reads refresh the cache;
 * a network failure falls back to the cached authorized rows. Local drafts are
 * prepended so the clinician can see work that has not reached the server yet,
 * clearly labelled "Saved Offline".
 *
 * @param {{ownerId:string, params?:object, fetchList:(params?:object)=>Promise<any>, online?:()=>boolean}} args
 */
export const listConsultationsOffline = async ({ ownerId, params, fetchList, online = isNavigatorOnline }) => {
  if (!ownerId) throw new Error('A signed-in user is required.');
  let rows = null;
  if (online() && typeof fetchList === 'function') {
    try {
      const result = await fetchList(params);
      rows = extractRows(result);
      await Promise.all(
        rows.filter((row) => row?.id).map((row) =>
          cacheRecord({ entity: READ_ENTITY, remoteId: row.id, ownerId, data: row, revision: row?.revision ?? null }),
        ),
      );
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
    }
  }
  if (!rows) {
    rows = (await listCachedRecords(ownerId, READ_ENTITY)).map((row) => row.data);
  }
  const drafts = await listConsultationDrafts(ownerId);
  return [...drafts, ...rows];
};

export default {
  saveConsultationOffline,
  listConsultationDrafts,
  restoreConsultationDraft,
  deleteConsultationDraft,
  submitConsultationDraft,
  listConsultationsOffline,
  toServerPayload,
  draftToDisplay,
};

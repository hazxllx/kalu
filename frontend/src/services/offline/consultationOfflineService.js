import { db, safeWrite, captureOwnerGuard, assertCurrentOwner, requireEncryptedPayload } from './db.js';
import { encryptJson } from './crypto.js';
import { newId, newLocalRef } from './ids.js';
import { listDrafts, getDraft, markDraftStatus, DRAFT_STATUS } from './drafts.js';
import { buildOperation, getOperation, requeueOperation, updateOperation, OUTBOX_STATUS } from './outbox.js';
import { ownsLock } from './meta.js';
import { cacheRecord, listCachedRecords } from './records.js';
import { isNavigatorOnline } from './connectivity.js';
import { classifySyncError, SYNC_ERROR } from './errors.js';
import { MUTATION_TIER, OfflineActionRequiredError } from './mutationPolicy.js';

/**
 * Additive, authorized consultation creates are SAFE_SYNC. The draft and its
 * stable operation UUID are committed BEFORE any online request. First attempt,
 * reconnect, response-loss replay and manual retry use the same outbox/runner.
 * Updates and RHU triage decisions are deliberately not queued here.
 * Network functions are injected so this module is also usable in Node tests.
 */
const ENTITY = 'consultation';
const LEGACY_ENTITY = 'consultationDraft';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isNetworkFailure = (error) => classifySyncError(error).code === SYNC_ERROR.NETWORK;
const malformed = (message) => Object.assign(new Error(message), { code: SYNC_ERROR.MALFORMED });
const conflict = (message) => Object.assign(new Error(message), { status: 409, code: SYNC_ERROR.CONFLICT });
const validTimestamp = (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const canonicalJson = (value) => {
  if (!value || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
};

/** Strip display markers only; never drop clinical fields or operation identity. */
export const toServerPayload = (data = {}) => Object.fromEntries(
  Object.entries(data).filter(([key]) => !key.startsWith('_')
    && !['localId', 'offline', 'syncStatus', 'localRef'].includes(key)),
);

/** A 2xx or an id alone does not prove this operation was durably recorded. */
export const requireConfirmedConsultation = (result, op) => {
  const record = result && typeof result === 'object' && 'consultation' in result ? result.consultation : result;
  const payload = op?.payload || {};
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || typeof record.id !== 'string' || !record.id.trim() || /^(LOCAL|DRAFT)-/.test(record.id)
    || record.offline === true || record.resident?.id !== payload.residentId
    || record.clientOperationKey !== payload.clientOperationKey
    || !UUID.test(record.clientOperationKey || '') || op?.idempotencyKey !== record.clientOperationKey
    || !validTimestamp(record.createdAt) || !validTimestamp(record.recordedAt)
    || !validTimestamp(record.consultationEffectsCompletedAt)
    || Date.parse(record.recordedAt) !== Date.parse(payload.recordedAt)
    || record.consultationDate !== payload.consultationDate
    || (record.consultationTime || '') !== (payload.consultationTime || '')
    || !['draft', 'submitted', 'received', 'in_review', 'referred', 'completed'].includes(record.status)
    || ['chiefComplaint', 'findings', 'diagnosis'].some((field) => typeof record[field] !== 'string' || !record[field].trim())
    || ['chiefComplaint', 'findings', 'diagnosis', 'treatmentGiven', 'adviceGiven', 'remarks', 'nextVisitDate'].some((field) =>
      String(record[field] ?? '').trim() !== String(payload[field] ?? '').trim())
    || Object.entries(payload.consultationDetails || {}).some(([key, value]) => !(key in payload)
      && canonicalJson(record.consultationDetails?.[key]) !== canonicalJson(value))) {
    throw malformed('The server did not confirm this consultation operation. Clinical information remains on this device.');
  }
  return record;
};

/** Shared by the foreground save and the registered reconnect handler. */
export const createConsultationSyncHandler = (create) => {
  const handler = async (op, context = {}) => {
    if (!op?.ownerId || !UUID.test(op.payload?.clientOperationKey || '')
      || op.idempotencyKey !== op.payload.clientOperationKey || !validTimestamp(op.payload.recordedAt)) {
      throw malformed('The queued consultation has no valid original operation identity or recording timestamp.');
    }
    // Permanent attempt metadata survives manual requeue/backoff resets. An
    // ambiguous upload must never become discardable as an unattempted draft.
    const attemptedAt = op.consultationAttemptedAt || Date.now();
    await db.transaction('rw', db.outbox, db.drafts, db.syncMeta, async () => {
      const updated = await updateOperation(op.opId, { consultationAttemptedAt: attemptedAt }, op.ownerId,
        { ...context, expectedStatus: OUTBOX_STATUS.SYNCING });
      if (!updated) throw conflict('The consultation upload is no longer owned by this synchronization worker.');
      await markDraftStatus(op.localRecordId, DRAFT_STATUS.SYNCING, { consultationAttemptedAt: attemptedAt }, op.ownerId, context);
    });
    let result;
    try {
      result = await create(toServerPayload(op.payload), {
        headers: { 'Idempotency-Key': op.idempotencyKey },
        offlineMutationType: MUTATION_TIER.SAFE_SYNC,
        ownerId: op.ownerId,
        ...(context.signal ? { signal: context.signal } : {}),
      });
    } catch (error) {
      // This endpoint uses 404 to conceal out-of-scope resident identities. It
      // is an authoritative scope rejection, not a transient transport failure.
      if (error?.status === 404 || error?.statusCode === 404) {
        throw Object.assign(malformed('The queued resident is no longer accessible in your scope. Clinical information remains on this device.'),
          { ...error, status: 404, code: SYNC_ERROR.MALFORMED });
      }
      throw error;
    }
    const record = requireConfirmedConsultation(result, op);
    return { serverId: record.id, serverRecord: record };
  };
  handler.mutationType = MUTATION_TIER.SAFE_SYNC;
  return handler;
};

/**
 * Upgrade only old consultation drafts, exactly once in a drafts/outbox
 * transaction. Legacy localId is already a UUID and is a deterministic key
 * across tabs/restarts; unfamiliar legacy ids receive a UUID in the winning
 * transaction. Existing clinical data and original local recording time survive.
 * The rhuTriage entity and already settled/failed/conflicting work are untouched.
 */
export const adoptLegacyConsultationDrafts = async (ownerId, { isOwnerCurrent = () => true, lease = null, now = Date.now } = {}) => {
  if (!ownerId) return 0;
  const guard = captureOwnerGuard(ownerId);
  const rows = await db.drafts.where('ownerId').equals(ownerId).toArray();
  let adopted = 0;
  for (const row of rows) {
    assertCurrentOwner(guard);
    if (!isOwnerCurrent()) break;
    if (row.entity !== LEGACY_ENTITY || ![DRAFT_STATUS.OFFLINE_DRAFT, DRAFT_STATUS.SYNCING].includes(row.status)) continue;
    const existingOps = await db.outbox.where('localRecordId').equals(row.localId).toArray();
    // Never replace an existing operation, including a conflicting one or one
    // owned by another account. A conversion only creates the missing outbox.
    if (existingOps.length) continue;
    const draft = await getDraft(row.localId, ownerId);
    if (!draft?.data || typeof draft.data !== 'object' || Array.isArray(draft.data)) continue;
    const key = UUID.test(draft.data.clientOperationKey || '') ? draft.data.clientOperationKey.toLowerCase()
      : UUID.test(row.localId) ? row.localId.toLowerCase() : newId();
    const data = {
      ...draft.data,
      clientOperationKey: key,
      recordedAt: draft.data.recordedAt || new Date(row.createdAt).toISOString(),
      legacyDraftAdopted: true,
    };
    const encrypted = requireEncryptedPayload(await encryptJson(data));
    const op = buildOperation({ entity: ENTITY, opType: 'create', ownerId, localRecordId: row.localId,
      opId: key, idempotencyKey: key, mutationType: MUTATION_TIER.SAFE_SYNC }, encrypted);
    const converted = await safeWrite(() => db.transaction('rw', db.drafts, db.outbox, db.syncMeta, async () => {
      assertCurrentOwner(guard);
      if (!isOwnerCurrent()) return false;
      if (lease && !(await ownsLock(lease, now))) throw Object.assign(new Error('The consultation adoption lease expired.'), { code: 'lease-lost' });
      const current = await db.drafts.get(row.localId);
      if (!current || current.ownerId !== ownerId || current.entity !== LEGACY_ENTITY
        || current.updatedAt !== row.updatedAt) return false;
      if (await db.outbox.where('localRecordId').equals(row.localId).count()) return false;
      if (await db.outbox.get(key)) throw conflict('The legacy consultation operation key is already in use. The original draft was retained.');
      await db.outbox.add(op);
      await db.drafts.update(row.localId, { entity: ENTITY, data: encrypted, operationId: key,
        status: DRAFT_STATUS.PENDING, mutationType: MUTATION_TIER.SAFE_SYNC,
        legacyConsultationDraft: true, updatedAt: Date.now() });
      return true;
    }));
    if (converted) adopted += 1;
  }
  return adopted;
};

const reuseQueuedConsultation = async (ownerId, operation, payload) => {
  if (operation.ownerId !== ownerId || operation.entity !== ENTITY || operation.opType !== 'create') {
    throw conflict('This operation belongs to a different user or workflow.');
  }
  const draft = await getDraft(operation.localRecordId, ownerId);
  const original = await getOperation(operation.opId, ownerId);
  if (!draft || !original) throw malformed('The original consultation queue is unavailable.');
  const incoming = toServerPayload({ ...payload,
    clientOperationKey: payload.clientOperationKey || original.payload.clientOperationKey,
    recordedAt: payload.recordedAt || original.payload.recordedAt });
  if (canonicalJson(incoming) !== canonicalJson(toServerPayload(original.payload))) {
    throw conflict('Queued clinical information cannot be overwritten. Review the original consultation before deciding what to do.');
  }
  return { localId: draft.localId, draft, operation: original };
};

const persistConsultationCreate = async ({ ownerId, payload, localId = null }) => {
  const guard = captureOwnerGuard(ownerId);
  if (localId) {
    const row = await db.drafts.get(localId);
    if (!row || row.ownerId !== ownerId || row.entity !== ENTITY) throw conflict('This consultation queue is not available to this user.');
    const operation = await db.outbox.get(row.operationId);
    if (!operation) throw malformed('The original consultation operation is unavailable.');
    return reuseQueuedConsultation(ownerId, operation, payload);
  }
  const key = String(payload.clientOperationKey || newId()).toLowerCase();
  if (!UUID.test(key)) throw malformed('The consultation operation must be a UUID.');
  const existing = await db.outbox.get(key);
  if (existing) return reuseQueuedConsultation(ownerId, existing, payload);
  const data = { ...payload, clientOperationKey: key, recordedAt: payload.recordedAt || new Date().toISOString() };
  const encrypted = requireEncryptedPayload(await encryptJson(data));
  const id = newId();
  const op = buildOperation({ entity: ENTITY, opType: 'create', ownerId, localRecordId: id,
    opId: key, idempotencyKey: key, mutationType: MUTATION_TIER.SAFE_SYNC }, encrypted);
  const now = Date.now();
  const draft = { localId: id, entity: ENTITY, ownerId, data: encrypted, operationId: key,
    status: DRAFT_STATUS.PENDING, serverId: null, revision: null, localRef: newLocalRef('LOCAL'),
    mutationType: MUTATION_TIER.SAFE_SYNC, createdAt: now, updatedAt: now };
  const winner = await safeWrite(() => db.transaction('rw', db.drafts, db.outbox, async () => {
    assertCurrentOwner(guard);
    const raced = await db.outbox.get(key);
    if (raced) return raced;
    await db.outbox.add(op);
    await db.drafts.add(draft);
    return null;
  }));
  if (winner) return reuseQueuedConsultation(ownerId, winner, payload);
  return { localId: id, operation: { ...op, payload: data }, draft: { ...draft, data } };
};

export const draftToDisplay = (draft) => {
  const syncStatus = { pending: 'Pending Sync', syncing: 'Syncing', failed: 'Sync Failed', conflict: 'Needs Review' }[draft.status] || 'Saved Offline';
  return { ...draft.data, id: draft.localRef || draft.localId, localId: draft.localId,
    offline: true, status: syncStatus, syncStatus, queueStatus: draft.status, lastError: draft.lastError || null,
    canDiscard: draft.status === DRAFT_STATUS.PENDING && !draft.consultationAttemptedAt && !draft.legacyConsultationDraft };
};

const refreshQueue = async (start = false) => {
  const engine = await import('./syncEngine.js');
  await engine.refreshSyncState();
  if (start) void engine.requestSync('consultation-queued');
};

/** Durable save; authoritative rejections are surfaced AND retained locally. */
export const saveConsultationOffline = async ({ ownerId, payload, localId = null, create, online = isNavigatorOnline }) => {
  if (!ownerId) throw new Error('A signed-in user is required.');
  if (typeof create !== 'function') throw new Error('A consultation create function is required.');
  const queued = await persistConsultationCreate({ ownerId, payload, localId });
  await refreshQueue();
  if (online()) return submitConsultationDraft({ ownerId, localId: queued.localId, create, online });
  return { record: draftToDisplay(queued.draft), queued: true, source: 'local', localId: queued.localId };
};

export const listConsultationDrafts = async (ownerId) => {
  if (!ownerId) return [];
  await adoptLegacyConsultationDrafts(ownerId);
  const drafts = (await listDrafts(ownerId)).filter((draft) => [ENTITY, LEGACY_ENTITY].includes(draft.entity)
    && ![DRAFT_STATUS.SYNCED, 'resolved'].includes(draft.status));
  return drafts.map(draftToDisplay);
};

export const restoreConsultationDraft = async ({ ownerId, localId }) => {
  const draft = await getDraft(localId, ownerId);
  if (!draft || draft.ownerId !== ownerId || ![ENTITY, LEGACY_ENTITY].includes(draft.entity)) return null;
  return { localId: draft.localId, data: draft.data, status: draft.status, lastError: draft.lastError || null };
};

/** Only an unattempted create can be discarded; ambiguous failures retain data. */
export const deleteConsultationDraft = async ({ ownerId, localId }) => {
  const guard = captureOwnerGuard(ownerId);
  return safeWrite(() => db.transaction('rw', db.drafts, db.outbox, async () => {
    assertCurrentOwner(guard);
    const draft = await db.drafts.get(localId);
    if (!draft || draft.ownerId !== ownerId || ![ENTITY, LEGACY_ENTITY].includes(draft.entity)) return false;
    const operations = await db.outbox.where('localRecordId').equals(localId).toArray();
    if (draft.entity === LEGACY_ENTITY || draft.legacyConsultationDraft || draft.consultationAttemptedAt
      || operations.some((op) => op.ownerId !== ownerId || op.status !== OUTBOX_STATUS.PENDING
      || op.attempts || op.syncingAt || op.consultationAttemptedAt) || ![DRAFT_STATUS.PENDING, DRAFT_STATUS.OFFLINE_DRAFT].includes(draft.status)) {
      throw conflict('An attempted or legacy consultation cannot be discarded because it may already exist on the server. Clinical information was retained.');
    }
    for (const op of operations) await db.outbox.delete(op.opId);
    await db.drafts.delete(localId);
    return true;
  }));
};

/** Retry the original immutable operation, through the same owner-fenced runner. */
export const submitConsultationDraft = async ({ ownerId, localId, create, online = isNavigatorOnline }) => {
  if (!ownerId) throw new Error('A signed-in user is required.');
  if (typeof create !== 'function') throw new Error('A consultation create function is required.');
  if (!online()) throw new OfflineActionRequiredError();
  await adoptLegacyConsultationDrafts(ownerId);
  let draft = await getDraft(localId, ownerId);
  if (!draft || draft.ownerId !== ownerId || draft.entity !== ENTITY) throw malformed('This consultation queue is no longer available.');
  if (draft.status === DRAFT_STATUS.SYNCED) {
    return { record: draft.data, submitted: true, queued: false, source: 'server', localId, alreadySynced: true };
  }
  const op = await getOperation(draft.operationId, ownerId);
  if (!op || op.ownerId !== ownerId || op.entity !== ENTITY) throw malformed('The original consultation operation is unavailable.');
  if (op.status === OUTBOX_STATUS.FAILED) await requeueOperation(op.opId, ownerId);
  let failure = null;
  const handler = createConsultationSyncHandler(create);
  const captureFailure = async (...args) => {
    try { return await handler(...args); } catch (error) { failure = error; throw error; }
  };
  captureFailure.mutationType = MUTATION_TIER.SAFE_SYNC;
  const { runSyncPass } = await import('./syncRunner.js');
  await runSyncPass({ ownerId, onlyOperationId: op.opId,
    getHandler: (entity, opType) => entity === ENTITY && opType === 'create' ? captureFailure : null });
  draft = await getDraft(localId, ownerId);
  await refreshQueue();
  if (draft?.status === DRAFT_STATUS.SYNCED) {
    return { record: draft.data, submitted: true, queued: false, source: 'server', localId };
  }
  const current = await getOperation(op.opId, ownerId);
  if (current?.status === OUTBOX_STATUS.CONFLICT || (current?.status === OUTBOX_STATUS.FAILED && !current.lastError?.retryable)) {
    const error = failure || Object.assign(new Error(current.lastError?.message || 'The consultation needs review.'),
      { status: current.lastError?.status, code: current.lastError?.code });
    throw Object.assign(error, { localId, clientOperationKey: op.idempotencyKey, clinicalInfoPreserved: true });
  }
  await refreshQueue(true);
  return { record: draftToDisplay(draft), queued: true, submitted: false, source: 'local', localId };
};

export const listConsultationsOffline = async ({ ownerId, params, fetchList, online = isNavigatorOnline }) => {
  if (!ownerId) throw new Error('A signed-in user is required.');
  const guard = captureOwnerGuard(ownerId);
  let rows = null;
  if (online() && typeof fetchList === 'function') {
    try {
      const result = await fetchList(params);
      assertCurrentOwner(guard);
      rows = Array.isArray(result) ? result : result?.rows ?? result?.consultations;
      if (!Array.isArray(rows)) throw malformed('The server did not return consultation history.');
      await Promise.all(rows.filter((row) => row?.id).map((row) =>
        cacheRecord({ entity: ENTITY, remoteId: row.id, ownerId, data: row, revision: row.revision ?? null })));
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
    }
  }
  if (!rows) rows = (await listCachedRecords(ownerId, ENTITY)).map((row) => row.data);
  const drafts = await listConsultationDrafts(ownerId);
  assertCurrentOwner(guard);
  const pendingKeys = new Set(drafts.map((draft) => draft.clientOperationKey).filter(Boolean));
  // A lost response may already be visible on the server. Keep its pending
  // confirmation row, but never infer synced from a list response.
  return [...drafts, ...rows.filter((row) => !pendingKeys.has(row.clientOperationKey))];
};

/** Cache only the authorized VERIFIED selector, not a general resident list. */
export const listConsultationResidentsOffline = async ({ ownerId, fetchList, online = isNavigatorOnline }) => {
  const guard = captureOwnerGuard(ownerId);
  const entity = 'consultationResidentDirectory';
  if (online()) {
    try {
      const result = await fetchList();
      assertCurrentOwner(guard);
      const rows = Array.isArray(result) ? result : result?.rows;
      if (!Array.isArray(rows)) throw malformed('The server did not return the verified resident directory.');
      await Promise.all(rows.filter((row) => row?.id).map((row) => cacheRecord({ entity, remoteId: row.id, ownerId, data: row })));
      assertCurrentOwner(guard);
      return rows;
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
    }
  }
  const rows = await listCachedRecords(ownerId, entity);
  assertCurrentOwner(guard);
  return rows.map((row) => row.data);
};

export default {
  saveConsultationOffline, listConsultationDrafts, restoreConsultationDraft, deleteConsultationDraft,
  submitConsultationDraft, listConsultationsOffline, adoptLegacyConsultationDrafts,
  createConsultationSyncHandler, requireConfirmedConsultation, toServerPayload, draftToDisplay,
  listConsultationResidentsOffline,
};

import { residentsApi } from '../api/residentsApi.js';
import { cacheRecord, getCachedRecord, listCachedRecords } from './records.js';
import { queueCreate, queueUpdate } from './queue.js';
import { listDrafts, markDraftStatus } from './drafts.js';
import { markConflict } from './outbox.js';
import { idempotencyKeyFor, newId } from './ids.js';
import { classifySyncError, SYNC_ERROR } from './errors.js';
import { isNavigatorOnline } from './connectivity.js';
import { MUTATION_TIER, OFFLINE_ACTION_REQUIRED_MESSAGE } from './mutationPolicy.js';
import { refreshSyncState, requestSync } from './syncEngine.js';
import { isResidentRevision, residentRevisionOf } from './residentRevision.js';

export const EDITABLE_RESIDENT_FIELDS = new Set([
  'cellphoneNo',
  'barangay',
  'civilStatus',
  'currentAddress',
  'permanentAddress',
  'philhealthNo',
  'religion',
  'employmentStatus',
  'fatherName',
  'motherName',
  'birthPlace',
]);

const networkFailure = (error) => classifySyncError(error).code === SYNC_ERROR.NETWORK;
const triggerSync = () => {
  requestSync('resident-queued').catch((error) => {
    console.error('Resident synchronization could not be started:', error);
  });
};

const unwrapResident = (result) => result?.resident ?? result;
const hasResidentId = (resident) => resident && (typeof resident.id === 'string' || typeof resident.id === 'number');

export const createResidentOffline = async ({ ownerId, payload }) => {
  const residentPayload = payload?.resident || payload;
  if (!ownerId) throw new Error('A signed-in user is required to save a resident.');
  if (residentPayload?.createLoginAccount || residentPayload?.email) {
    if (!isNavigatorOnline()) throw new Error(OFFLINE_ACTION_REQUIRED_MESSAGE);
    const result = await residentsApi.create(payload, { ownerId, offlineMutationType: MUTATION_TIER.ONLINE_ONLY });
    const resident = unwrapResident(result);
    if (!hasResidentId(resident)) throw new Error('The resident service did not confirm the created record.');
    await cacheRecord({ entity: 'resident', remoteId: resident.id, ownerId, data: resident, revision: residentRevisionOf(resident) });
    return { resident, queued: false, source: 'server' };
  }

  const opId = newId();
  if (isNavigatorOnline()) {
    try {
      const result = await residentsApi.create(payload, {
        ownerId,
        headers: { 'Idempotency-Key': idempotencyKeyFor(opId) },
        offlineMutationType: MUTATION_TIER.SAFE_SYNC,
      });
      const resident = unwrapResident(result);
      if (!hasResidentId(resident)) throw new Error('The resident service did not confirm the created record.');
      await cacheRecord({ entity: 'resident', remoteId: resident.id, ownerId, data: resident, revision: residentRevisionOf(resident) });
      return { resident, queued: false, source: 'server' };
    } catch (error) {
      if (!networkFailure(error)) throw error;
    }
  }

  const { localId, draft } = await queueCreate({
    entity: 'resident',
    ownerId,
    data: residentPayload,
    mutationType: MUTATION_TIER.SAFE_SYNC,
    opId,
  });
  await refreshSyncState();
  triggerSync();
  return {
    resident: {
      ...residentPayload,
      id: draft.localRef,
      localId,
      offline: true,
      syncStatus: 'Pending Sync',
    },
    queued: true,
    source: 'local',
    localId,
  };
};

export const updateResidentOffline = async ({
  ownerId,
  residentId,
  payload,
  baseRevision,
}) => {
  const residentPayload = payload?.resident || payload;
  if (
    !ownerId ||
    !residentId ||
    !residentPayload ||
    !Object.keys(residentPayload).length ||
    !Object.keys(residentPayload).every((field) => EDITABLE_RESIDENT_FIELDS.has(field))
  ) {
    throw new Error('This resident update is not approved for offline synchronization.');
  }
  if (!isResidentRevision(baseRevision) && !isNavigatorOnline()) {
    throw new Error('Open this resident while online before editing it offline.');
  }

  const opId = newId();
  if (isNavigatorOnline()) {
    try {
      if (!isResidentRevision(baseRevision)) {
        const current = unwrapResident(await residentsApi.get(residentId, { ownerId }));
        baseRevision = residentRevisionOf(current);
        if (!isResidentRevision(baseRevision)) throw new Error('Reopen this resident before editing. Its server revision is unavailable.');
      }
      const result = await residentsApi.update(residentId, payload, {
        ownerId,
        headers: {
          'Idempotency-Key': idempotencyKeyFor(opId),
          'If-Match': String(baseRevision),
        },
        offlineMutationType: MUTATION_TIER.SAFE_SYNC,
      });
      const resident = unwrapResident(result);
      if (!hasResidentId(resident)) throw new Error('The resident service did not confirm the updated record.');
      await cacheRecord({ entity: 'resident', remoteId: resident.id, ownerId, data: resident, revision: residentRevisionOf(resident) });
      return { resident, queued: false, source: 'server' };
    } catch (error) {
      const info = classifySyncError(error);
      if (info.code === SYNC_ERROR.CONFLICT) {
        const { localId, operation } = await queueUpdate({
          entity: 'resident', ownerId, serverId: residentId, data: residentPayload,
          baseRevision, mutationType: MUTATION_TIER.SAFE_SYNC, opId,
        });
        await markConflict(operation.opId, info, ownerId);
        await markDraftStatus(localId, 'conflict', { lastError: info }, ownerId);
        await refreshSyncState();
        return { resident: { id: residentId, ...residentPayload }, queued: true, conflict: true, source: 'local', localId };
      }
      if (!networkFailure(error)) throw error;
    }
  }

  if (!isResidentRevision(baseRevision)) {
    throw new Error('Open this resident while online before editing it offline.');
  }
  const cached = await getCachedRecord('resident', residentId, ownerId);
  if (!cached?.data) {
    throw new Error('This resident is not available offline. Open it while connected before editing.');
  }
  const cachedRevision = typeof baseRevision === 'string' ? cached.data.updatedAt : residentRevisionOf(cached.data);
  if (String(cachedRevision ?? '') !== String(baseRevision)) {
    throw new Error('This resident changed after it was cached. Reconnect and reload before editing.');
  }

  const { localId } = await queueUpdate({
    entity: 'resident',
    ownerId,
    serverId: residentId,
    data: residentPayload,
    baseRevision,
    mutationType: MUTATION_TIER.SAFE_SYNC,
    opId,
  });
  await refreshSyncState();
  triggerSync();
  return {
    resident: {
      ...cached.data,
      ...residentPayload,
      id: residentId,
      offline: true,
      syncStatus: 'Pending Sync',
    },
    queued: true,
    source: 'local',
    localId,
  };
};

export const getResidentOffline = async ({ ownerId, residentId }) => {
  if (!ownerId || !residentId) throw new Error('A signed-in user and resident are required.');
  if (isNavigatorOnline()) {
    try {
      const resident = unwrapResident(await residentsApi.get(residentId, { ownerId }));
      if (hasResidentId(resident)) {
        await cacheRecord({ entity: 'resident', remoteId: resident.id, ownerId, data: resident, revision: residentRevisionOf(resident) });
        return resident;
      }
    } catch (error) {
      if (!networkFailure(error)) throw error;
    }
  }
  const cached = await getCachedRecord('resident', residentId, ownerId);
  if (!cached?.data) throw new Error('This resident is not available offline. Open it while connected before working offline.');
  return cached.data;
};

/** @param {{ownerId: string, params?: Record<string, any>}} input */
export const listResidentsOffline = async ({ ownerId, params = {} }) => {
  if (!ownerId) throw new Error('A signed-in user is required.');
  let serverRows = null;
  let serverTotal = null;
  let warning = null;
  if (isNavigatorOnline()) {
    try {
      const result = await residentsApi.list(params, { ownerId });
      if (!Array.isArray(result?.rows)) throw new Error('The resident service returned an invalid response.');
      serverRows = result.rows;
      serverTotal = Number.isFinite(Number(result.total)) ? Number(result.total) : serverRows.length;
      await Promise.all(serverRows.filter((row) => hasResidentId(row)).map((row) =>
        cacheRecord({ entity: 'resident', remoteId: row.id, ownerId, data: row, revision: residentRevisionOf(row) }),
      ));
    } catch (error) {
      if (!networkFailure(error)) throw error;
      warning = error;
    }
  } else {
    warning = new Error('Network unavailable while loading resident records.');
  }

  const cachedRows = serverRows || (await listCachedRecords(ownerId, 'resident')).map((row) => row.data);
  const drafts = (await listDrafts(ownerId, 'resident')).sort((a, b) => a.updatedAt - b.updatedAt);
  const localCreates = [];
  const updatedById = new Map();
  for (const draft of drafts) {
    if (draft.status === 'synced' || draft.status === 'resolved') continue;
    const lastError = /** @type {{code?: string}|null|undefined} */ (draft.lastError);
    const errorLabel = draft.status === 'failed'
      ? lastError?.code === 'permission_changed'
        ? 'Sync failed — permission changed'
        : 'Sync failed — review required'
      : draft.status === 'conflict'
        ? 'Conflict — review required'
        : 'Pending Sync';
    if (draft.serverId) {
      updatedById.set(String(draft.serverId), {
        ...(updatedById.get(String(draft.serverId)) || {}),
        ...draft.data,
        offline: true,
        syncStatus: errorLabel,
      });
    } else {
      localCreates.push({
        ...draft.data,
        id: draft.localRef,
        localId: draft.localId,
        offline: true,
        syncStatus: errorLabel,
      });
    }
  }
  const rows = [
    ...localCreates,
    ...cachedRows.map((row) => ({
      ...row,
      ...(updatedById.get(String(row.id)) || {}),
    })),
  ];
  const query = String(params.q || '').trim().toLowerCase();
  const searchFiltered = query
    ? rows.filter((row) =>
        [row.firstName, row.middleName, row.lastName, row.name, row.healthRecordNo, row.cellphoneNo]
          .some((value) => String(value || '').toLowerCase().includes(query)),
      )
    : rows;
  const barangayId = String(params.barangayId || params.barangay_id || '').trim();
  const requestedZone = String(params.zone ?? '').trim();
  const addressZone = (row) => {
    const address = `${row.currentAddress || ''} ${row.permanentAddress || ''}`;
    const match = address.match(/\b(?:purok|zone)\s+(?:(?:purok|zone)\s+)*([1-8])\b/i);
    return match ? Number(match[1]) : null;
  };
  const filtered = searchFiltered.filter((row) => {
    if (barangayId && String(row.barangayId || '') !== barangayId) return false;
    if (!requestedZone) return true;
    if (requestedZone === 'unassigned') return (row.zone === null || row.zone === undefined || row.zone === '') && !addressZone(row);
    return Number(row.zone) === Number(requestedZone) || addressZone(row) === Number(requestedZone);
  });
  return {
    rows: filtered,
    total: serverRows ? serverTotal + localCreates.length : filtered.length,
    warning,
  };
};

export default {
  createResidentOffline,
  updateResidentOffline,
  getResidentOffline,
  listResidentsOffline,
};

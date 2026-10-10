import { followUpsApi, residentsApi } from '@/services/api';
import { classifySyncError, SYNC_ERROR } from './errors.js';
import { queueCreate, queueUpdate } from './queue.js';
import { cacheRecord, listCachedRecords } from './records.js';
import { listDrafts } from './drafts.js';
import { idempotencyKeyFor, newId } from './ids.js';
import { isNavigatorOnline } from './connectivity.js';
import { MUTATION_TIER, OfflineActionRequiredError } from './mutationPolicy.js';
import { refreshSyncState, requestSync } from './syncEngine.js';

const isNetworkFailure = (error) => classifySyncError(error).code === SYNC_ERROR.NETWORK;
const startQueuedSync = () => requestSync('after-queue').catch(() => {});

const unwrap = (result) => result?.record ?? result;
const localSchedule = (data, localRef, localId) => ({
  id: localRef,
  localId,
  residentId: data.residentId,
  residentName: data.residentName || 'Resident',
  barangay: data._offlineBarangay || '',
  date: data.scheduled_date || '',
  time: data.scheduled_time ? String(data.scheduled_time).slice(0, 5) : '',
  location: data.location || '',
  provider: data.assigned_provider || '',
  instructions: data.notes || '',
  purpose: data.purpose || '',
  priority: data.priority || 'Medium',
  status: data.status || 'Scheduled',
  offline: true,
  syncStatus: 'Pending Sync',
});
const serverPayload = (record = {}) => {
  const { _offlineBarangay, ...payload } = record;
  return payload;
};

const queueOptions = (opId) => ({
  headers: { 'Idempotency-Key': idempotencyKeyFor(opId) },
  offlineMutationType: MUTATION_TIER.SAFE_SYNC,
});

const TERMINAL_STATUSES = new Set(['Completed', 'Missed', 'Cancelled', 'Rejected']);
const assertSafeFollowUpPayload = (record = {}) => {
  if (TERMINAL_STATUSES.has(String(record.status || ''))) {
    throw new OfflineActionRequiredError();
  }
};

export const listFollowUpsOffline = async ({ ownerId, params } = {}) => {
  if (!ownerId) throw new Error('A signed-in user is required.');
  let serverRows = null;
  if (isNavigatorOnline()) {
    try {
      const result = await followUpsApi.list(params);
      serverRows = result?.rows || [];
      await Promise.all(serverRows.filter((row) => row?.id).map((row) =>
        cacheRecord({ entity: 'followup', remoteId: row.id, ownerId, data: row }),
      ));
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
    }
  }
  if (!serverRows) {
    serverRows = (await listCachedRecords(ownerId, 'followup')).map((row) => row.data);
  }

  const drafts = await listDrafts(ownerId, 'followup');
  const pending = drafts.filter((draft) => draft.status !== 'synced');
  const pendingIds = new Set(pending.map((draft) => String(draft.serverId || draft.data?.id || draft.localId)));
  const updates = new Map(
    pending
      .filter((draft) => draft.serverId)
      .map((draft) => [String(draft.serverId), draft.data]),
  );
  const merged = serverRows
    .filter((row) => !pendingIds.has(String(row.id)) || updates.has(String(row.id)))
    .map((row) => (updates.has(String(row.id)) ? { ...row, ...updates.get(String(row.id)), offline: true, syncStatus: 'Pending Sync' } : row));
  const local = pending
    .filter((draft) => !draft.serverId)
    .map((draft) => localSchedule(draft.data, draft.localRef, draft.localId));
  return [...local, ...merged];
};

export const createFollowUpOffline = async ({ ownerId, record }) => {
  if (!ownerId) throw new Error('A signed-in user is required.');
  const opId = newId();
  if (isNavigatorOnline()) {
    try {
      const result = await followUpsApi.create(serverPayload(record), queueOptions(opId));
      return { record: unwrap(result), queued: false, source: 'server' };
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
    }
  }
  assertSafeFollowUpPayload(record);
  const { localId, draft } = await queueCreate({
    entity: 'followup',
    ownerId,
    data: record,
    mutationType: MUTATION_TIER.SAFE_SYNC,
    opId,
  });
  await refreshSyncState();
  startQueuedSync();
  return {
    record: localSchedule(record, draft.localRef, localId),
    queued: true,
    source: 'local',
    localId,
  };
};

export const updateFollowUpOffline = async ({ ownerId, followUpId, record }) => {
  if (!ownerId || !followUpId) throw new Error('A signed-in user and follow-up are required.');
  const opId = newId();
  if (isNavigatorOnline()) {
    try {
      const result = await followUpsApi.update(followUpId, serverPayload(record), queueOptions(opId));
      return { record: unwrap(result), queued: false, source: 'server' };
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
    }
  }
  assertSafeFollowUpPayload(record);
  const { localId } = await queueUpdate({
    entity: 'followup',
    ownerId,
    serverId: followUpId,
    data: record,
    mutationType: MUTATION_TIER.SAFE_SYNC,
    opId,
  });
  await refreshSyncState();
  startQueuedSync();
  return {
    record: { id: followUpId, ...record, offline: true, syncStatus: 'Pending Sync' },
    queued: true,
    source: 'local',
    localId,
  };
};

export const listFollowUpResidentsOffline = async ({ ownerId, params } = {}) => {
  if (!ownerId) throw new Error('A signed-in user is required.');
  if (isNavigatorOnline()) {
    try {
      const rows = (await residentsApi.list(params))?.rows || [];
      await Promise.all(rows.filter((row) => row?.id).map((row) =>
        cacheRecord({ entity: 'residentDirectory', remoteId: row.id, ownerId, data: row }),
      ));
      return rows;
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
    }
  }
  return (await listCachedRecords(ownerId, 'residentDirectory')).map((row) => row.data);
};

export default {
  listFollowUpsOffline,
  createFollowUpOffline,
  updateFollowUpOffline,
  listFollowUpResidentsOffline,
};

import { householdsApi } from '@/services/api';
import { isNavigatorOnline } from './connectivity.js';
import { classifySyncError, SYNC_ERROR } from './errors.js';
import { queueCreate, queueUpdate } from './queue.js';
import { cacheRecord, getCachedRecord, listCachedRecords } from './records.js';
import { getOperation, listOperations } from './outbox.js';
import { listDrafts } from './drafts.js';
import { refreshSyncState, requestSync } from './syncEngine.js';
import { idempotencyKeyFor, newId } from './ids.js';
import { mergePendingHouseholdUpdates } from './householdOfflineState.js';
import {
  MUTATION_TIER,
  OFFLINE_ACTION_REQUIRED_MESSAGE,
  OfflineActionRequiredError,
  isSafeHouseholdUpdate,
} from './mutationPolicy.js';

/**
 * Offline-aware Household Profiling service.
 *
 * This is the single entry point the Add Household page uses. It preserves the
 * existing ONLINE behavior exactly (create through the authorized API and return
 * the server's record), and only when the browser is offline — or the network
 * drops mid-request — does it persist the household as a local draft and queue
 * it for synchronization. A queued household is always labeled "Not saved to the
 * server yet"; it is never reported as saved to PostgreSQL.
 */

const isNetworkFailure = (error) => classifySyncError(error).code === SYNC_ERROR.NETWORK;
const startQueuedSync = () => {
  requestSync('after-queue').catch((error) => {
    console.error('Offline synchronization could not be started:', error);
  });
};

const buildQueuedHousehold = (payload, localRef, localId) => ({
  id: localRef,
  localId,
  headName: payload.headName,
  barangay: payload.barangay,
  purok: payload.purok,
  streetAddress: payload.streetAddress,
  members: Array.isArray(payload.members) ? payload.members : [],
  // Explicit, honest status: this record exists only on this device.
  syncStatus: 'Pending Sync',
  offline: true,
});

const getDecryptedOperations = async (ownerId) => {
  const operations = [];
  for (const operation of await listOperations(ownerId)) {
    operations.push({ ...operation, ...(await getOperation(operation.opId)) });
  }
  return operations;
};

/**
 * Create a household, online or offline.
 *
 * @param {{ownerId:string, payload:any}} input `payload` is the household body
 *        the page already builds (the same shape sent to the API).
 * @returns {Promise<{household:any, queued:boolean, source:'server'|'local', localId?:string}>}
 */
export const createHouseholdOffline = async ({ ownerId, payload }) => {
  const online = isNavigatorOnline();
  const operationId = newId();
  const idempotencyKey = idempotencyKeyFor(operationId);

  if (online) {
    try {
      const result = await householdsApi.create(
        { household: payload },
        {
          headers: { 'Idempotency-Key': idempotencyKey },
          offlineMutationType: MUTATION_TIER.SAFE_SYNC,
        },
      );
      const household = result?.household ?? result;
      return { household, queued: false, source: 'server' };
    } catch (error) {
      // Only a transport failure falls back to the local queue. Validation (422),
      // duplicate (409), authorization (403) and every other server answer are
      // the server's authoritative response and must surface unchanged.
      if (!isNetworkFailure(error)) throw error;
    }
  }

  if (!ownerId) {
    throw new Error('You must be signed in to save a household offline.');
  }

  const { localId, draft } = await queueCreate({
    entity: 'household',
    ownerId,
    data: payload,
    mutationType: MUTATION_TIER.SAFE_SYNC,
    opId: operationId,
  });

  await refreshSyncState();
  // Attempt to drain immediately (harmless when truly offline; the pass stops
  // on the first classified network error).
  startQueuedSync();

  return {
    household: buildQueuedHousehold(payload, draft.localRef, localId),
    queued: true,
    source: 'local',
    localId,
  };
};

const safeMeasurementKeys = new Set(['heightCm', 'weightKg', 'remarks']);
const consequentialHealthValues = (payload = {}) =>
  Boolean(
    payload.dateOfDeath ||
      payload.causeOfDeath ||
      payload.transOut === true ||
      payload.date_of_death ||
      payload.cause_of_death ||
      payload.trans_out === true,
  );

const normalizeSafeMeasurements = (payload = {}) => {
  if (consequentialHealthValues(payload)) throw new OfflineActionRequiredError();
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => safeMeasurementKeys.has(key)),
  );
};

export const updateHouseholdOffline = async ({
  ownerId,
  serverId,
  payload,
  baseRevision = null,
}) => {
  if (!isSafeHouseholdUpdate(payload)) throw new OfflineActionRequiredError();
  if (!ownerId || !serverId) throw new Error('A signed-in user and household are required.');

  const operationId = newId();
  const idempotencyKey = idempotencyKeyFor(operationId);
  if (isNavigatorOnline()) {
    try {
      const result = await householdsApi.update(serverId, { household: payload }, {
        headers: {
          'Idempotency-Key': idempotencyKey,
          ...(baseRevision === null || baseRevision === undefined
            ? {}
            : { 'If-Match': String(baseRevision) }),
        },
        offlineMutationType: MUTATION_TIER.SAFE_SYNC,
      });
      return { household: result?.household ?? result, queued: false, source: 'server' };
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
    }
  }

  const { localId, draft } = await queueUpdate({
    entity: 'household',
    ownerId,
    serverId,
    data: payload,
    baseRevision,
    mutationType: MUTATION_TIER.SAFE_SYNC,
    opId: operationId,
  });
  await refreshSyncState();
  startQueuedSync();
  return {
    household: { id: serverId, ...payload, syncStatus: 'Pending Sync', offline: true },
    queued: true,
    source: 'local',
    localId,
    localRef: draft.localRef,
  };
};

export const getHouseholdOffline = async ({ ownerId, householdId }) => {
  if (!ownerId || !householdId) throw new Error('A signed-in user and household are required.');
  let household = null;
  if (isNavigatorOnline()) {
    try {
      const result = await householdsApi.get(householdId);
      household = result?.household ?? result;
      if (household?.id) {
        await cacheRecord({
          entity: 'household',
          remoteId: household.id,
          ownerId,
          revision: household.revision ?? null,
          data: household,
        });
      }
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
    }
  }

  if (!household) {
    const cached = await getCachedRecord('household', householdId, ownerId);
    household = cached?.data ?? null;
  }
  if (!household) {
    throw new Error('This household is not available offline. Open it while connected before working offline.');
  }

  return mergePendingHouseholdUpdates(household, await getDecryptedOperations(ownerId));
};

export const listHouseholdsOffline = async ({ ownerId, params = {} }) => {
  if (!ownerId) throw new Error('A signed-in user is required.');
  let households = null;
  if (isNavigatorOnline()) {
    try {
      const result = await householdsApi.list(params);
      households = result?.rows || [];
      await Promise.all(households.filter((row) => row?.id).map(async (row) => {
        const cached = await getCachedRecord('household', row.id, ownerId);
        await cacheRecord({
          entity: 'household',
          remoteId: row.id,
          ownerId,
          revision: row.revision ?? cached?.revision ?? null,
          data: { ...(cached?.data || {}), ...row },
        });
      }));
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
    }
  }
  if (!households) {
    households = (await listCachedRecords(ownerId, 'household')).map((row) => row.data);
  }
  const operations = await getDecryptedOperations(ownerId);
  const existing = households.map((row) => mergePendingHouseholdUpdates(row, operations));
  const drafts = await listDrafts(ownerId, 'household');
  const local = drafts
    .filter((draft) => draft.status !== 'synced' && !draft.serverId)
    .map((draft) => ({
      ...draft.data,
      id: draft.localRef,
      localId: draft.localId,
      offline: true,
      syncStatus: draft.status === 'failed'
        ? draft.lastError?.code === 'permission_changed'
          ? 'Sync failed — permission changed'
          : 'Sync failed — review required'
        : 'Pending Sync',
    }));
  const rows = [...local, ...existing];
  const query = String(params.q || '').trim().toLowerCase();
  return query
    ? rows.filter((row) => [row.id, row.headName, row.purok, row.streetAddress]
      .some((value) => String(value || '').toLowerCase().includes(query)))
    : rows;
};

export const saveMemberMeasurementsOffline = async ({
  ownerId,
  householdId,
  memberId,
  payload,
}) => {
  if (!ownerId || !householdId || !memberId) {
    throw new Error('A signed-in user, household, and member are required.');
  }
  const operationId = newId();
  const idempotencyKey = idempotencyKeyFor(operationId);

  if (isNavigatorOnline()) {
    try {
      const result = await householdsApi.saveMemberHealth(householdId, memberId, payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
        offlineMutationType: MUTATION_TIER.SAFE_SYNC,
      });
      const profile = result?.profile ?? result;
      return { profile, queued: false, source: 'server' };
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
    }
  }

  const health = normalizeSafeMeasurements(payload);
  if (!Object.keys(health).length) {
    throw new Error(OFFLINE_ACTION_REQUIRED_MESSAGE);
  }
  const { localId, draft } = await queueUpdate({
    entity: 'householdMemberHealth',
    ownerId,
    serverId: memberId,
    data: { householdId, memberId, health },
    mutationType: MUTATION_TIER.SAFE_SYNC,
    opId: operationId,
  });
  await refreshSyncState();
  startQueuedSync();
  return {
    profile: { ...health, offline: true, syncStatus: 'Pending Sync' },
    queued: true,
    source: 'local',
    localId,
    localRef: draft.localRef,
  };
};

export const offlineActionRequiredMessage = OFFLINE_ACTION_REQUIRED_MESSAGE;

export default {
  createHouseholdOffline,
  updateHouseholdOffline,
  getHouseholdOffline,
  listHouseholdsOffline,
  mergePendingHouseholdUpdates,
  saveMemberMeasurementsOffline,
};

import { householdsApi } from '@/services/api';
import { isNavigatorOnline } from './connectivity.js';
import { classifySyncError, SYNC_ERROR } from './errors.js';
import { queueCreate } from './queue.js';
import { refreshSyncState, requestSync } from './syncEngine.js';

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

/**
 * Create a household, online or offline.
 *
 * @param {{ownerId:string, payload:any}} input `payload` is the household body
 *        the page already builds (the same shape sent to the API).
 * @returns {Promise<{household:any, queued:boolean, source:'server'|'local', localId?:string}>}
 */
export const createHouseholdOffline = async ({ ownerId, payload }) => {
  const online = isNavigatorOnline();

  if (online) {
    try {
      const result = await householdsApi.create({ household: payload });
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
  });

  await refreshSyncState();
  // Attempt to drain immediately (harmless when truly offline; the pass stops
  // on the first classified network error).
  requestSync('after-queue').catch(() => {});

  return {
    household: buildQueuedHousehold(payload, draft.localRef, localId),
    queued: true,
    source: 'local',
    localId,
  };
};

export default { createHouseholdOffline };

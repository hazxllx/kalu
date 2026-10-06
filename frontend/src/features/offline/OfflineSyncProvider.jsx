import { useEffect, useRef } from 'react';

import { useAuth } from '@/context/AuthContext';
import { purgeOfflineDb } from '@/services/offline/db';
import { resetCachedKey } from '@/services/offline/crypto';
import {
  configureSyncEngine,
  resetSyncEngine,
  startSyncEngine,
  stopSyncEngine,
} from '@/services/offline/syncEngine';

/**
 * Binds the offline layer to the authenticated session.
 *
 *   - points the sync engine at the signed-in user's id;
 *   - starts connectivity/visibility-driven synchronization while signed in;
 *   - on logout OR account switch, destroys all local data (drafts, outbox,
 *     cache, device key) so a shared device never leaks one account's queued
 *     health records to the next account and no cached session can drive a sync
 *     under a different user.
 */
const OfflineSyncProvider = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id || null;
  const previousUserRef = useRef(userId);

  useEffect(() => {
    configureSyncEngine({ getOwnerId: () => userId });
    if (userId) startSyncEngine();
    else stopSyncEngine();
    return () => stopSyncEngine();
  }, [userId]);

  useEffect(() => {
    const previous = previousUserRef.current;
    previousUserRef.current = userId;
    if (previous && previous !== userId) {
      // Signed out or switched accounts: purge everything tied to the old user.
      resetSyncEngine();
      resetCachedKey();
      purgeOfflineDb();
    }
  }, [userId]);

  return children;
};

export default OfflineSyncProvider;

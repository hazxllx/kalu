import { useEffect } from 'react';

import { useAuth } from '@/context/AuthContext';
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
 *   - on logout OR account switch, stops the worker and rebinds it to the
 *     authenticated owner. Account-scoped rows remain durable so an expired
 *     session cannot silently discard pending work; the owner id prevents the
 *     next account from reading or synchronizing those rows.
 */
const OfflineSyncProvider = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id || null;

  useEffect(() => {
    // Reset only in-memory engine state before binding the new session. Do not
    // purge the database on logout: queued work must survive an expired
    // session and be available again when that same user signs back in.
    resetSyncEngine();
    configureSyncEngine({ getOwnerId: () => userId });
    if (userId) startSyncEngine();
    return () => stopSyncEngine();
  }, [userId]);

  return children;
};

export default OfflineSyncProvider;

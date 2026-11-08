import { useEffect, useRef } from 'react';

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
  const { user, session } = useAuth();
  const userId = user?.id || null;
  const sessionOwnerId = session?.user?.id || null;
  const sessionExpiresAt = session?.expires_at || null;
  const sessionRef = useRef(null);
  sessionRef.current = { userId, session };

  useEffect(() => {
    // Reset only in-memory engine state before binding the new session. Do not
    // purge the database on logout: queued work must survive an expired
    // session and be available again when that same user signs back in.
    resetSyncEngine();
    configureSyncEngine({ getOwnerId: () => {
      const current = sessionRef.current;
      const expiresAt = Number(current?.session?.expires_at);
      return current?.userId && current.session?.user?.id === current.userId &&
        Number.isFinite(expiresAt) && expiresAt * 1000 > Date.now() ? current.userId : null;
    } });
    // AuthContext's owner lifecycle performs account cleanup exactly once.
    if (userId) startSyncEngine();
    return () => stopSyncEngine();
  }, [userId, sessionOwnerId, sessionExpiresAt]);

  return children;
};

export default OfflineSyncProvider;

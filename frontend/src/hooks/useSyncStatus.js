import { useSyncExternalStore } from 'react';

import { getSnapshot, subscribe } from '@/services/offline/syncEngine';

/**
 * Subscribe to the central synchronization engine state.
 *
 * Returns the live snapshot: online/offline, syncing, last successful sync time,
 * per-status counts, failed operations and conflicts. `getServerSnapshot` is the
 * same snapshot so the hook is safe under any future SSR/prerender.
 */
export const useSyncStatus = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export default useSyncStatus;

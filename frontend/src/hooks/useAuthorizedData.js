// frontend/src/hooks/useAuthorizedData.js
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';

/**
 * Hook for loading and managing server-authorized data tied to the authenticated user.
 *
 * Usage:
 *   const { data, loading, error, refresh } = useAuthorizedData(async ({ ownerId }) => {
 *     return await api.get(`/admin/${ownerId}/stats`);
 *   });
 *
 * Behavior:
 *   - Calls `load({ ownerId })` when the user changes or when `load` itself changes
 *   - De-duplicates concurrent requests: if a new load() is passed while a fetch
 *     is in flight, the result of the NEW load is used (the old one is discarded)
 *   - When the user signs out, loading/error are cleared but previous data stays
 *     cached until a new user signs in (so a flash of empty state is avoided)
 *   - `refresh()` can be called to refetch on demand
 *
 * Authorization: the load() callback receives the authenticated user's id
 * (`ownerId`). Backend middleware and RLS policies enforce that each user can
 * only access their own authorized data — this hook doesn't implement
 * authorization itself, it just passes the user id to the API.
 *
 * @param {(opts: { ownerId: string }) => Promise<any>} load
 *   Async function that fetches the authorized data. Called with the current
 *   user's id. If load() changes and a fetch is in flight, the new load()
 *   result replaces the pending one.
 *
 * @returns {{
 *   data: any,
 *   loading: boolean,
 *   error: string,
 *   refresh: () => Promise<void>
 * }}
 */
export default function useAuthorizedData(load) {
  const { user } = useAuth();
  const ownerId = user?.id;
  // Increment this counter on every request so late responses can be ignored
  // (a new load() function while a fetch is in flight should discard the old result)
  const request = useRef(0);
  // Keep load() in a ref so the async function can call the latest version
  // without triggering a refetch when load changes
  const loadRef = useRef(load);
  const [state, setState] = useState({ ownerId: null, load: null, data: null, loading: true, error: '' });
  
  // Update the ref whenever load changes, but don't trigger a refetch
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setState((prevState) => ({ ...prevState, loading: Boolean(ownerId), error: '' }));
    if (!ownerId) return;
    try {
      const data = await loadRef.current({ ownerId });
      // Only update if this is still the latest request (de-duplication)
      if (current === request.current) setState({ ownerId, load, data, loading: false, error: '' });
    } catch (error) {
      // Only update if this is still the latest request
      if (current === request.current) setState({ ownerId, load, data: null, loading: false, error: error?.message || 'The authorized server data is unavailable.' });
    }
  }, [ownerId, load]);
  
  // Fetch whenever the user changes or load() changes
  useEffect(() => {
    void refresh();
    // Cancel any in-flight requests when this component unmounts or refreshes
    return () => { request.current += 1; };
  }, [refresh]);
  
  // Return cached state only if the user and load() function haven't changed.
  // If they have, show loading/empty state until the new fetch completes.
  const current = state.ownerId === ownerId && state.load === load;
  return { ...(current ? state : { data: null, loading: Boolean(ownerId), error: '' }), refresh };
}

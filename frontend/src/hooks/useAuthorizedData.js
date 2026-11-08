import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';

export default function useAuthorizedData(load) {
  const { user } = useAuth();
  const ownerId = user?.id;
  const request = useRef(0);
  const [state, setState] = useState({ ownerId: null, load: null, data: null, loading: true, error: '' });
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setState({ ownerId, load, data: null, loading: Boolean(ownerId), error: '' });
    if (!ownerId) return;
    try {
      const data = await load({ ownerId });
      if (current === request.current) setState({ ownerId, load, data, loading: false, error: '' });
    } catch (error) {
      if (current === request.current) setState({ ownerId, load, data: null, loading: false, error: error?.message || 'The authorized server data is unavailable.' });
    }
  }, [ownerId, load]);
  useEffect(() => {
    void refresh();
    return () => { request.current += 1; };
  }, [refresh]);
  const current = state.ownerId === ownerId && state.load === load;
  return { ...(current ? state : { data: null, loading: Boolean(ownerId), error: '' }), refresh };
}

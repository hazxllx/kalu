import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { householdsApi } from '@/services/api/householdsApi';

export default function useHouseholdWorkers({ householdId } = {}) {
  const { user } = useAuth();
  const ownerId = user?.id;
  const request = useRef(0);
  const [state, setState] = useState({ ownerId: null, householdId: null, rows: [], loading: true, error: '' });
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setState({ ownerId, householdId, rows: [], loading: Boolean(ownerId), error: '' });
    if (!ownerId) return;
    try {
      const result = await householdsApi.workers(householdId ? { householdId } : undefined, { ownerId });
      if (!Array.isArray(result?.rows)) throw new Error('The worker directory response was incomplete.');
      if (current === request.current) setState({ ownerId, householdId, rows: result.rows, loading: false, error: '' });
    } catch (error) {
      if (current === request.current) setState({ ownerId, householdId, rows: [], loading: false, error: error?.message || 'Could not load authorized workers.' });
    }
  }, [ownerId, householdId]);

  useEffect(() => {
    refresh();
    return () => { request.current += 1; };
  }, [refresh]);

  return {
    ...(state.ownerId === ownerId && state.householdId === householdId ? state : { rows: [], loading: Boolean(ownerId), error: '' }),
    refresh,
  };
}

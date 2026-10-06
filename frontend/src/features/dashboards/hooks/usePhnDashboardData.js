import { useCallback, useEffect, useState } from "react";

import { usePhnWorkflow } from "@/hooks/usePhnWorkflow";
import { followUpsApi, referralsApi, residentsApi } from "@/services/api";

/**
 * usePhnDashboardData — loads every real data source the PHN dashboard needs,
 * each independently so one failing endpoint never blanks the others.
 *
 *   queue      GET /phn/submissions            (persistent check-up pipeline)
 *   followUps  GET /operational/followups      (follow_ups, scope-enforced)
 *   referrals  GET /referrals                  (health_referrals, scope-enforced)
 *   residents  GET /residents                  (directory + authoritative risk)
 *
 * Scope (municipality / barangay) is enforced server-side from the session on
 * every call. A request that fails keeps its error message — callers must show
 * an error state, never a fabricated zero. Each source exposes its own
 * `reload()` so a retry button repeats exactly the failed request.
 */

const initialSource = { rows: [], loading: true, error: null };

function useRowsSource(loader) {
  const [state, setState] = useState(initialSource);

  const reload = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await loader();
      const rows = Array.isArray(result) ? result : result?.rows || result?.records || [];
      setState({ rows, loading: false, error: null });
    } catch (error) {
      setState({
        rows: [],
        loading: false,
        error: error?.message || "Unable to load data. Please try again.",
      });
    }
  }, [loader]);

  useEffect(() => {
    let active = true;
    (async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const result = await loader();
        const rows = Array.isArray(result) ? result : result?.rows || result?.records || [];
        if (active) setState({ rows, loading: false, error: null });
      } catch (error) {
        if (active) {
          setState({
            rows: [],
            loading: false,
            error: error?.message || "Unable to load data. Please try again.",
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [loader]);

  return { ...state, reload };
}

export function usePhnDashboardData() {
  const workflow = usePhnWorkflow({ source: "queue" });

  const loadFollowUps = useCallback(() => followUpsApi.list(), []);
  const loadReferrals = useCallback(() => referralsApi.list(), []);
  // 100 is the backend maximum for the resident directory; the high-risk section
  // is intentionally a short list with a "view all" link to the directory.
  const loadResidents = useCallback(() => residentsApi.list({ limit: 100 }), []);

  const followUps = useRowsSource(loadFollowUps);
  const referrals = useRowsSource(loadReferrals);
  const residents = useRowsSource(loadResidents);

  const reload = useCallback(
    () =>
      Promise.allSettled([
        workflow.refresh(),
        followUps.reload(),
        referrals.reload(),
        residents.reload(),
      ]),
    [workflow, followUps, referrals, residents],
  );

  return {
    queue: {
      patients: workflow.patients,
      loading: workflow.loading,
      error: workflow.error,
      reload: workflow.refresh,
      startCheckup: workflow.startCheckup,
    },
    followUps,
    referrals,
    residents,
    reload,
  };
}

export default usePhnDashboardData;

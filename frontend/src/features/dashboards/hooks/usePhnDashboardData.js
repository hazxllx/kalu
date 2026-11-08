import { useCallback } from "react";

import { usePhnWorkflow } from "@/hooks/usePhnWorkflow";
import { followUpsApi, referralsApi, residentsApi } from "@/services/api";
import useAuthorizedData from '@/hooks/useAuthorizedData';

/**
 * usePhnDashboardData — loads every real data source the PHN dashboard needs,
 * each independently so one failing endpoint never blanks the others.
 *
 *   queue      GET /phn/submissions            (persistent check-up pipeline)
 *   followUps  GET /operational/followups      (follow_ups, scope-enforced)
 *   referrals  GET /referrals/incoming         (assigned canonical health_referrals)
 *   residents  GET /residents?riskLevel=High    (full count + a bounded preview)
 *
 * Scope (municipality / barangay) is enforced server-side from the session on
 * every call. A request that fails keeps its error message — callers must show
 * an error state, never a fabricated zero. Each source exposes its own
 * `reload()` so a retry button repeats exactly the failed request.
 */

function useRowsSource(loader, endpoint, requireHighRisk = false) {
  const load = useCallback(async (options) => {
    try {
      const result = await loader(options);
      const rows = Array.isArray(result) ? result : result?.rows ?? result?.records;
      if (!Array.isArray(rows) || (requireHighRisk && result?.riskLevel !== 'High')) {
        throw new Error('The server did not return the requested verified record list.');
      }
      const total = result?.total ?? rows.length;
      if (!Number.isInteger(total) || total < rows.length) throw new Error('The server did not return a valid full record count.');
      return { rows, total };
    } catch (error) {
      const status = error?.status ? `HTTP ${error.status}` : 'request failed';
      const code = error?.payload?.error?.code;
      throw new Error(`${endpoint} (${status}${code ? `, ${code}` : ''}): ${error?.message || 'The backend source is unavailable.'}`);
    }
  }, [loader, endpoint, requireHighRisk]);
  const source = useAuthorizedData(load);
  return { rows: source.data?.rows || [], total: source.data?.total ?? null,
    loading: source.loading, error: source.error, reload: source.refresh };
}

export function usePhnDashboardData() {
  const workflow = usePhnWorkflow({ source: "queue" });

  const loadFollowUps = useCallback((options) => followUpsApi.list({}, options), []);
  const loadReferrals = useCallback((options) => referralsApi.inbox({}, options), []);
  const loadResidents = useCallback((options) => residentsApi.list({ limit: 4, riskLevel: 'High' }, options), []);

  const followUps = useRowsSource(loadFollowUps, 'GET /operational/followups');
  const referrals = useRowsSource(loadReferrals, 'GET /referrals/incoming');
  const residents = useRowsSource(loadResidents, 'GET /residents?riskLevel=High', true);

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

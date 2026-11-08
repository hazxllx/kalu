import { useCallback } from "react";
import { phnWorkflowApi } from "@/services/api/phnWorkflow";
import { useAuth } from "@/context/AuthContext";
import { classifySyncError, SYNC_ERROR } from "@/services/offline/errors";
import { OfflineActionRequiredError, MUTATION_TIER } from "@/services/offline/mutationPolicy";
import useAuthorizedData from './useAuthorizedData.js';

/**
 * usePhnWorkflow — persistent RHU triage → PHN check-up pipeline (BUG-008).
 *
 * Reads the authoritative workflow state from PostgreSQL via the `/intake` and
 * `/phn` endpoints instead of a browser-only store, so triage hand-offs, queue
 * status, check-up start and completion survive refresh, logout/login, another
 * device and another authorized staff session.
 *
 *   source: 'queue'  -> the PHN queue (GET /phn/submissions), PHN role
 *           'intake' -> the caller's own intake submissions (GET /intake/visits)
 *
 * Returns { patients, loading, error, refresh } plus thin async mutators that
 * persist to the backend and refresh from it (never local-only writes).
 */
export function usePhnWorkflow({ source = "queue" } = {}) {
  const { user } = useAuth();
  const ownerId = user?.id;
  const loadRows = useCallback(async () => {
    try {
      const rows = await (source === 'intake' ? phnWorkflowApi.listMyIntakeOffline(ownerId) : phnWorkflowApi.listQueueOffline(ownerId));
      if (!Array.isArray(rows)) throw new Error('The workflow server returned an invalid list.');
      return rows;
    } catch (error) {
      const info = classifySyncError(error);
      const endpoint = source === 'intake' ? 'GET /intake/visits' : 'GET /phn/submissions';
      const status = error?.status ? `HTTP ${error.status}` : info.code === SYNC_ERROR.STORAGE ? 'device storage' : 'request failed';
      const code = error?.payload?.error?.code;
      throw new Error(`${endpoint} (${status}${code ? `, ${code}` : ''}): ${error?.message || 'The patient workflow is unavailable.'}`);
    }
  }, [source, ownerId]);
  const workflow = useAuthorizedData(loadRows);
  const { refresh } = workflow;
  const patients = workflow.data || [];
  const loading = workflow.loading;
  const error = workflow.error;

  const sendToPhnQueue = useCallback(async (payload) => {
    try {
      await phnWorkflowApi.sendToPhnQueue(payload);
      await refresh();
      return false;
    } catch (error) {
      // The apiClient turns an offline RHU hand-off into an ONLINE_ONLY error
      // (and never auto-submits). Treat that boundary — and a genuine network
      // failure — as the save-offline signal. Validation/auth failures rethrow.
      const requiresOfflineDraft =
        error instanceof OfflineActionRequiredError ||
        error?.code === MUTATION_TIER.ONLINE_ONLY ||
        classifySyncError(error).code === SYNC_ERROR.NETWORK;
      if (!requiresOfflineDraft) throw error;
      await phnWorkflowApi.saveTriageDraft(ownerId, payload);
      await refresh();
      return true;
    }
  }, [ownerId, refresh]);

  const startCheckup = useCallback(async (id) => {
    await phnWorkflowApi.startCheckup(id);
    await refresh();
  }, [refresh]);

  const completeCheckup = useCallback(async (id, recorded) => {
    await phnWorkflowApi.completeCheckup(id, recorded);
    await refresh();
  }, [refresh]);

  return { patients, loading, error, refresh, sendToPhnQueue, startCheckup, completeCheckup };
}

export default usePhnWorkflow;

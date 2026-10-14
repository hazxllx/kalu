import { useCallback, useEffect, useState } from "react";
import { phnWorkflowApi } from "@/services/api/phnWorkflow";
import { useAuth } from "@/context/AuthContext";
import { classifySyncError, SYNC_ERROR } from "@/services/offline/errors";

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
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadRows = useCallback(async () => {
    return source === "intake"
      ? phnWorkflowApi.listMyIntakeOffline(ownerId)
      : phnWorkflowApi.listQueueOffline(ownerId);
  }, [source, ownerId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await loadRows();
      setPatients(rows);
    } catch (e) {
      // Classify so a local IndexedDB/storage failure is not misreported as a
      // server error. Network failures remain retryable; storage failures are
      // surfaced with a storage-specific message so the queue can be retried
      // without masking the root cause.
      const info = classifySyncError(e);
      const msg =
        info.code === SYNC_ERROR.STORAGE
          ? e?.message || "Device storage error. Try reloading; pending work is preserved."
          : e?.message || "Unable to load the patient workflow.";
      setError(msg);
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, [loadRows]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await loadRows();
        if (active) setPatients(rows);
      } catch (e) {
        if (active) {
          const info = classifySyncError(e);
          const msg =
            info.code === SYNC_ERROR.STORAGE
              ? e?.message || "Device storage error. Try reloading; pending work is preserved."
              : e?.message || "Unable to load the patient workflow.";
          setError(msg);
          setPatients([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadRows]);

  const sendToPhnQueue = useCallback(async (payload) => {
    try {
      await phnWorkflowApi.sendToPhnQueue(payload);
      await refresh();
      return false;
    } catch (error) {
      if (classifySyncError(error).code !== SYNC_ERROR.NETWORK) throw error;
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

import { useCallback, useEffect, useState } from "react";
import { phnWorkflowApi } from "@/services/api/phnWorkflow";

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
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows =
        source === "intake"
          ? await phnWorkflowApi.listMyIntake()
          : await phnWorkflowApi.listQueue();
      setPatients(rows);
    } catch (e) {
      setError(e?.message || "Unable to load the patient workflow.");
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows =
          source === "intake"
            ? await phnWorkflowApi.listMyIntake()
            : await phnWorkflowApi.listQueue();
        if (active) setPatients(rows);
      } catch (e) {
        if (active) {
          setError(e?.message || "Unable to load the patient workflow.");
          setPatients([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [source]);

  const sendToPhnQueue = useCallback(async (payload) => {
    await phnWorkflowApi.sendToPhnQueue(payload);
    await refresh();
  }, [refresh]);

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

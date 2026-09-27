import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { medicalCertificatesApi } from "@/services/api";

/**
 * API-backed medical certificate register.
 *
 * Replaces the browser-session `medicalCertificateStore`, which started empty
 * on every page load and therefore showed an empty register to every role —
 * certificates "created" in one browser tab existed nowhere else and vanished
 * on refresh. Everything here is the real `medical_certificates` table served
 * by `/api/medical-certificates`, scoped on the server to the caller's
 * barangay/municipality.
 *
 * The status vocabulary, purposes and legal transitions are fetched from
 * `GET /meta` so the register can never drift from the API's own workflow
 * (which the service re-validates on every transition).
 */

const FALLBACK = {
  statuses: ["Draft", "For Review", "Approved", "Issued", "Rejected", "Cancelled"],
  purposes: ["General Medical Certificate"],
  allowedTransitions: {},
  canDecide: false,
};

export function useCertificateMeta() {
  const [meta, setMeta] = useState(FALLBACK);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    medicalCertificatesApi
      .meta()
      .then((payload) => {
        if (active && payload) setMeta({ ...FALLBACK, ...payload });
      })
      .catch(() => {
        /* keep the fallback vocabulary; the API still validates transitions */
      })
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, []);

  return { ...meta, loaded };
}

/**
 * @param {{status?: string, residentId?: string}} params
 * @returns {{rows, loading, error, refresh, setStatus, create, update}}
 */
export function useCertificateRegister(params = {}) {
  const { status, residentId } = params;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Avoids a state update after unmount when a request resolves late.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await medicalCertificatesApi.list({
        status: status || undefined,
        residentId: residentId || undefined,
      });
      if (alive.current) setRows(payload?.rows || payload?.records || []);
    } catch (err) {
      if (!alive.current) return;
      setRows([]);
      setError(err?.message || "The certificate register could not be loaded.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [status, residentId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Apply a status change and replace the row with the server's response. */
  const setStatus = useCallback(
    async (id, nextStatus, notes = "") => {
      const { record } = await medicalCertificatesApi.changeStatus(id, nextStatus, notes);
      if (alive.current) {
        setRows((prev) => (prev.some((c) => c.id === id) ? prev.map((c) => (c.id === id ? record : c)) : [record, ...prev]));
      }
      return record;
    },
    [],
  );

  const create = useCallback(async (payload) => {
    const { record } = await medicalCertificatesApi.create(payload);
    if (alive.current) setRows((prev) => [record, ...prev]);
    return record;
  }, []);

  const update = useCallback(async (id, payload) => {
    const { record } = await medicalCertificatesApi.update(id, payload);
    if (alive.current) setRows((prev) => prev.map((c) => (c.id === id ? record : c)));
    return record;
  }, []);

  return useMemo(
    () => ({ rows, loading, error, refresh: load, setStatus, create, update }),
    [rows, loading, error, load, setStatus, create, update],
  );
}

export default useCertificateRegister;

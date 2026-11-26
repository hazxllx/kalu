// frontend/src/context/BarangaysContext.jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { barangaysApi } from "@/services/api/barangaysApi";
import {
  BARANGAYS,
  setBarangayNames,
  subscribeBarangays,
  getBarangays,
  getBarangayFilters,
} from "@/lib/barangays";

/**
 * BarangaysContext — exposes the approved barangay names and database records.
 *
 * The canonical names come from `shared/barangays.js`; the database registry
 * supplies their stable ids and municipality metadata. A `refresh()` reloads
 * those records after administrative changes.
 *
 * The backend exposes a read-only active-name projection for public pages, so
 * every application-data request still follows the centralized API client. If
 * the read is unavailable, canonical fallback names keep selectors usable.
 */

/**
 * @typedef {Object} BarangayRecord
 * @property {string} id
 * @property {string} name
 * @property {string} status
 * @property {string} [municipality]
 */

const BarangaysContext = createContext(/** @type {any} */ (null));

const EMPTY_RECORDS = Object.freeze([]);

export function BarangaysProvider({ children }) {
  const [records, setRecords] = useState(/** @type {BarangayRecord[]} */ (EMPTY_RECORDS));
  const [names, setNames] = useState(() => getBarangays());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const mounted = useRef(true);

  // Keep local state aligned with any in-place hydration of the registry
  // (e.g. a direct setBarangayNames call elsewhere).
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeBarangays((next) => {
      if (mounted.current) setNames([...next]);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, []);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await barangaysApi.publicList({ force });
      const mapped = Array.isArray(response) ? response : [];
      if (!mounted.current) return;
      const approved = mapped.filter((record) => BARANGAYS.includes(record.name));
      setRecords(approved);
      // Notify subscribers while keeping selectors on the canonical list.
      setBarangayNames();
    } catch (err) {
      if (!mounted.current) return;
      setError(err?.message || "Unable to load barangays.");
      // Preserve whatever the registry currently holds (fallback or prior load).
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const value = useMemo(
    () => ({
      /** Active barangay names (live). */
      barangays: names,
      /** Filter values: ["All", ...names]. */
      filters: getBarangayFilters(),
      /** Full active barangay records (id, name, municipality, …). */
      records,
      loading,
      error,
      refresh: () => load(true),
    }),
    [names, records, loading, error, load],
  );

  return <BarangaysContext.Provider value={value}>{children}</BarangaysContext.Provider>;
}

/**
 * Reactive access to the live barangay list. Safe to call outside the provider:
 * it then falls back to the runtime registry snapshot (still live via the store
 * subscription) so a stray consumer never crashes.
 */
export function useBarangays() {
  const ctx = useContext(BarangaysContext);
  const [fallbackNames, setFallbackNames] = useState(() => getBarangays());

  useEffect(() => {
    if (ctx) return undefined;
    const unsubscribe = subscribeBarangays((next) => setFallbackNames([...next]));
    return unsubscribe;
  }, [ctx]);

  if (ctx) return ctx;
  return {
    barangays: fallbackNames,
    filters: ["All", ...fallbackNames],
    records: EMPTY_RECORDS,
    loading: false,
    error: null,
    refresh: async () => {},
  };
}

export default BarangaysContext;

// Re-export so consumers can read the live arrays without a second import.
export { BARANGAYS };

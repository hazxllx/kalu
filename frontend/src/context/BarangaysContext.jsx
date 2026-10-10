import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";
import {
  BARANGAYS,
  FALLBACK_BARANGAYS,
  setBarangayNames,
  subscribeBarangays,
  getBarangays,
  getBarangayFilters,
} from "@/lib/barangays";

/**
 * BarangaysContext — the single app-wide source of the live barangay list.
 *
 * The authoritative data lives in the database (public.barangays). This
 * provider loads the ACTIVE barangays once at startup, hydrates the runtime
 * registry in `@/lib/barangays` (so non-React modules such as the scope helpers
 * stay in sync), and exposes a reactive hook for components that render barangay
 * selectors. A `refresh()` is returned so pages that mutate the registry (the
 * Admin Barangay Management page) can immediately re-propagate the new list
 * everywhere without a manual reload.
 *
 * public.barangays is public-readable (anon + authenticated) via RLS, so this
 * works on the public registration pages too. If the read is unavailable the
 * canonical fallback names remain so no selector renders empty.
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

  const load = useCallback(async () => {
    if (!supabase) {
      // Supabase not configured: keep the fallback registry, stop loading.
      setBarangayNames([...FALLBACK_BARANGAYS]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from("barangays")
        .select("id, name, status, municipality_id, created_at, municipalities(name)")
        .eq("status", "Active")
        .order("name", { ascending: true });
      if (queryError) throw queryError;
      const rows = Array.isArray(data) ? data : [];
      const mapped = rows.map((r) => {
        const muni = Array.isArray(r.municipalities) ? r.municipalities[0] : r.municipalities;
        return {
          id: r.id,
          name: r.name,
          status: r.status,
          municipalityId: r.municipality_id,
          municipality: muni?.name || "",
          createdAt: r.created_at,
        };
      });
      if (!mounted.current) return;
      setRecords(mapped);
      // Hydrate the shared runtime registry (notifies the store subscriber above).
      setBarangayNames(mapped.map((r) => r.name));
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
      refresh: load,
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

/**
 * KALUSAGAP barangay runtime registry (frontend cache).
 *
 * IMPORTANT: this module is NOT the source of truth for barangays. The
 * authoritative list lives in the database (public.barangays) and is managed by
 * the Admin "Barangay Management" page. This module is a small runtime cache
 * that the whole frontend reads from, hydrated once at startup (and refreshed
 * after admin changes) by `BarangaysProvider` / `useBarangays`.
 *
 * The three canonical Pili barangays below are kept ONLY as an offline fallback
 * so a selector never renders empty when the database read is briefly
 * unavailable. They are replaced the moment the live list loads.
 *
 * The exported `BARANGAYS` / `BARANGAY_FILTERS` arrays are mutated IN PLACE (the
 * array identities never change) so every module that imported them — including
 * the scope helpers in `supervisorScope.js` / `phnScope.js` — transparently
 * sees the live list without being rewritten. React components that must
 * re-render when the list changes should use the `useBarangays()` hook.
 */

/** Offline fallback only — the database is the source of truth. */
export const FALLBACK_BARANGAYS = Object.freeze(["San Isidro", "San Antonio", "Old San Roque"]);

/**
 * Live barangay name list. Seeded with the fallback, then hydrated from the DB.
 * Mutated in place by `setBarangayNames` so existing imports stay live.
 */
export const BARANGAYS = [...FALLBACK_BARANGAYS];

/** Live filter values: "All" is a filter option, never a barangay. */
export const BARANGAY_FILTERS = ["All", ...FALLBACK_BARANGAYS];

const subscribers = new Set();

/** Replace the array contents in place (keeps the exported identity stable). */
const replaceInPlace = (target, next) => {
  target.splice(0, target.length, ...next);
  return target;
};

/**
 * Hydrate the runtime registry from the database list of barangay names.
 * Empty / invalid input falls back to the canonical three so the app never
 * renders an empty barangay selector.
 */
export const setBarangayNames = (names) => {
  const cleaned = Array.isArray(names)
    ? Array.from(new Set(names.map((n) => (typeof n === "string" ? n.trim() : "")).filter(Boolean)))
    : [];
  const next = cleaned.length ? cleaned : [...FALLBACK_BARANGAYS];
  replaceInPlace(BARANGAYS, next);
  replaceInPlace(BARANGAY_FILTERS, ["All", ...next]);
  subscribers.forEach((fn) => {
    try { fn(next); } catch { /* a subscriber error must not break hydration */ }
  });
  return next;
};

/** Subscribe to runtime barangay-list changes. Returns an unsubscribe fn. */
export const subscribeBarangays = (fn) => {
  if (typeof fn !== "function") return () => {};
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};

/** Current live snapshot (new array) of barangay names. */
export const getBarangays = () => [...BARANGAYS];

/** Current live snapshot of filter values (["All", ...names]). */
export const getBarangayFilters = () => [...BARANGAY_FILTERS];

/** True when `value` is one of the current barangays. */
export const isBarangay = (value) => BARANGAYS.includes(value);

/**
 * Returns the scope of a data row. A row is:
 *   - barangay-scoped when it carries one of the current barangay names
 *   - otherwise RHU-level (no barangay assignment)
 */
export const itemBarangay = (item) => (item && isBarangay(item.barangay) ? item.barangay : null);

/** Human label for a row's scope ("RHU" when it has no barangay). */
export const itemScopeLabel = (item) => itemBarangay(item) || "RHU";

import { APPROVED_BARANGAYS } from "../../../shared/barangays.js";

/**
 * KALUSAGAP barangay runtime registry (frontend cache).
 *
 * The approved names are shared in `shared/barangays.js`; the database
 * registry supplies their stable ids and coordinates. This module keeps the
 * approved selector values stable while the provider loads reference records.
 *
 * The approved names are also the offline fallback, so a selector never
 * renders an unapproved legacy barangay when the database read is unavailable.
 *
 * The exported `BARANGAYS` / `BARANGAY_FILTERS` arrays are mutated IN PLACE (the
 * array identities never change) so every module that imported them — including
 * the scope helpers in `supervisorScope.js` / `phnScope.js` — transparently
 * sees the live list without being rewritten. React components that must
 * re-render when the list changes should use the `useBarangays()` hook.
 */

/** The only barangays the application permits assigning or selecting. */
export const FALLBACK_BARANGAYS = APPROVED_BARANGAYS;

/**
 * Runtime selection list. Mutated in place by `setBarangayNames` so existing
 * imports stay live and can never be widened by database rows.
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
 * Reassert the canonical selection list and notify reactive consumers.
 */
export const setBarangayNames = () => {
  const next = [...APPROVED_BARANGAYS];
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

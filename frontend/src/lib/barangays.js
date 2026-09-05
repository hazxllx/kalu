/**
 * KALUSAGAP canonical barangay definitions.
 *
 * The ONLY barangays valid anywhere in the frontend are:
 *   San Isidro · San Antonio · Old San Roque
 */
export const BARANGAYS = Object.freeze(["San Isidro", "San Antonio", "Old San Roque"]);

/** Filter values: "All" is a filter option, never a barangay. */
export const BARANGAY_FILTERS = Object.freeze(["All", ...BARANGAYS]);

/** True when `value` is one of the official barangays. */
export const isBarangay = (value) => BARANGAYS.includes(value);

/**
 * Returns the scope of a data row. A row is:
 *   - barangay-scoped when it carries one of the official barangay names
 *   - otherwise RHU-level (no barangay assignment)
 */
export const itemBarangay = (item) => (item && isBarangay(item.barangay) ? item.barangay : null);

/** Human label for a row's scope ("RHU" when it has no barangay). */
export const itemScopeLabel = (item) => itemBarangay(item) || "RHU";

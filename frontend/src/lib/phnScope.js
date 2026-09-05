import { ROLE } from "@/lib/roles";
import { BARANGAYS, BARANGAY_FILTERS, isBarangay } from "@/lib/barangays";

/**
 * Centralized Public Health Nurse (PHN) data-scope rules.
 *
 * A PHN account has an explicit barangay assignment:
 *   - assignedBarangay === null  → RHU-level access ONLY
 *   - assignedBarangay === brgy  → RHU-level access + that barangay's data
 *
 * The PHN must NEVER see another barangay's data, and an unassigned PHN must
 * NOT automatically see any barangay-specific data.
 *
 * These helpers are frontend demonstration only — the real authorization
 * layer must live on the backend.
 */

const PHN_SCOPE_RHU = "rhu";
const PHN_SCOPE_BARANGAY = "barangay";

/**
 * Resolve the scope of a user (or user-shaped object).
 *
 * Returns:
 *   { level: "rhu", assignedBarangay: null }
 * or
 *   { level: "barangay", assignedBarangay: "San Isidro" }
 *
 * For non-PHN roles this returns null so callers can preserve existing
 * role behavior unchanged.
 */
export const getPHNScope = (user) => {
  if (!user || user.role !== ROLE.PHN) return null;

  const assignedBarangay = user.assignedBarangay ?? user.barangay ?? null;
  if (assignedBarangay && isBarangay(assignedBarangay)) {
    return { level: PHN_SCOPE_BARANGAY, assignedBarangay };
  }
  return { level: PHN_SCOPE_RHU, assignedBarangay: null };
};

/** True when the authenticated user is a PHN. */
export const isPHN = (user) => Boolean(user && user.role === ROLE.PHN);

/**
 * True when a data row is visible to the given user under PHN scope rules.
 *
 * A row is:
 *   - barangay-scoped when its `barangay` is an official barangay
 *   - otherwise treated as RHU-level (no barangay)
 *
 * PHN rules:
 *   - unassigned PHN  → RHU-level rows only
 *   - assigned PHN    → RHU-level rows + assigned barangay rows
 *   - any other role  → always visible (preserve existing role behavior)
 */
export const isVisibleToUser = (row, user) => {
  if (!isPHN(user)) return true;
  const scope = getPHNScope(user);
  if (!scope) return true;

  const brgy = row && isBarangay(row.barangay) ? row.barangay : null;
  if (!brgy) return true; // RHU-level rows are visible to every PHN
  return scope.level === PHN_SCOPE_BARANGAY && brgy === scope.assignedBarangay;
};

/** Filter a list of rows down to what the user may see. */
export const filterRowsByScope = (rows, user) =>
  Array.isArray(rows) ? rows.filter((row) => isVisibleToUser(row, user)) : [];

/** Display coverage string for a PHN ("RHU" or "RHU + San Isidro"). */
export const phnCoverageLabel = (user) => {
  const scope = getPHNScope(user);
  if (!scope || scope.level === PHN_SCOPE_RHU) return "RHU";
  return `${scope.assignedBarangay} + RHU`;
};

/** Coverage subtitle used on dashboards/report headers. */
export const phnCoverageSubtitle = (user) => {
  const scope = getPHNScope(user);
  if (!scope || scope.level === PHN_SCOPE_RHU) {
    return "RHU-level coverage";
  }
  return `RHU + ${scope.assignedBarangay}`;
};

/** The allowed barangay filter set for reports/pages (RHU + assigned). */
export const phnReportScopes = (user) => {
  const scope = getPHNScope(user);
  if (!scope || scope.level === PHN_SCOPE_RHU) return ["All"];
  return ["All", "RHU", scope.assignedBarangay];
};

export const PHN_SCOPE = Object.freeze({
  RHU: PHN_SCOPE_RHU,
  BARANGAY: PHN_SCOPE_BARANGAY,
});

/** Scope-level sentinel used in forms/filters (never a real barangay). */
export const RHU_OPTION = "RHU";

/**
 * Barangay options for a NEW/EDITED record owned by a PHN.
 *   - unassigned PHN → only "RHU" (saved as barangay: null)
 *   - assigned PHN   → "RHU" + their assigned barangay
 *   - any other role → the full three-barangay list (unchanged behavior)
 */
export const phnWritableBarangays = (user) => {
  const scope = getPHNScope(user);
  if (!scope) return [...BARANGAYS];
  if (scope.level === PHN_SCOPE_RHU) return [RHU_OPTION];
  return [RHU_OPTION, scope.assignedBarangay];
};

/** Default barangay for a new record ("" for non-PHN forms). */
export const phnDefaultBarangay = (user) => {
  const scope = getPHNScope(user);
  if (!scope) return "";
  if (scope.level === PHN_SCOPE_RHU) return RHU_OPTION;
  return scope.assignedBarangay;
};

/** Convert the RHU_OPTION sentinel back to a stored barangay (null). */
export const normalizeBarangay = (value) => (value === RHU_OPTION ? null : value || null);

/**
 * Filter options for a table/queue dropdown under PHN scope rules.
 *   - non-PHN roles   → ["All", ...three barangays] (unchanged behavior)
 *   - unassigned PHN  → ["All"] (everything visible is RHU-level)
 *   - assigned PHN    → ["All", "RHU", assignedBarangay]
 */
export const phnFilterOptions = (user) => {
  const scope = getPHNScope(user);
  if (!scope) return BARANGAY_FILTERS;
  if (scope.level === PHN_SCOPE_BARANGAY) return ["All", RHU_OPTION, scope.assignedBarangay];
  return ["All"];
};

/** True when a visible row matches a selected dropdown option. */
export const rowMatchesOption = (row, option, user) => {
  if (!option || option === "All") return true;
  if (option === RHU_OPTION) {
    return !(row && isBarangay(row.barangay));
  }
  return row?.barangay === option;
};

/**
 * Human label for a row's scope — "RHU" when the row has no barangay,
 * otherwise the barangay name. For non-PHN roles this always returns the
 * stored barangay value so existing tables keep their behavior.
 */
export const scopeLabel = (row, user) => {
  if (isPHN(user)) {
    const brgy = row && isBarangay(row.barangay) ? row.barangay : null;
    return brgy || RHU_OPTION;
  }
  return row?.barangay || RHU_OPTION;
};

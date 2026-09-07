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
 * PHN COVERAGE SELECTOR
 * A barangay-assigned PHN switches their working coverage between two scopes:
 *   - their assigned barangay (e.g. "San Isidro") — barangay-level coverage
 *   - "RHU" — Rural Health Unit / broader coverage
 * When the assigned barangay coverage is active only that barangay's rows are
 * shown; when "RHU" is active only RHU-level rows (no barangay) are shown.
 * An unassigned PHN only ever has the "RHU" coverage.
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

/** Barangay the PHN is assigned to, or null when they are an RHU-only PHN. */
export const phnAssignedBarangay = (user) => {
  const scope = getPHNScope(user);
  return scope && scope.level === PHN_SCOPE_BARANGAY ? scope.assignedBarangay : null;
};

/* --------------------------- Coverage selector --------------------------- */

/**
 * Selectable coverages for a PHN, in display order.
 *   - barangay PHN → [{ assigned barangay }, { RHU }]
 *   - RHU-only PHN → [{ RHU }]
 *   - any other role → [] (no coverage concept)
 * A barangay coverage is identified by the barangay name itself; "RHU" is the
 * RHU-level coverage (the `RHU_OPTION` sentinel already used across the app).
 */
export const coverageOptions = (user) => {
  if (!isPHN(user)) return [];
  const brgy = phnAssignedBarangay(user);
  const options = [];
  if (brgy) {
    options.push({ value: brgy, kind: "barangay", label: brgy, hint: `${brgy} — barangay-level coverage` });
  }
  options.push({ value: RHU_OPTION, kind: "rhu", label: "RHU", hint: "RHU — Rural Health Unit, broader coverage" });
  return options;
};

/** Default coverage for a PHN: the assigned barangay, else RHU. Non-PHN → null. */
export const defaultCoverage = (user) => {
  if (!isPHN(user)) return null;
  return phnAssignedBarangay(user) || RHU_OPTION;
};

/**
 * Normalize a requested coverage to one the PHN may actually use.
 * A barangay PHN may pick their assigned barangay or RHU; an RHU-only PHN can
 * only ever resolve to RHU. Any other value falls back to the user's default
 * coverage so a PHN can never land on a scope they are not authorized for.
 */
export const resolveCoverage = (user, value) => {
  if (!isPHN(user)) return null;
  if (value === RHU_OPTION) return RHU_OPTION;
  const brgy = phnAssignedBarangay(user);
  if (brgy && value === brgy) return brgy;
  return defaultCoverage(user);
};

/** True when a data row belongs to the given coverage value. */
export const rowInCoverage = (row, coverageValue) => {
  if (coverageValue === RHU_OPTION) return !isBarangay(row && row.barangay);
  return row?.barangay === coverageValue;
};

/** Human label used in UI text ("San Isidro" / "RHU"). */
export const coverageTitleLabel = (coverage) => (coverage === RHU_OPTION ? "RHU" : coverage || "RHU");

/** One-line description shown next to the coverage selector. */
export const coverageSubtitle = (coverage) =>
  coverage === RHU_OPTION
    ? "Rural Health Unit (RHU) — broader coverage"
    : `Barangay-level coverage — ${coverage}`;

/** Filter rows to the active coverage of a PHN (any other role sees everything). */
export const filterRowsByCoverage = (rows, user, coverage) => {
  if (!Array.isArray(rows)) return [];
  if (!isPHN(user)) return rows;
  const c = resolveCoverage(user, coverage);
  if (c === null) return rows;
  return rows.filter((row) => rowInCoverage(row, c));
};

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

/**
 * Filter a list of rows down to what the user may see.
 *
 * When `coverage` is provided the PHN rows are limited to that coverage
 * (assigned barangay OR RHU). When omitted the legacy behavior is preserved:
 * a barangay PHN sees RHU-level rows + their own barangay rows (used by
 * screens that have not opted into the coverage selector).
 */
export const filterRowsByScope = (rows, user, coverage) => {
  if (coverage !== undefined && coverage !== null) {
    return filterRowsByCoverage(rows, user, coverage);
  }
  return Array.isArray(rows) ? rows.filter((row) => isVisibleToUser(row, user)) : [];
};

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
 *   - with `coverage`: only the active coverage's scope (write where you work)
 *   - without `coverage`: unassigned PHN → only "RHU"; assigned PHN →
 *     "RHU" + their assigned barangay (legacy combined behavior)
 *   - any other role → the full three-barangay list (unchanged behavior)
 */
export const phnWritableBarangays = (user, coverage) => {
  const scope = getPHNScope(user);
  if (!scope) return [...BARANGAYS];
  if (coverage === undefined || coverage === null) {
    if (scope.level === PHN_SCOPE_RHU) return [RHU_OPTION];
    return [RHU_OPTION, scope.assignedBarangay];
  }
  const c = resolveCoverage(user, coverage);
  return c === RHU_OPTION ? [RHU_OPTION] : [c];
};

/**
 * Default barangay for a new record.
 *   - with `coverage`: the active coverage's scope
 *   - without `coverage`: "" for non-PHN forms; the old RHU/assigned default
 */
export const phnDefaultBarangay = (user, coverage) => {
  const scope = getPHNScope(user);
  if (!scope) return "";
  if (coverage === undefined || coverage === null) {
    if (scope.level === PHN_SCOPE_RHU) return RHU_OPTION;
    return scope.assignedBarangay;
  }
  return resolveCoverage(user, coverage) || RHU_OPTION;
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

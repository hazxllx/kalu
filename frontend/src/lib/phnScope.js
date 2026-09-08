import { ROLE } from "@/lib/roles";
import { BARANGAYS, BARANGAY_FILTERS, isBarangay } from "@/lib/barangays";

/**
 * Centralized Public Health Nurse (PHN) data-scope rules.
 *
 * PHNs are RHU-based personnel ONLY — they have no barangay assignment.
 * The PHN works at the Rural Health Unit and handles the RHU workflow:
 * check-ups, health records, referrals, follow-ups and health services. The
 * patients in those workflows may come from any barangay (BHWs / barangay
 * health centers refer them to the RHU), so the PHN is NOT limited by the
 * patient's residence barangay. A patient's barangay is simply reference
 * information on the row, never an access boundary for the PHN.
 *
 * Barangay assignment and barangay-scoped verification belong to the Health
 * Supervisor role (see `@/lib/supervisorScope` and `@/lib/barangayScope`),
 * never to PHNs.
 *
 * These helpers are frontend demonstration only — the real authorization
 * layer must live on the backend.
 */

const PHN_SCOPE_RHU = "rhu";
const PHN_SCOPE_BARANGAY = "barangay";

/**
 * Resolve the scope of a user (or user-shaped object).
 *
 * A PHN is always RHU-only:
 *   { level: "rhu", assignedBarangay: null }
 *
 * For non-PHN roles this returns null so callers can preserve existing
 * role behavior unchanged.
 */
export const getPHNScope = (user) => {
  if (!user || user.role !== ROLE.PHN) return null;
  return { level: PHN_SCOPE_RHU, assignedBarangay: null };
};

/** True when the authenticated user is a PHN. */
export const isPHN = (user) => Boolean(user && user.role === ROLE.PHN);

/** PHNs are never assigned to a barangay — always null. */
export const phnAssignedBarangay = () => null;

/* --------------------------- Coverage helpers --------------------------- */

/**
 * Selectable coverages for a PHN. PHNs are RHU-only, so there is exactly one
 * coverage and no barangay option is ever offered.
 *   - PHN        → [{ RHU }]
 *   - other role → [] (no coverage concept)
 */
export const coverageOptions = (user) => {
  if (!isPHN(user)) return [];
  return [{ value: RHU_OPTION, kind: "rhu", label: "RHU", hint: "RHU — Rural Health Unit coverage" }];
};

/** Default coverage for a PHN: always RHU. Non-PHN → null. */
export const defaultCoverage = (user) => (isPHN(user) ? RHU_OPTION : null);

/**
 * Normalize a requested coverage. PHNs can only ever resolve to RHU — any
 * barangay value is rejected so a PHN can never land on a barangay scope.
 */
export const resolveCoverage = (user) => {
  if (!isPHN(user)) return null;
  return RHU_OPTION;
};

/** True when a data row belongs to the given coverage value. */
export const rowInCoverage = (row, coverageValue) => {
  if (coverageValue === RHU_OPTION) return true;
  return row?.barangay === coverageValue;
};

/** Human label used in UI text (always "RHU" for a PHN). */
export const coverageTitleLabel = (coverage) => (coverage === RHU_OPTION ? "RHU" : coverage || "RHU");

/** One-line description shown next to the coverage selector. */
export const coverageSubtitle = (coverage) =>
  coverage === RHU_OPTION ? "Rural Health Unit (RHU) coverage" : "";

/** Filter rows to the active coverage of a PHN (any other role sees everything). */
export const filterRowsByCoverage = (rows, user) => {
  if (!Array.isArray(rows)) return [];
  if (!isPHN(user)) return rows;
  return rows;
};

/**
 * True when a data row is visible to the given user under PHN scope rules.
 *
 * The PHN (RHU-based) works the RHU workflow, which receives patients from any
 * barangay, so no row is hidden from a PHN based on the patient's residence
 * barangay. Any other role sees every row too (existing role behavior).
 */
export const isVisibleToUser = () => true;

/**
 * Filter a list of rows down to what the user may see.
 *
 * PHN lists are RHU workflow lists and are returned unchanged; other roles
 * also see the full list (preserving existing behavior).
 */
export const filterRowsByScope = (rows) => (Array.isArray(rows) ? rows : []);

/** Display coverage string for a PHN (always "RHU"). */
export const phnCoverageLabel = () => "RHU";

/** Coverage subtitle used on dashboards/report headers. */
export const phnCoverageSubtitle = () => "RHU-level coverage";

/** The allowed barangay filter set for reports/pages (RHU only). */
export const phnReportScopes = () => ["All"];

export const PHN_SCOPE = Object.freeze({
  RHU: PHN_SCOPE_RHU,
  BARANGAY: PHN_SCOPE_BARANGAY,
});

/** Scope-level sentinel used in forms/filters (never a real barangay). */
export const RHU_OPTION = "RHU";

/**
 * Barangay options for a NEW/EDITED record owned by a PHN.
 * PHNs are RHU-based, so only the "RHU" option is ever offered. Any other role
 * keeps the full three-barangay list (unchanged behavior).
 */
export const phnWritableBarangays = (user) => {
  const scope = getPHNScope(user);
  if (!scope) return [...BARANGAYS];
  return [RHU_OPTION];
};

/**
 * Default barangay for a new record.
 * PHNs always write RHU-level records ("RHU" sentinel → stored as null).
 */
export const phnDefaultBarangay = (user) => {
  const scope = getPHNScope(user);
  if (!scope) return "";
  return RHU_OPTION;
};

/** Convert the RHU_OPTION sentinel back to a stored barangay (null). */
export const normalizeBarangay = (value) => (value === RHU_OPTION ? null : value || null);

/**
 * Filter options for a table/queue dropdown under PHN scope rules.
 *   - non-PHN roles   → ["All", ...three barangays] (unchanged behavior)
 *   - PHN             → ["All"]
 */
export const phnFilterOptions = (user) => {
  const scope = getPHNScope(user);
  if (!scope) return BARANGAY_FILTERS;
  return ["All"];
};

/** True when a visible row matches a selected dropdown option. */
export const rowMatchesOption = (row, option, user) => {
  if (!option || option === "All") return true;
  if (option === RHU_OPTION && isPHN(user)) return true;
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

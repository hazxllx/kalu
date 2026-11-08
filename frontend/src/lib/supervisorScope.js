import { ROLE } from "@/lib/roles";
import { BARANGAYS, isBarangay } from "@/lib/barangays";

/**
 * Centralized Health Supervisor (health_supervisor) data-scope rules.
 *
 * A Health Supervisor account carries a required barangay assignment
 * (`user.barangay` or `user.assignedBarangay`):
 *   - assigned to one barangay → barangay-level coverage ONLY
 *   - no valid assignment      -> no barangay data is rendered
 *
 * The same rules used by the PHN helpers apply BEFORE rendering, search and
 * counts so filters can never leak another barangay's data.
 */

const HS_SCOPE_BARANGAY = "barangay";
const HS_SCOPE_MUNICIPAL = "municipal";
const HS_SCOPE_UNASSIGNED = "unassigned";

export const getSupervisorScope = (user) => {
  if (!user || user.role !== ROLE.HEALTH_SUPERVISOR) return null;
  const assignedBarangay = String(user.barangay ?? user.assignedBarangay ?? "").trim();
  if (assignedBarangay && isBarangay(assignedBarangay)) {
    return { level: HS_SCOPE_BARANGAY, assignedBarangay };
  }
  return { level: HS_SCOPE_UNASSIGNED, assignedBarangay: null };
};

export const isHealthSupervisor = (user) => Boolean(user && user.role === ROLE.HEALTH_SUPERVISOR);

/** Coverage is an account assignment, never a municipality-wide fallback. */
export const supervisorCoverageLabel = (user) => {
  const scope = getSupervisorScope(user);
  if (!scope) return "Municipal";
  return scope.assignedBarangay || "Assignment unavailable";
};

/** Only the assigned barangay is available to a supervisor. */
export const supervisorVisibleBarangays = (user) => {
  const scope = getSupervisorScope(user);
  if (!isHealthSupervisor(user)) return [...BARANGAYS];
  return scope?.assignedBarangay ? [scope.assignedBarangay] : [];
};

/** True when a data row is visible to the Health Supervisor. */
export const isVisibleToSupervisor = (row, user) => {
  if (!isHealthSupervisor(user)) return true;
  const scope = getSupervisorScope(user);
  if (!scope?.assignedBarangay) return false;

  const brgy = row && isBarangay(row.barangay) ? row.barangay : null;
  if (!brgy) return false; // RHU-level rows belong to the RHU, not the barangay supervisor
  return brgy === scope.assignedBarangay;
};

/** Filter rows down to what the supervisor may see. */
export const filterSupervisorRows = (rows, user) =>
  Array.isArray(rows) ? rows.filter((row) => isVisibleToSupervisor(row, user)) : [];

export const HS_SCOPE = Object.freeze({
  BARANGAY: HS_SCOPE_BARANGAY,
  MUNICIPAL: HS_SCOPE_MUNICIPAL,
  UNASSIGNED: HS_SCOPE_UNASSIGNED,
});

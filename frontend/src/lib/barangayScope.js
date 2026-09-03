/**
 * Barangay data scope (frontend mirror of `backend/src/config/scope.js`).
 *
 * A Health Supervisor is assigned to exactly one barangay; their Early
 * Warning module and barangay-sensitive data are limited to it. The
 * assignment travels on the authenticated user — it is never a filter the
 * user can change. The API independently re-derives the scope from the
 * session on every request, so this constant only drives what is REQUESTED
 * and rendered, never what is allowed.
 */
import { ROLE } from "@/lib/roles";

const BARANGAY_SCOPED_ROLES = [ROLE.HEALTH_SUPERVISOR];

/**
 * The signed-in user's assigned barangay, or null for municipality-wide
 * roles (MHO, admin, PHN, ...).
 */
export const getAssignedBarangay = (user) => {
  if (!user?.role || !BARANGAY_SCOPED_ROLES.includes(user.role)) return null;
  const barangay = String(user.barangay ?? "").trim();
  return barangay || null;
};

export default { getAssignedBarangay };

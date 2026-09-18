/**
 * Barangay data-scope rules (single source of truth for the API).
 *
 * Some community roles are assigned to exactly ONE barangay — the Health
 * Supervisor and the Barangay Health Worker both work inside their own
 * barangay and must never see another barangay's records, even by changing
 * filters, URLs or record ids.
 *
 * The assignment is read from the authenticated session (`req.user.barangay`,
 * resolved from the `profiles` table by `authenticate` — or the signed dev
 * session in local development) — NEVER from a request parameter — and every
 * barangay-sensitive query filters on it in the service/repository layer.
 * The database RLS policies mirror the same rules.
 */

/** Roles whose data access is limited to their assigned barangay. */
export const BARANGAY_SCOPED_ROLES = Object.freeze(['health_supervisor', 'bhw']);

/**
 * The caller's assigned barangay, or null when the role is municipality-wide
 * (MHO, admin, PHN, ...). `user` is `req.user` as set by `authenticate`.
 */
export const assignedBarangay = (user) => {
  if (!user?.role) return null;
  if (!BARANGAY_SCOPED_ROLES.includes(user.role)) return null;
  const barangay = String(user.barangay ?? '').trim();
  return barangay || null;
};

export default { BARANGAY_SCOPED_ROLES, assignedBarangay };

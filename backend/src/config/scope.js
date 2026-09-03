/**
 * Barangay data-scope rules (single source of truth for the API).
 *
 * Some community roles are assigned to exactly ONE barangay — a Health
 * Supervisor works inside their own barangay and must never see another
 * barangay's records, even by changing filters, URLs or record ids.
 *
 * The assignment lives on the account (dev account field today; a
 * `profiles.barangay` column / Supabase `app_metadata.barangay` once the
 * verified database structure is connected). It is read from the
 * authenticated session — NEVER from a request parameter — and every
 * barangay-sensitive query filters on it in the service/repository layer.
 */

/** Roles whose data access is limited to their assigned barangay. */
export const BARANGAY_SCOPED_ROLES = Object.freeze(['health_supervisor']);

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

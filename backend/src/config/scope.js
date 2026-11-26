// backend/src/config/scope.js
/**
 * Barangay & RHU facility data-scope rules (single source of truth for the API).
 *
 * Architectural role: enforced across the `route -> authenticate -> authorize ->
 * controller -> service -> repository/Supabase` pipeline to isolate community
 * records by barangay and RHU records by assigned facility.
 *
 * Some community roles are assigned to exactly ONE barangay — the Health
 * Supervisor and the Barangay Health Worker both work inside their own
 * barangay and must never see another barangay's records, even by changing
 * filters, URLs or record ids. Likewise, `rhu_personnel` accounts are scoped
 * to their assigned RHU facility (`withinFacilityScope`).
 *
 * The assignment is read from the authenticated session (`req.user.barangay` /
 * `req.user.facilityId`, resolved from the `profiles` table by `authenticate`
 * — or the signed dev session in local development) — NEVER from a request
 * parameter — and every scoped query filters on it in the service/repository
 * layer. The database RLS policies mirror the same rules.
 */

/** Roles whose data access is limited to their assigned barangay. */
export const BARANGAY_SCOPED_ROLES = Object.freeze(['health_supervisor', 'bhw']);

/**
 * Return the caller's assigned barangay name when `user.role` is barangay-scoped
 * (`health_supervisor` or `bhw`), or `null` when the role operates at the
 * municipality/system level (`mho`, `phn`, `admin`, etc.).
 *
 * @param {Object} user - `req.user` populated by `authenticate`
 * @returns {string|null}
 */
export const assignedBarangay = (user) => {
  if (!user?.role) return null;
  if (!BARANGAY_SCOPED_ROLES.includes(user.role)) return null;
  const barangay = String(user.barangay ?? '').trim();
  return barangay || null;
};

/**
 * Verify whether `user` may access a record belonging to `facilityId`.
 *
 * Non-`rhu_personnel` roles return `true` here (their geographic scope is
 * governed either municipality-wide or via `assignedBarangay`). For
 * `rhu_personnel`, both `user.facilityId` and `facilityId` must be non-empty
 * and strictly equal — request payloads are never trusted as the source of
 * authorization.
 *
 * @param {Object} user - `req.user` populated by `authenticate`
 * @param {string} facilityId - Facility identifier stored on the target record
 * @returns {boolean}
 */
export const withinFacilityScope = (user, facilityId) => {
  if (user?.role !== 'rhu_personnel') return true;
  const assignedFacility = String(user.facilityId ?? '').trim();
  const recordFacility = String(facilityId ?? '').trim();
  return Boolean(assignedFacility && recordFacility && assignedFacility === recordFacility);
};

export default { BARANGAY_SCOPED_ROLES, assignedBarangay, withinFacilityScope };

/**
 * KALUSAGAP — canonical barangay allowlist bridge for the backend.
 *
 * Re-exports `APPROVED_BARANGAYS` (the 26 official barangays of Pili, Camarines
 * Sur) and `isApprovedBarangayName` from `shared/barangays.js` so backend
 * validators, controllers, services, and barangay-scope checks validate against
 * the exact same list used by the React frontend. Fits into the
 * `route -> authenticate -> authorize -> controller -> service -> repository/Supabase`
 * pipeline wherever static barangay name validation is required alongside the
 * database-backed `public.barangays` registry.
 */
export {
  APPROVED_BARANGAYS,
  isApprovedBarangayName,
} from '../../../shared/barangays.js';

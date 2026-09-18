import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';

/**
 * Profile service — the server-side source of truth for a user's application
 * role, account status and coverage assignment (the `profiles` table created
 * by database/migrations/20260915100000_create_core_org_and_profiles.sql).
 *
 * Everything here runs on the service-role client and is only called after the
 * caller's Supabase token has been verified. The client never supplies a role:
 * it is always read from the database.
 */

const PROFILE_SELECT = [
  'id',
  'email',
  'full_name',
  'role',
  'status',
  'municipality_id',
  'barangay_id',
  'facility_id',
  'position',
  'license_no',
  'contact',
  'barangay:barangays(name)',
  'municipality:municipalities(name)',
].join(',');

/**
 * Every column the session needs, WITHOUT embedded resources. Used as the
 * fallback read: role/status/coverage are all stored on the base `profiles`
 * row, so a PostgREST relationship-cache problem must never fail a sign-in.
 */
const PROFILE_BASE_SELECT = [
  'id',
  'email',
  'full_name',
  'role',
  'status',
  'municipality_id',
  'barangay_id',
  'facility_id',
  'position',
  'license_no',
  'contact',
].join(',');

/** The `profiles` table itself is missing (migrations not applied here). */
const isTableMissing = (error) => {
  const code = error?.code || '';
  const message = error?.message || '';
  return (
    code === 'PGRST205' ||
    /relation .+ does not exist/i.test(message) ||
    /could not find the table .+ in the schema cache/i.test(message)
  );
};

/** Only the embedded `barangays` / `municipalities` lookup is unavailable. */
const isEmbeddedResourceUnavailable = (error) => {
  const code = error?.code || '';
  const message = error?.message || '';
  return code === 'PGRST200' || /could not find a relationship/i.test(message);
};

/**
 * Load a user's profile.
 *
 * Returns { profile, unavailable, error }:
 *   profile      the profiles row (with joined barangay/municipality names when
 *                available), or null when the account genuinely has no row
 *   unavailable  true when the profile LAYER cannot be read at all (the table
 *                is missing or PostgREST has not loaded it yet) — callers must
 *                report a service problem, never "no profile"
 *   error        a database error that is neither of the above
 */
export const loadProfile = async (userId) => {
  const supabase = getServiceClient();

  const read = (select) =>
    supabase.from('profiles').select(select).eq('id', userId).maybeSingle();

  let { data, error } = await read(PROFILE_SELECT);

  // The embedded barangay/municipality names are a display convenience only.
  // If PostgREST cannot resolve those relationships, fall back to the base
  // row so the account still resolves (role, status and coverage ids intact).
  if (error && isEmbeddedResourceUnavailable(error)) {
    ({ data, error } = await read(PROFILE_BASE_SELECT));
  }

  // One retry on a transport-level failure so a dropped keep-alive
  // connection is not reported as a broken profile.
  if (error && /fetch failed|networkerror|timeout/i.test(String(error.message || ''))) {
    ({ data, error } = await read(PROFILE_SELECT));
    if (error && isEmbeddedResourceUnavailable(error)) {
      ({ data, error } = await read(PROFILE_BASE_SELECT));
    }
  }

  if (error) {
    if (isTableMissing(error)) return { profile: null, unavailable: true, error: null };
    return { profile: null, unavailable: false, error };
  }
  return { profile: data || null, unavailable: false, error: null };
};

/**
 * The application role an account is served under. A resident whose identity
 * has not been verified yet is served under the 'resident-limited' sub-state —
 * the same behavior as the frontend's resident onboarding flow.
 */
export const effectiveRole = (profile) => {
  if (!profile) return null;
  if (profile.status === 'pending_verification' && profile.role === 'resident') return 'resident-limited';
  return profile.role;
};

/** Staff roles require administrator activation before they can act. */
export const isStaffRole = (role) => role !== 'resident' && role !== 'resident-limited';

/** Map a profiles row to the session-user shape used across the API. */
export const profileToSessionUser = (profile) => ({
  id: profile.id,
  email: profile.email,
  name: profile.full_name || profile.email,
  role: effectiveRole(profile),
  status: profile.status,
  municipalityId: profile.municipality_id ?? null,
  municipality: profile.municipality?.name ?? null,
  barangayId: profile.barangay_id ?? null,
  barangay: profile.barangay?.name ?? null,
  facilityId: profile.facility_id ?? null,
  position: profile.position || '',
});

/**
 * Account-state gate shared by login and the authenticate middleware.
 * Throws an ApiError when the account must not be served.
 */
const assertAccountUsable = (profile) => {
  if (!profile) return;
  if (profile.status === 'disabled') {
    throw ApiError.forbidden('Your account has been disabled. Contact your administrator.');
  }
  if (isStaffRole(profile.role) && profile.status === 'pending_verification') {
    throw ApiError.forbidden('Your account is pending activation by an administrator.');
  }
};

/** Load the profile and enforce the account-state gate in one step. */
export const loadActiveProfile = async (userId) => {
  const result = await loadProfile(userId);
  if (result.error) return result;
  if (result.profile) assertAccountUsable(result.profile);
  return result;
};

export default { loadProfile, loadActiveProfile, effectiveRole, isStaffRole, profileToSessionUser };

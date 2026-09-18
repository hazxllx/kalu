import env from '../config/env.js';
import { getServiceClient } from '../config/supabase.js';
import { loadActiveProfile, profileToSessionUser } from '../services/profile.service.js';
import ApiError from '../utils/apiError.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Authentication middleware.
 *
 * Extracts the Bearer access token issued by Supabase Auth, verifies it with
 * Supabase, then resolves the caller's APPLICATION profile (role, status and
 * municipality/barangay/facility assignment) from the `profiles` table — the
 * single server-side source of truth. The client never supplies a role or a
 * scope; both are read from the database after the token is verified.
 *
 *   req.user = { id, email, name, role, status,
 *                municipalityId, municipality, barangayId, barangay,
 *                facilityId, accessToken }
 *
 * Account states:
 *   disabled                              -> 403 (account disabled)
 *   staff role + pending_verification     -> 403 (pending activation)
 *   resident + pending_verification       -> served as 'resident-limited'
 *
 * When Supabase is NOT configured the API reports 503 — accounts are managed
 * exclusively through Supabase Auth; there is no local/mock sign-in path.
 */
const extractToken = (req) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
};

export const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('Missing Bearer access token');

  if (!env.isSupabaseConfigured) {
    throw ApiError(503, 'Authentication is unavailable: Supabase is not configured on the server.');
  }

  const supabase = getServiceClient();

  // One retry on transient transport failures ("fetch failed" from a dropped
  // keep-alive connection) so a network blip never masquerades as an invalid
  // session; auth-level errors are returned as-is on the first attempt.
  const getUserWithRetry = async (accessToken) => {
    let lastResult;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      lastResult = await supabase.auth.getUser(accessToken);
      const transportFailure =
        lastResult.error && /fetch failed|networkerror/i.test(String(lastResult.error.message || ''));
      if (!transportFailure || attempt === 1) return lastResult;
    }
    return lastResult;
  };

  const { data, error } = await getUserWithRetry(token);

  if (error || !data?.user) {
    throw ApiError.unauthorized('Invalid or expired session');
  }

  const { user } = data;

  // Resolve the application profile. loadActiveProfile throws the 403s for
  // disabled / pending-activation accounts described above.
  const { profile, unavailable, error: profileError } = await loadActiveProfile(user.id);

  // A broken/absent profile LAYER is a service problem, not a missing account.
  // Reporting it as "no profile" would tell a correctly provisioned user to
  // contact an administrator about a row that already exists.
  if (profileError) {
    throw ApiError(503, 'Profile lookup failed. Please try again.');
  }
  if (unavailable) {
    throw ApiError(
      503,
      'The account profile service is temporarily unavailable. Please try again shortly.',
    );
  }

  if (!profile) {
    // Genuinely no row for this auth user: the account exists in Auth but was
    // never provisioned.
    throw ApiError.forbidden('Your account has no profile. Contact your administrator.');
  }

  const sessionUser = profileToSessionUser(profile);
  req.user = {
    id: user.id,
    email: sessionUser.email,
    name: sessionUser.name,
    role: sessionUser.role,
    status: sessionUser.status,
    municipalityId: sessionUser.municipalityId,
    municipality: sessionUser.municipality,
    barangayId: sessionUser.barangayId,
    // Barangay NAME — barangayScope middleware and the service-layer filters
    // compare against barangay names.
    barangay: sessionUser.barangay,
    facilityId: sessionUser.facilityId,
    accessToken: token,
    authMode: 'supabase',
  };
  return next();
});

export default authenticate;

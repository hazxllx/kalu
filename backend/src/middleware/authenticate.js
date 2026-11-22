import env from '../config/env.js';
import { getServiceClient } from '../config/supabase.js';
import { loadSessionProfile, profileToSessionUser } from '../services/profile.service.js';
import ApiError from '../utils/apiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { isApprovedBarangayName } from '../config/barangays.js';
import { AUTH_SERVICE_UNAVAILABLE_CODE, AUTH_SERVICE_UNAVAILABLE_MESSAGE, isAuthServiceUnavailable } from '../../../shared/authConnectivity.js';

/**
 * @module middleware/authenticate
 *
 * Primary authentication and session-hydration middleware for KALUSAGAP.
 * Position in request pipeline:
 *   `route -> authenticate -> authorize -> authorizeStation/barangayScope -> controller -> service -> repository/Supabase`
 *
 * Extracts the Bearer access token issued by Supabase Auth, verifies it with
 * Supabase, then resolves the caller's APPLICATION profile (role, status, and
 * municipality/barangay/facility/station assignment) from the `profiles` table —
 * the single server-side source of truth. The client never supplies a role or a
 * scope; both are read from the database after the token is verified.
 *
 * Populates `req.user`:
 *   `{ id, email, name, role, status, mustChangePassword, municipalityId, municipality, barangayId, barangay, facilityId, rhuStations, accessToken, authMode }`
 *
 * Account & credential states:
 *   - `disabled`                          -> 403 (account disabled in `loadSessionProfile`)
 *   - staff role + `pending_verification` -> 403 (pending verification)
 *   - resident + `pending_verification`   -> served as `'resident-limited'`
 *   - expired temporary password          -> 403 (`TEMPORARY_PASSWORD_EXPIRED`)
 *   - active temporary password           -> 403 (`PASSWORD_CHANGE_REQUIRED`) on all routes
 *                                            except `GET /api/auth/me` and `POST /api/auth/logout`
 *
 * When Supabase is NOT configured the API reports 503 — accounts are managed
 * exclusively through Supabase Auth; there is no local/mock sign-in path.
 */

/**
 * Extracts the raw JWT string from an HTTP `Authorization: Bearer <token>` header.
 *
 * @param {Object} req - Express request object.
 * @returns {string|null} Trimmed Bearer token, or `null` when absent/malformed.
 */
const extractToken = (req) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
};

/**
 * Verifies the caller's Supabase session, loads their authoritative application
 * profile, enforces barangay assignment integrity for barangay-scoped staff,
 * checks temporary-password lifecycle constraints, and attaches `req.user`.
 */
export const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('Missing Bearer access token');

  if (!env.isSupabaseConfigured) {
    throw new ApiError(503, 'Authentication is unavailable: Supabase is not configured on the server.');
  }

  const supabase = getServiceClient();

  // One retry on transient transport failures ("fetch failed" from a dropped
  // keep-alive connection) so a network blip never masquerades as an invalid
  // session; auth-level errors are returned as-is on the first attempt.
  const getUserWithRetry = async (accessToken) => {
    let lastResult;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        lastResult = await supabase.auth.getUser(accessToken);
      } catch (error) {
        if (attempt === 0 && isAuthServiceUnavailable(error)) continue;
        throw error;
      }
      const transportFailure = isAuthServiceUnavailable(lastResult.error);
      if (!transportFailure || attempt === 1) return lastResult;
    }
    return lastResult;
  };

  let verification;
  try {
    verification = await getUserWithRetry(token);
  } catch (error) {
    if (isAuthServiceUnavailable(error)) throw new ApiError(503, AUTH_SERVICE_UNAVAILABLE_MESSAGE).withCode(AUTH_SERVICE_UNAVAILABLE_CODE);
    throw error;
  }
  const { data, error } = verification;
  if (isAuthServiceUnavailable(error)) throw new ApiError(503, AUTH_SERVICE_UNAVAILABLE_MESSAGE).withCode(AUTH_SERVICE_UNAVAILABLE_CODE);
  if (error?.status === 429) throw ApiError.tooManyRequests('Session verification is rate limited. Please wait and try again.');

  if (!error && !data?.user) throw new ApiError(503, 'The authentication service did not return a verified user. Please try again.');
  if (error) {
    throw ApiError.unauthorized('Invalid or expired session');
  }

  const { user } = data;

  // Temporary-password sessions may resolve their profile for the password
  // challenge only. Every other account still passes the normal state gate.
  const { profile, unavailable, error: profileError, passwordStatus } = await loadSessionProfile(user.id);

  // A broken/absent profile LAYER is a service problem, not a missing account.
  // Reporting it as "no profile" would tell a correctly provisioned user to
  // contact an administrator about a row that already exists.
  if (profileError) {
    throw new ApiError(503, 'Profile lookup failed. Please try again.');
  }
  if (unavailable) {
    throw new ApiError(
      503,
      'The account profile service is temporarily unavailable. Please try again shortly.',
    );
  }

  if (!profile) {
    // Genuinely no row for this auth user: the account exists in Auth but was
    // never provisioned.
    throw ApiError.forbidden('Your account has no profile. Contact your administrator.');
  }

  const mustChangePassword = passwordStatus?.mustChangePassword === true;
  const sessionUser = { ...profileToSessionUser(profile), mustChangePassword };
  // An Auth/profile row is not proof that resident onboarding is complete.
  // Only a linked residents row represents a complete registration. Separate
  // this state from resident-limited, which means submitted/awaiting verification.
  if (sessionUser.role === 'resident' || sessionUser.role === 'resident-limited') {
    const { data: residentRow, error: residentError } = await getServiceClient()
      .from('residents')
      .select('id,verification_status')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (residentError) {
      throw ApiError.forbidden('Your resident registration status could not be verified. Please try again.');
    }
    if (!residentRow) {
      sessionUser.role = 'resident-incomplete';
      sessionUser.status = 'incomplete_registration';
    }
  }

  // Barangay-scoped staff roles (Health Supervisor and BHW) must hold an active,
  // approved barangay linked to their assigned municipality before accessing any endpoint.
  if (['health_supervisor', 'bhw'].includes(sessionUser.role)) {
    const assignment = profile.barangay;
    const validAssignment = Boolean(
      sessionUser.barangayId &&
      sessionUser.municipalityId &&
      assignment &&
      assignment.id === sessionUser.barangayId &&
      assignment.status === 'Active' &&
      assignment.municipality_id === sessionUser.municipalityId &&
      isApprovedBarangayName(assignment.name),
    );
    if (!validAssignment) {
      throw ApiError.forbidden(
        'Your account is missing an active approved barangay assignment in its municipality. Contact your administrator to update your profile.',
      );
    }
  }
  req.user = {
    id: user.id,
    email: sessionUser.email,
    name: sessionUser.name,
    role: sessionUser.role,
    status: sessionUser.status,
    mustChangePassword,
    municipalityId: sessionUser.municipalityId,
    municipality: sessionUser.municipality,
    barangayId: sessionUser.barangayId,
    // Barangay NAME — barangayScope middleware and the service-layer filters
    // compare against barangay names.
    barangay: sessionUser.barangay,
    facilityId: sessionUser.facilityId,
    // RHU station assignment(s) — drives station-based authorization
    // (authorizeStation middleware + service re-checks). Resolved from the
    // profiles.rhu_stations column, never from client input.
    rhuStations: sessionUser.rhuStations,
    accessToken: token,
    authMode: 'supabase',
  };

  // Block expired temporary passwords immediately; for active temporary passwords,
  // restrict the session exclusively to bootstrap (`/api/auth/me`) and sign-out
  // (`/api/auth/logout`) until a permanent password is set.
  if (passwordStatus?.temporaryPasswordExpired) {
    throw ApiError.forbidden('This temporary password has expired. Contact your administrator for a new one.')
      .withCode('TEMPORARY_PASSWORD_EXPIRED');
  }
  if (mustChangePassword) {
    const path = String(req.originalUrl || '').split('?')[0];
    const allowedChallengeOperation = (req.method === 'GET' && path === '/api/auth/me')
      || (req.method === 'POST' && path === '/api/auth/logout');
    if (!allowedChallengeOperation) {
      throw ApiError.forbidden('Create a permanent password before accessing KALUSAGAP.').withCode('PASSWORD_CHANGE_REQUIRED');
    }
  }
  return next();
});

export default authenticate;

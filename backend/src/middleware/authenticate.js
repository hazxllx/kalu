import env from '../config/env.js';
import { getServiceClient } from '../config/supabase.js';
import { verifyDevToken } from '../utils/devSession.js';
import ApiError from '../utils/apiError.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Authentication middleware.
 *
 * Extracts the Bearer access token issued by Supabase Auth, verifies it with
 * Supabase, and attaches the resolved user to `req.user`:
 *
 *   req.user = { id, email, role, accessToken }
 *
 * The application role is read from the Supabase Auth user metadata
 * (`app_metadata.role`, falling back to `user_metadata.role`). Once the
 * verified database structure exists, this is the single place to switch to
 * reading the role from a `profiles` table instead.
 *
 * A request without a valid token is rejected with 401 before reaching any
 * controller — so the API cannot be called anonymously, regardless of what the
 * frontend does.
 *
 * When Supabase is NOT configured and the server is in a non-production
 * environment, a signed development token (see `utils/devSession.js`) is
 * accepted instead so the workflow can run fully local. In production, or as
 * soon as Supabase credentials exist, only real Supabase tokens pass.
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
    if (!env.isDevAuthEnabled) {
      throw new ApiError(503, 'Authentication is unavailable: Supabase is not configured on the server.');
    }
    const payload = verifyDevToken(token);
    if (!payload?.sub || !payload?.role) {
      throw ApiError.unauthorized('Invalid or expired session');
    }
    req.user = {
      id: payload.sub,
      email: payload.email || '',
      role: payload.role,
      accessToken: token,
      authMode: 'dev',
    };
    return next();
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    throw ApiError.unauthorized('Invalid or expired session');
  }

  const { user } = data;
  const role = user.app_metadata?.role || user.user_metadata?.role || null;

  req.user = {
    id: user.id,
    email: user.email,
    role,
    accessToken: token,
    authMode: 'supabase',
  };

  next();
});

export default authenticate;

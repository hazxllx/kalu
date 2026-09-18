import { getServiceClient } from '../config/supabase.js';
import { loadActiveProfile, profileToSessionUser } from './profile.service.js';
import ApiError from '../utils/apiError.js';

/**
 * Authentication business logic (Supabase Auth + profiles).
 *
 * The frontend can either talk to Supabase Auth directly (current default, via
 * `@/lib/supabase`) or through these endpoints. Either way the role, account
 * status and coverage assignment are resolved from the `profiles` table —
 * never chosen by the client.
 */

const metadataUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.email,
  role: user.app_metadata?.role || user.user_metadata?.role || null,
  status: null,
});

export const signIn = async ({ email, password }) => {
  if (!email || !password) throw ApiError.badRequest('Email and password are required');

  const supabase = getServiceClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data?.session) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  // Resolve the application profile. When the account-state gate rejects the
  // account, revoke the freshly issued session before surfacing the error so
  // no usable token is left behind.
  let profileResult;
  try {
    profileResult = await loadActiveProfile(data.user.id);
  } catch (err) {
    try {
      await supabase.auth.admin.signOut(data.session.access_token);
    } catch {
      /* best-effort revocation */
    }
    throw err;
  }

  const { profile, unavailable } = profileResult;
  const user = profile ? profileToSessionUser(profile) : metadataUser(data.user);

  return {
    user,
    profileResolved: !unavailable && Boolean(profile),
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
    },
  };
};

export const getCurrentUser = async (accessToken) => {
  const supabase = getServiceClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) throw ApiError.unauthorized('Invalid or expired session');

  // Profile is the source of truth; metadata is the pre-migration fallback.
  const { profile } = await loadActiveProfile(data.user.id);
  return profile ? profileToSessionUser(profile) : metadataUser(data.user);
};

export const signOut = async (accessToken) => {
  const supabase = getServiceClient();
  // Best-effort: revoke the caller's session. Ignore token-shape errors so a
  // logout always succeeds from the client's perspective.
  try {
    await supabase.auth.admin.signOut(accessToken);
  } catch {
    /* no-op */
  }
  return { success: true };
};

export default { signIn, getCurrentUser, signOut };

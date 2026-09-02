import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';

/**
 * Authentication business logic (Supabase Auth).
 *
 * The frontend can either talk to Supabase Auth directly (current default, via
 * `@/lib/supabase`) or through these endpoints. Either way, the *role* is
 * derived from the authenticated account — never chosen by the client.
 *
 * These functions call real Supabase Auth. They do NOT touch application tables
 * yet, so they do not depend on the unverified ERD.
 */

const toSessionUser = (user) => ({
  id: user.id,
  email: user.email,
  role: user.app_metadata?.role || user.user_metadata?.role || null,
});

export const signIn = async ({ email, password }) => {
  if (!email || !password) throw ApiError.badRequest('Email and password are required');

  const supabase = getServiceClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data?.session) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  return {
    user: toSessionUser(data.user),
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
  return toSessionUser(data.user);
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

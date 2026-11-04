import { getServiceClient, createAuthClient } from '../config/supabase.js';
import { loadActiveProfile, profileToSessionUser } from './profile.service.js';
import ApiError from '../utils/apiError.js';
import repository from '../repositories/supabaseRepository.js';
import { personnelPasswordSetupValidator } from '../validators/auth.validators.js';
import { AUTH_SERVICE_UNAVAILABLE_CODE, AUTH_SERVICE_UNAVAILABLE_MESSAGE, isAuthServiceUnavailable } from '../../../shared/authConnectivity.js';

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

  // Use an isolated, throwaway auth client for the password grant. signInWith
  // Password sets the client's Authorization header to the signed-in user's
  // JWT, so it must NEVER run on the shared service-role singleton (that is
  // BUG-001: one login corrupting every other request's auth context). This
  // instance is discarded when signIn returns; no user JWT is stored globally.
  const authClient = createAuthClient();
  let result;
  try {
    result = await authClient.auth.signInWithPassword({ email, password });
  } catch (error) {
    if (isAuthServiceUnavailable(error)) throw new ApiError(503, AUTH_SERVICE_UNAVAILABLE_MESSAGE, { code: AUTH_SERVICE_UNAVAILABLE_CODE });
    throw error;
  }
  const { data, error } = result;

  if (error || !data?.session) {
    if (isAuthServiceUnavailable(error)) throw new ApiError(503, AUTH_SERVICE_UNAVAILABLE_MESSAGE, { code: AUTH_SERVICE_UNAVAILABLE_CODE });
    if (error?.status === 429) throw ApiError.tooManyRequests('Too many sign-in attempts. Please wait and try again.');
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
      // Revocation uses the service-role admin API (never the anon auth
      // client). admin.signOut authenticates with the service-role key and does
      // not mutate the client's session, so it is safe on the singleton.
      await getServiceClient().auth.admin.signOut(data.session.access_token);
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
  let result;
  try {
    result = await supabase.auth.getUser(accessToken);
  } catch (error) {
    if (isAuthServiceUnavailable(error)) throw new ApiError(503, AUTH_SERVICE_UNAVAILABLE_MESSAGE, { code: AUTH_SERVICE_UNAVAILABLE_CODE });
    throw error;
  }
  const { data, error } = result;
  if (isAuthServiceUnavailable(error)) throw new ApiError(503, AUTH_SERVICE_UNAVAILABLE_MESSAGE, { code: AUTH_SERVICE_UNAVAILABLE_CODE });
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

const verifySetupOwner = async (accessToken) => {
  if (!accessToken) throw ApiError.unauthorized('Missing Bearer access token');
  let result;
  try {
    result = await getServiceClient().auth.getUser(accessToken);
  } catch {
    throw new ApiError(503, 'Session verification is unavailable. Please try again shortly.');
  }
  if (result.error?.status === 0 || result.error?.status >= 500) {
    throw new ApiError(503, 'Session verification is unavailable. Please try again shortly.');
  }
  if (result.error || !result.data?.user?.id) throw ApiError.unauthorized('Invalid or expired session');
  return result.data.user;
};

const setupStatus = (account) => ({
  setupRequired: account?.setupRequired === true,
  approvalStatus: account?.approvalStatus ?? null,
  activationRequested: account?.activationRequested === true,
  suspended: Boolean(account?.suspendedAt),
  active: account?.status === 'active',
});

const loadSetupAccount = async (owner) => {
  const account = await repository.getPersonnelSetupAccount(owner.id);
  if (owner.app_metadata?.personnel_managed === true && (!account || account.lifecycleVersion === null)) {
    throw new ApiError(503, 'Personnel account provisioning is not complete. Contact your system administrator before setting a password.');
  }
  return account;
};

export const getPersonnelSetupStatus = async ({ accessToken } = {}) => {
  const owner = await verifySetupOwner(accessToken);
  return setupStatus(await loadSetupAccount(owner));
};

export const setupPersonnelPassword = async ({ accessToken, password } = {}) => {
  const validation = personnelPasswordSetupValidator({ password });
  if (validation.error) throw ApiError.badRequest('Validation failed', validation.error);
  const owner = await verifySetupOwner(accessToken);
  const account = await loadSetupAccount(owner);
  if (!account || account.lifecycleVersion === null || !account.setupRequired) {
    throw ApiError.conflict('This account does not require personnel password setup.');
  }
  if (!owner.email_confirmed_at) throw ApiError.forbidden('Confirm your email using your invitation before setting your password.');
  if (account.approvalStatus !== 'approved' || account.suspendedAt) {
    throw ApiError.forbidden('Password setup requires an approved account that is not suspended.');
  }
  let result;
  try {
    result = await getServiceClient().auth.admin.updateUserById(owner.id, { password: validation.value.password });
  } catch {
    throw new ApiError(503, 'The password change could not be confirmed. Please retry without signing out.');
  }
  if (result.error || result.data?.user?.id !== owner.id) {
    throw new ApiError(503, 'The password change could not be confirmed. Please retry without signing out.');
  }
  try {
    const completed = await repository.completePersonnelAccountSetup(owner.id);
    if (!completed || completed.setupRequired || completed.lifecycleVersion === null) throw new Error('Setup was not confirmed');
    return { passwordSaved: true, setupComplete: true, ...setupStatus(completed) };
  } catch {
    // Auth succeeded before SQL. Never report a password failure or active
    // access when the final setup transaction has not been confirmed.
    return {
      passwordSaved: true,
      setupComplete: false,
      ...setupStatus(account),
      active: false,
      message: 'Your password was saved, but account setup could not be completed or confirmed. Refresh setup status or retry before signing out. Access still requires confirmed setup and administrator activation.',
    };
  }
};

export default { signIn, getCurrentUser, signOut, getPersonnelSetupStatus, setupPersonnelPassword };

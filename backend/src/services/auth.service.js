// backend/src/services/auth.service.js
import { getServiceClient, createAuthClient } from '../config/supabase.js';
import { loadSessionProfile, profileToSessionUser } from './profile.service.js';
import ApiError from '../utils/apiError.js';
import repository from '../repositories/supabaseRepository.js';
import { personnelPasswordSetupValidator } from '../validators/auth.validators.js';
import { AUTH_SERVICE_UNAVAILABLE_CODE, AUTH_SERVICE_UNAVAILABLE_MESSAGE, isAuthServiceUnavailable } from '../../../shared/authConnectivity.js';
import env from '../config/env.js';
import { authRedirectUrl, passwordRecoveryUrl } from '../config/clientUrl.js';
import { getSmtpFailureDetails, sendPasswordResetEmail, sendPasswordSetupEmail } from './email.service.js';
import {
  digestInvitationRecoverySecret,
  digestInvitationRecoveryPassword,
  digestTemporaryPasswordChange,
} from '../utils/personnelInvitationRecovery.js';

/**
 * Authentication & Personnel Credential Lifecycle Service (`services/auth.service.js`).
 *
 * Fits into KALUSAGAP's authentication pipeline:
 *   `auth.routes -> (rateLimit / authenticate) -> auth.controller -> auth.service -> Supabase Auth + public.profiles + personnel lifecycle repository`
 *
 * Responsibilities & security invariants:
 * - Password sign-in (`signIn`) executes on a disposable `createAuthClient()` instance
 *   so user JWTs never pollute the shared service-role singleton, immediately revoking
 *   issued tokens via `auth.admin.signOut` if profile gates or temporary-password expiry fail.
 * - Authoritative role, approval status, and barangay/municipality coverage are always
 *   resolved from `public.profiles` (`loadSessionProfile`) — never trusted from client claims.
 * - Password recovery (`requestPasswordReset`) prevents account enumeration by returning
 *   `{ accepted: true }` for unknown/ineligible emails while routing unconfirmed approved
 *   staff accounts to a fresh `invite` setup link instead of a dead `recovery` token.
 * - Enforces two-phase confirmation for initial personnel password setup and temporary
 *   password rotation (`auth.admin.updateUserById` + repository lifecycle state transition).
 */

/**
 * Fallback session user projection constructed from Supabase Auth metadata when
 * a `public.profiles` row is not yet available (pre-migration fallback).
 *
 * @param {Object} user - Supabase `auth.users` object
 * @returns {Object} Minimal session user descriptor
 */
const metadataUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.email,
  role: user.app_metadata?.role || user.user_metadata?.role || null,
  status: null,
});

const residentRegistrationProjection = async (profileUser) => {
  if (!profileUser || !['resident', 'resident-limited'].includes(profileUser.role)) {
    return profileUser;
  }
  const resident = await repository.getResidentByAuthUserId(profileUser.id);
  if (!resident) {
    return {
      ...profileUser,
      role: 'resident-limited',
      status: 'incomplete_registration',
      registrationStatus: 'incomplete',
      residentId: null,
      verificationStatus: null,
    };
  }
  return {
    ...profileUser,
    registrationStatus: 'complete',
    residentId: resident.residentId || resident.id,
    verificationStatus: resident.verificationStatus || 'pending',
  };
};

/**
 * Authenticate a user with email and password against Supabase Auth and enforce
 * KALUSAGAP's profile approval, suspension, and temporary-password expiry gates.
 *
 * @param {Object} credentials - Login credentials
 * @param {string} credentials.email - User email address
 * @param {string} credentials.password - Plaintext password
 * @returns {Promise<Object>} Resolved `{ user, profileResolved, session }` payload
 * @throws {ApiError} `400` missing fields, `401` invalid credentials or expired temp password, `429` rate limit, `503` upstream outage
 */
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
    profileResult = await loadSessionProfile(data.user.id);
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

  const { profile, unavailable, error: profileError, passwordStatus } = profileResult;
  if (profileError) throw new ApiError(503, 'Profile lookup failed. Please try again.');
  if (unavailable) throw new ApiError(503, 'The account profile service is temporarily unavailable. Please try again shortly.');
  if (passwordStatus?.temporaryPasswordExpired) {
    try { await getServiceClient().auth.admin.signOut(data.session.access_token); } catch { /* best-effort revocation */ }
    throw ApiError.unauthorized('This temporary password has expired. Contact your administrator for a new one.');
  }
  const baseUser = profile
    ? { ...profileToSessionUser(profile), mustChangePassword: passwordStatus?.mustChangePassword === true }
    : metadataUser(data.user);
  const user = await residentRegistrationProjection(baseUser);

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

/**
 * Verify a Bearer JWT against Supabase Auth and resolve the caller's current
 * authoritative session user from `public.profiles`.
 *
 * Rejects expired temporary passwords with `403 Forbidden` and maps upstream
 * Supabase connectivity failures to `503 Service Unavailable`.
 *
 * @param {string} accessToken - Supabase JWT access token
 * @returns {Promise<Object>} Session user object with `mustChangePassword` flag
 */
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
  const { profile, unavailable, error: profileError, passwordStatus } = await loadSessionProfile(data.user.id);
  if (profileError) throw new ApiError(503, 'Profile lookup failed. Please try again.');
  if (unavailable) throw new ApiError(503, 'The account profile service is temporarily unavailable. Please try again shortly.');
  if (passwordStatus?.temporaryPasswordExpired) {
    throw ApiError.forbidden('This temporary password has expired. Contact your administrator for a new one.');
  }
  const baseUser = profile
    ? { ...profileToSessionUser(profile), mustChangePassword: passwordStatus?.mustChangePassword === true }
    : metadataUser(data.user);
  return residentRegistrationProjection(baseUser);
};

/**
 * Revoke the caller's Supabase session via the service-role Admin API.
 * Swallows token/revocation errors so client logout is idempotent and always succeeds.
 *
 * @param {string} accessToken - Bearer access token to revoke
 * @returns {Promise<Object>} `{ success: true }`
 */
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

/**
 * Initiate password recovery (or resend an initial staff setup link) via KALUSAGAP's
 * backend SMTP mailer without disclosing whether the email is registered.
 *
 * Security & workflow rules:
 * - Unknown, mismatched, suspended, or unapproved emails silently return `{ accepted: true }`
 *   to prevent user enumeration.
 * - Unconfirmed (`!email_confirmed_at`) approved staff accounts with `setupRequired === true`
 *   receive an `'invite'` link via `sendPasswordSetupEmail` so expired/consumed setup links
 *   can be self-recovered through Forgot Password.
 * - Confirmed accounts receive a `'recovery'` link via `sendPasswordResetEmail` targeting
 *   `${frontendOrigin}/reset-password?token_hash=...&type=...`.
 *
 * @param {Object} [options] - Request payload
 * @param {string} [options.email] - Submitted email address
 * @returns {Promise<Object>} `{ accepted: true }`
 */
export const requestPasswordReset = async ({ email } = {}) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const supabase = getServiceClient();
  let profileResult;
  try {
    profileResult = await supabase.from('profiles').select('id,email,role')
      .eq('email', normalizedEmail).maybeSingle();
  } catch {
    throw new ApiError(503, 'The reset email could not be sent right now. Please try again shortly.');
  }
  if (profileResult.error) throw new ApiError(503, 'The reset email could not be sent right now. Please try again shortly.');
  const profile = profileResult.data;
  if (!profile?.id || !profile.email) return { accepted: true };

  let authResult;
  try {
    authResult = await supabase.auth.admin.getUserById(profile.id);
  } catch {
    throw new ApiError(503, 'The reset email could not be sent right now. Please try again shortly.');
  }
  const authUser = authResult?.data?.user;
  if (authResult?.error) throw new ApiError(503, 'The reset email could not be sent right now. Please try again shortly.');
  if (!authUser?.id || authUser.id !== profile.id || !authUser.email
    || authUser.email.trim().toLowerCase() !== normalizedEmail) {
    return { accepted: true };
  }

  let personnelAccount = null;
  if (['admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw'].includes(profile.role)) {
    try { personnelAccount = await repository.getPersonnelSetupAccount(profile.id); }
    catch { throw new ApiError(503, 'The reset email could not be sent right now. Please try again shortly.'); }
    if (personnelAccount?.mustChangePassword === true) return { accepted: true };
  }

  let actionType = 'recovery';
  let isInitialPersonnelSetup = false;
  if (!authUser.email_confirmed_at) {
    // An unconfirmed, approved staff account cannot use a recovery token yet.
    // Let the same Forgot Password form request a fresh invitation token
    // instead of silently returning success while leaving the user with an
    // old/consumed setup link. Other unconfirmed accounts remain undisclosed.
    if (!['admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw'].includes(profile.role)) {
      return { accepted: true };
    }
    const account = personnelAccount;
    if (account?.setupRequired !== true || account.approvalStatus !== 'approved' || account.suspendedAt) {
      return { accepted: true };
    }
    actionType = 'invite';
    isInitialPersonnelSetup = true;
  }

  let redirectTo;
  try { redirectTo = authRedirectUrl(env.clientUrl, '/reset-password', { nodeEnv: env.nodeEnv }); }
  catch { throw new ApiError(503, 'The reset email could not be sent right now. Please try again shortly.'); }
  let generated;
  try {
    generated = await supabase.auth.admin.generateLink({
      type: actionType, email: authUser.email, options: { redirectTo },
    });
  } catch {
    throw new ApiError(503, 'The reset email could not be sent right now. Please try again shortly.');
  }
  const tokenHash = generated?.data?.properties?.hashed_token;
  if (generated?.error || generated?.data?.user?.id !== authUser.id
    || typeof tokenHash !== 'string' || tokenHash.length < 16 || tokenHash.length > 2048) {
    throw new ApiError(503, 'The reset email could not be sent right now. Please try again shortly.');
  }

  const resetUrl = passwordRecoveryUrl(env.clientUrl, tokenHash, actionType, { nodeEnv: env.nodeEnv });
  try {
    if (isInitialPersonnelSetup) await sendPasswordSetupEmail({ email: authUser.email, setupUrl: resetUrl });
    else await sendPasswordResetEmail({ email: authUser.email, resetUrl });
  } catch (error) {
    console.error('smtp_email_delivery_failed', {
      operation: isInitialPersonnelSetup ? 'personnel_password_setup' : 'password_reset',
      ...getSmtpFailureDetails(error),
    });
    throw new ApiError(503, 'The reset email could not be sent right now. Please try again shortly.');
  }
  return { accepted: true };
};

/**
 * Validate a Bearer JWT for personnel password-setup/rotation endpoints using
 * `supabase.auth.getUser`, mapping upstream 5xx/network errors to `503`.
 *
 * @param {string} accessToken - Bearer access token from `Authorization` header
 * @returns {Promise<Object>} Verified Supabase `auth.users` record
 */
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

/** Project raw personnel lifecycle repository fields into a client-safe setup status summary. */
const setupStatus = (account) => ({
  setupRequired: account?.setupRequired === true,
  mustChangePassword: account?.mustChangePassword === true,
  temporaryPasswordExpired: account?.mustChangePassword === true
    && Boolean(account.temporaryPasswordExpiresAt)
    && Date.parse(account.temporaryPasswordExpiresAt) <= Date.now(),
  approvalStatus: account?.approvalStatus ?? null,
  activationRequested: account?.activationRequested === true,
  suspended: Boolean(account?.suspendedAt),
  active: account?.status === 'active',
  temporaryPasswordAssignedAt: account?.temporaryPasswordAssignedAt ?? null,
  passwordChangedAt: account?.passwordChangedAt ?? null,
});

const waitForCredentialCutoff = async (account) => {
  const cutoff = Number(account?.credentialValidAfter);
  if (!Number.isFinite(cutoff) || cutoff <= 0) return;
  const delay = Math.min(1000, Math.max(0, cutoff * 1000 - Date.now()));
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
};

const accessTokenClaims = (accessToken) => {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch { return null; }
};

/**
 * Load the personnel lifecycle row for `owner.id`, rejecting half-provisioned
 * `personnel_managed` accounts (`lifecycleVersion === null`) with `503`.
 */
const loadSetupAccount = async (owner) => {
  const account = await repository.getPersonnelSetupAccount(owner.id);
  if (owner.app_metadata?.personnel_managed === true && (!account || account.lifecycleVersion === null)) {
    throw new ApiError(503, 'Personnel account provisioning is not complete. Contact your system administrator before setting a password.');
  }
  return account;
};

/**
 * Return the authenticated personnel user's current password-setup and lifecycle status.
 *
 * @param {Object} [options] - Request context
 * @param {string} [options.accessToken] - Caller's Bearer access token
 * @returns {Promise<Object>} Normalized setup/lifecycle status flags
 */
export const getPersonnelSetupStatus = async ({ accessToken } = {}) => {
  const owner = await verifySetupOwner(accessToken);
  const account = await loadSetupAccount(owner);
  if (Number(account?.credentialValidAfter) > 0) {
    const claims = accessTokenClaims(accessToken);
    if (claims?.sub !== owner.id || !Number.isSafeInteger(claims.iat)
      || claims.iat < Number(account.credentialValidAfter)) {
      throw ApiError.unauthorized('This personnel session is no longer current. Sign in again.');
    }
  }
  return setupStatus(account);
};

/**
 * Complete initial password setup for an invited, approved, email-confirmed staff account.
 *
 * Two-phase commit safety:
 * 1. Updates the password in Supabase Auth via `auth.admin.updateUserById`.
 * 2. Marks setup complete in PostgreSQL via `repository.completePersonnelAccountSetup`.
 * If step 1 succeeds but step 2 fails, returns `{ passwordSaved: true, setupComplete: false, active: false }`
 * rather than throwing a false password failure or prematurely granting active access.
 *
 * @param {Object} [options] - Setup payload
 * @param {string} [options.accessToken] - Caller's Bearer access token
 * @param {string} [options.password] - New permanent password (validated via `personnelPasswordSetupValidator`)
 * @returns {Promise<Object>} Setup completion status payload
 */
export const setupPersonnelPassword = async ({ accessToken, password, recoverySecret } = {}) => {
  const validation = personnelPasswordSetupValidator({ password, ...(recoverySecret === undefined ? {} : { recoverySecret }) });
  if (validation.error) throw ApiError.badRequest('Validation failed', validation.error);
  let owner;
  let tokenDigest = null;
  try {
    owner = await verifySetupOwner(accessToken);
  } catch (error) {
    if (error.statusCode !== 401 || !recoverySecret) throw error;
    try { tokenDigest = digestInvitationRecoverySecret(recoverySecret); }
    catch { throw ApiError.forbidden('The invitation recovery proof is invalid or expired.'); }
    let accountId;
    try { accountId = await repository.getPersonnelInvitationRecoveryOwner(tokenDigest); }
    catch { throw new ApiError(503, 'Invitation recovery could not be verified.'); }
    if (!accountId) throw ApiError.forbidden('The invitation recovery proof is invalid, expired, or already used.');
    let recoveryUser;
    try { recoveryUser = await getServiceClient().auth.admin.getUserById(accountId); }
    catch { throw new ApiError(503, 'The invitation recovery account could not be verified.'); }
    owner = recoveryUser?.data?.user;
    if (recoveryUser?.error || owner?.id !== accountId || !owner.email_confirmed_at) {
      throw ApiError.forbidden('The invitation recovery proof is invalid, expired, or already used.');
    }
  }
  const account = await loadSetupAccount(owner);
  if (!account || account.lifecycleVersion === null || !account.setupRequired) {
    throw ApiError.conflict('This account does not require personnel password setup.');
  }
  if (!owner.email_confirmed_at) throw ApiError.forbidden('Confirm your email using your invitation before setting your password.');
  if (account.approvalStatus !== 'approved' || account.suspendedAt) {
    throw ApiError.forbidden('Password setup requires an approved account that is not suspended.');
  }
  if (typeof owner.email !== 'string' || owner.email.trim().toLowerCase() !== account.email?.trim().toLowerCase()) {
    throw ApiError.forbidden('The verified Auth identity does not match the personnel account.');
  }
  let recovery = null;
  if (account.mustChangePassword) {
    if (!recoverySecret) throw ApiError.forbidden('A valid administrator invitation is required to replace an expired temporary password.');
    if (!tokenDigest) {
      try { tokenDigest = digestInvitationRecoverySecret(recoverySecret); }
      catch { throw ApiError.forbidden('The invitation recovery proof is invalid or expired.'); }
    }
    let passwordDigest;
    try {
      passwordDigest = digestInvitationRecoveryPassword(owner.id, tokenDigest, validation.value.password, env.supabaseServiceRoleKey);
    } catch {
      throw new ApiError(503, 'Invitation recovery is temporarily unavailable. Contact an administrator to retry.');
    }
    try {
      recovery = await repository.beginPersonnelInvitationRecovery({ id: owner.id, tokenDigest, passwordDigest });
    } catch {
      throw new ApiError(503, 'Invitation recovery could not be verified. Request a fresh invitation and retry.');
    }
    if (!recovery) throw ApiError.forbidden('The invitation recovery proof is invalid, expired, or already used. Request a new invitation.');
  } else if (recoverySecret !== undefined) {
    throw ApiError.forbidden('The invitation recovery proof does not match an outstanding password setup.');
  }
  let result;
  try {
    result = recovery
      ? await getServiceClient().auth.admin.updateUserById(owner.id, { password: validation.value.password })
      : await repository.updatePersonnelOwnPassword({ accessToken, password: validation.value.password });
  } catch {
    throw new ApiError(503, 'The password change could not be confirmed. Please retry without signing out.');
  }
  if (result.error || result.data?.user?.id !== owner.id) {
    const authErrorStatus = Number(result.error?.status ?? result.error?.statusCode);
    if (recovery && authErrorStatus >= 400 && authErrorStatus < 500) {
      try {
        await repository.releasePersonnelInvitationRecovery({
          id: owner.id,
          tokenDigest: digestInvitationRecoverySecret(recoverySecret),
          claimId: recovery,
        });
      } catch { /* Preserve the original Auth error if the cleanup RPC is unavailable. */ }
    }
    throw new ApiError(503, 'The password change could not be confirmed. Please retry without signing out.');
  }
  try {
    const completed = recovery
      ? await repository.completePersonnelInvitationRecovery({
        id: owner.id,
        tokenDigest: digestInvitationRecoverySecret(recoverySecret),
        claimId: recovery,
      })
      : await repository.completePersonnelAccountSetup(owner.id);
    if (!completed || completed.setupRequired || completed.lifecycleVersion === null) throw new Error('Setup was not confirmed');
    await waitForCredentialCutoff(completed);
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

/**
 * Replace an administrator-assigned temporary password with a permanent password
 * for an approved, unsuspended staff account before `temporaryPasswordExpiresAt`.
 *
 * Updates Supabase Auth as the verified caller and clears `mustChangePassword`
 * via a claim-bound completion, throwing `503` if confirmation fails.
 *
 * @param {Object} [options] - Password rotation payload
 * @param {string} [options.accessToken] - Caller's Bearer access token
 * @param {string} [options.password] - New permanent password
 * @returns {Promise<Object>} `{ passwordChanged, active, approvalStatus, activationRequested }`
 */
export const changeTemporaryPersonnelPassword = async ({ accessToken, password } = {}) => {
  const validation = personnelPasswordSetupValidator({ password });
  if (validation.error) throw ApiError.badRequest('Validation failed', validation.error);
  const owner = await verifySetupOwner(accessToken);
  const account = await loadSetupAccount(owner);
  if (!account || account.lifecycleVersion === null || !account.mustChangePassword) {
    throw ApiError.conflict('This account does not require a temporary-password change.');
  }
  if (account.approvalStatus !== 'approved' || account.suspendedAt) {
    throw ApiError.forbidden('A permanent password can be created only after approval and while the account is not suspended.');
  }

  let passwordDigest;
  try { passwordDigest = digestTemporaryPasswordChange(owner.id, validation.value.password, env.supabaseServiceRoleKey); }
  catch { throw new ApiError(503, 'Temporary password protection is not configured.'); }
  let claimId;
  try { claimId = await repository.beginPersonnelTemporaryPasswordChange({ id: owner.id, passwordDigest }); }
  catch { throw new ApiError(503, 'The temporary-password change could not be authorized. Retry or contact your administrator.'); }
  if (!claimId) {
    if (account.temporaryPasswordExpiresAt && Date.parse(account.temporaryPasswordExpiresAt) <= Date.now()) {
      throw ApiError.forbidden('This temporary password has expired. Contact your administrator for a new one.');
    }
    throw ApiError.conflict('Another password change or administrator invitation is already being processed.');
  }

  let result;
  try {
    result = await repository.updatePersonnelOwnPassword({ accessToken, password: validation.value.password });
  } catch {
    throw new ApiError(503, 'The password change could not be confirmed. Please retry.');
  }
  if (result.error || result.data?.user?.id !== owner.id) {
    const authErrorStatus = Number(result.error?.status ?? result.error?.statusCode);
    if (authErrorStatus >= 400 && authErrorStatus < 500) {
      try { await repository.releasePersonnelTemporaryPasswordChange({ id: owner.id, claimId }); }
      catch { /* Preserve the Auth error if cleanup is unavailable. */ }
    }
    throw new ApiError(503, 'The password change could not be confirmed. Please retry.');
  }

  let completed;
  try {
    completed = await repository.completeClaimedTemporaryPasswordChange({ id: owner.id, claimId });
  } catch {
    try { await repository.releasePersonnelTemporaryPasswordChange({ id: owner.id, claimId }); }
    catch { /* A confirmed Auth update can safely hand recovery to a fresh invitation. */ }
    throw new ApiError(503, 'Your password was saved, but the password-change requirement could not be confirmed. Please retry.');
  }
  if (!completed || completed.mustChangePassword) {
    try { await repository.releasePersonnelTemporaryPasswordChange({ id: owner.id, claimId }); }
    catch { /* A confirmed Auth update can safely hand recovery to a fresh invitation. */ }
    throw new ApiError(503, 'Your password was saved, but the password-change requirement could not be confirmed. Please retry.');
  }
  await waitForCredentialCutoff(completed);
  return {
    passwordChanged: true,
    active: completed.status === 'active',
    approvalStatus: completed.approvalStatus,
    activationRequested: completed.activationRequested,
  };
};

export default {
  signIn,
  getCurrentUser,
  signOut,
  requestPasswordReset,
  getPersonnelSetupStatus,
  setupPersonnelPassword,
  changeTemporaryPersonnelPassword,
};

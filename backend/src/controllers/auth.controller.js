import * as authService from '../services/auth.service.js';
import { updateOwnContact } from '../services/profile.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * Authentication, Session & Personnel Onboarding Controller.
 *
 * Fits into the KALUSAGAP request pipeline as:
 *   route -> [rateLimit] -> [authenticate] -> controller -> auth.service / profile.service -> Supabase Auth & profiles
 *
 * Endpoints:
 * - POST  /api/auth/login                      — email + password -> Supabase session
 * - GET   /api/auth/me                         — current user profile from verified Bearer session
 * - PATCH /api/auth/me                         — self-service update of own contact number
 * - POST  /api/auth/logout                     — revoke current session
 * - POST  /api/auth/forgot-password            — request password reset email (enumeration-safe)
 * - GET   /api/auth/personnel/setup-status     — inspect invite/recovery token onboarding state
 * - POST  /api/auth/personnel/setup-password   — complete initial personnel password setup
 * - POST  /api/auth/personnel/change-password  — replace a temporary admin-issued password
 *
 * The role and scope in responses always come from the authenticated Supabase
 * account and stored profile so clients cannot choose or elevate privileges.
 */

/**
 * POST /api/auth/login
 * Authenticates `email` and `password` from `req.body` via `authService.signIn`
 * and returns the session tokens and resolved user profile via `sendData` (`200 OK`).
 */
export const login = async (req, res) => {
  const { email, password } = req.body || {};
  const result = await authService.signIn({ email, password });
  sendData(res, result);
};

/**
 * GET /api/auth/me
 * Resolves the current authenticated user's profile and RBAC metadata using
 * `req.user.accessToken` via `authService.getCurrentUser`, returning `{ user }` (`200 OK`).
 */
export const me = async (req, res) => {
  const user = await authService.getCurrentUser(req.user.accessToken);
  sendData(res, { user });
};

/**
 * PATCH /api/auth/me — the authenticated account updates its OWN contact
 * number. Identity comes from the verified session (req.user); no id is taken
 * from the client, so a user can never modify another account's profile.
 */
export const updateMe = async (req, res) => {
  const user = await updateOwnContact({ user: req.user, contact: req.body?.contact });
  sendData(res, { user });
};

/**
 * POST /api/auth/logout
 * Revokes the caller's active Supabase session (`req.user.accessToken`) via
 * `authService.signOut` and returns confirmation via `sendData` (`200 OK`).
 */
export const logout = async (req, res) => {
  const result = await authService.signOut(req.user.accessToken);
  sendData(res, result);
};

/**
 * POST /api/auth/forgot-password
 * Triggers a password-reset flow for `req.body.email` via `authService.requestPasswordReset`.
 * Always responds with `{ accepted: true }` (`200 OK`) to prevent account enumeration.
 */
export const forgotPassword = async (req, res) => {
  await authService.requestPasswordReset({ email: req.body.email });
  // Same response whether or not an eligible account exists.
  sendData(res, { accepted: true });
};

/**
 * Extracts the raw Bearer token from `req.headers.authorization` for pre-onboarding
 * or password-change endpoints that inspect invite/temporary sessions directly.
 *
 * @param {Object} req - Express request object.
 * @returns {string|null} Trimmed JWT string or `null` if missing/malformed.
 */
const bearerToken = (req) => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
};

/**
 * GET /api/auth/personnel/setup-status
 * Checks whether the Bearer token belongs to a personnel account awaiting initial
 * password setup via `authService.getPersonnelSetupStatus`, returning status via `sendData`.
 */
export const personnelSetupStatus = async (req, res) => {
  sendData(res, await authService.getPersonnelSetupStatus({ accessToken: bearerToken(req) }));
};

/**
 * POST /api/auth/personnel/setup-password
 * Completes initial password onboarding for an invited personnel account using
 * the Bearer token and `req.body.password` via `authService.setupPersonnelPassword`.
 */
export const personnelPasswordSetup = async (req, res) => {
  sendData(res, await authService.setupPersonnelPassword({ accessToken: bearerToken(req), password: req.body.password }));
};

/**
 * POST /api/auth/personnel/change-password
 * Replaces an admin-assigned temporary password using the Bearer token and
 * `req.body.password` via `authService.changeTemporaryPersonnelPassword`.
 */
export const temporaryPasswordChange = async (req, res) => {
  sendData(res, await authService.changeTemporaryPersonnelPassword({
    accessToken: bearerToken(req),
    password: req.body.password,
  }));
};

export default {
  login,
  me,
  updateMe,
  logout,
  forgotPassword,
  personnelSetupStatus,
  personnelPasswordSetup,
  temporaryPasswordChange,
};

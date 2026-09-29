import * as authService from '../services/auth.service.js';
import { updateOwnContact } from '../services/profile.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * POST  /api/auth/login   — email + password -> Supabase session
 * GET   /api/auth/me      — current user from Bearer token (requires auth)
 * PATCH /api/auth/me      — self-service update of own contact number
 * POST  /api/auth/logout  — revoke current session (requires auth)
 *
 * The role in the response comes from the authenticated Supabase account, so
 * the client cannot choose or elevate it.
 */
export const login = async (req, res) => {
  const { email, password } = req.body || {};
  const result = await authService.signIn({ email, password });
  sendData(res, result);
};

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

export const logout = async (req, res) => {
  const result = await authService.signOut(req.user.accessToken);
  sendData(res, result);
};

export default { login, me, updateMe, logout };

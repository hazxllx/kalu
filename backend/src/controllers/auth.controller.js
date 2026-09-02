import * as authService from '../services/auth.service.js';
import { sendData } from '../utils/apiResponse.js';

/**
 * POST /api/auth/login   — email + password -> Supabase session
 * GET  /api/auth/me      — current user from Bearer token (requires auth)
 * POST /api/auth/logout  — revoke current session (requires auth)
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

export const logout = async (req, res) => {
  const result = await authService.signOut(req.user.accessToken);
  sendData(res, result);
};

export default { login, me, logout };

/**
 * Controller for the development-only auth endpoint.
 *
 * POST /api/auth/dev-session — email + password -> { user, session } using the
 * local mock accounts. Exists so the workflow is testable without Supabase.
 */
import { devSignIn } from '../services/devAuth.service.js';
import { sendData } from '../utils/apiResponse.js';
import ApiError from '../utils/apiError.js';
import env from '../config/env.js';

export const createDevSession = async (req, res) => {
  if (!env.isDevAuthEnabled) throw ApiError.notFound('Not found');
  const { email, password } = req.body || {};
  const result = await devSignIn({ email, password });
  sendData(res, result);
};

export default { createDevSession };

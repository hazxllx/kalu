/**
 * Development-only authentication flow (no Supabase configured).
 *
 * Validates credentials against the local mock accounts and issues a signed
 * dev token. Only reachable when `env.isDevAuthEnabled` (never in production,
 * never when Supabase is configured). Used by the local development login so
 * the intake -> PHN workflow can be exercised end to end against the API.
 */
import env from '../config/env.js';
import { findDevAccount } from '../config/devAccounts.js';
import { signDevToken } from '../utils/devSession.js';
import ApiError from '../utils/apiError.js';

export const devSignIn = async ({ email, password }) => {
  if (!env.isDevAuthEnabled) {
    throw ApiError.notFound('Not found');
  }
  if (!email || !password) {
    throw ApiError.badRequest('Email and password are required');
  }

  const account = findDevAccount(email);
  if (!account || account.password !== password) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const user = {
    id: `dev-${account.role}-${account.email.split('@')[0]}`,
    email: account.email,
    name: account.name,
    role: account.role,
    municipalityId: account.municipalityId,
    rhuId: account.rhuId,
    barangayId: account.barangayId || null,
    // Barangay-scoped roles carry their assignment in the session so every
    // downstream query can filter on it (see config/scope.js).
    barangay: account.barangay || null,
  };

  const accessToken = signDevToken({
    sub: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
    ...(user.barangay ? { barangay: user.barangay } : {}),
    municipalityId: user.municipalityId,
    rhuId: user.rhuId,
    ...(user.barangayId ? { barangayId: user.barangayId } : {}),
  });

  return {
    user,
    session: { accessToken, tokenType: 'dev', expiresAt: null },
  };
};

export default { devSignIn };

import { createClient } from '@supabase/supabase-js';

import env from './env.js';

/**
 * Server-side Supabase clients.
 *
 * Two clients are exposed:
 *
 *  - `getServiceClient()` uses the SERVICE-ROLE key. It bypasses Row Level
 *    Security and must only ever run on the server, inside service-layer code
 *    that has already passed authentication + authorization middleware.
 *
 *  - `getUserClient(accessToken)` uses the ANON key with the caller's access
 *    token attached, so every query runs *as that user* and is still subject to
 *    RLS. Prefer this for reads/writes on behalf of an end user once RLS
 *    policies exist.
 *
 * Both are created lazily and only when Supabase is configured, so the server
 * boots (and `/api/health` works) even before real credentials are supplied.
 */

let serviceClient = null;

const assertConfigured = () => {
  if (!env.isSupabaseConfigured) {
    const error = new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env.',
    );
    error.statusCode = 503;
    throw error;
  }
};

/**
 * Shared service-role client (singleton). SERVER ONLY — never expose to the
 * frontend. Throws 503 until Supabase credentials are configured.
 */
export const getServiceClient = () => {
  assertConfigured();
  if (!serviceClient) {
    serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return serviceClient;
};

/**
 * Per-request client scoped to a single end user's access token. Queries made
 * through it are evaluated under that user's identity, so Supabase RLS applies.
 */
export const getUserClient = (accessToken) => {
  assertConfigured();
  const key = env.supabaseAnonKey || env.supabaseServiceRoleKey;
  return createClient(env.supabaseUrl, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

export default { getServiceClient, getUserClient };

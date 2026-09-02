import dotenv from 'dotenv';

dotenv.config();

/**
 * Single source of truth for backend configuration.
 *
 * Nothing else in the codebase reads `process.env` directly: importing this
 * module keeps defaults and parsing in one place, so a new setting is added
 * once and used everywhere.
 *
 * Supabase settings are read here. They are OPTIONAL at boot: the server still
 * starts without them (so the health check and the API skeleton work in local
 * development), but any endpoint that needs Supabase reports a clear error
 * until the real project credentials are supplied via `.env`.
 */
const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,

  // Browser origins allowed to call this API. Comma-separated so a staging or
  // preview URL can be added without a code change. `CLIENT_URL` is the
  // canonical name; `CORS_ORIGIN` is accepted as a fallback alias.
  clientUrls: (process.env.CLIENT_URL || process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  // --- Supabase (server side) ------------------------------------------------
  // The service-role key bypasses Row Level Security, so it lives ONLY here on
  // the server. It must never be sent to the browser or committed to git.
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  // The anon key is safe to use for verifying end-user access tokens.
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',

  // --- Local data store ------------------------------------------------------
  // Used only while Supabase is not configured (see repository). Holds the
  // JSON file that persists residents, submissions and referrals so the
  // workflow works end-to-end in local development. Never a production store.
  dataDir: process.env.DATA_DIR || '',

  // --- Development-only auth ------------------------------------------------
  // Secret used to sign local dev-auth tokens (see services/devAuth.service.js).
  // When absent the server derives a persistent random secret on first boot so
  // dev tokens survive restarts; this path is disabled in production and
  // whenever Supabase is configured.
  devAuthSecret: process.env.DEV_AUTH_SECRET || '',
};

env.isProduction = env.nodeEnv === 'production';
// True only when the server has enough configuration to talk to Supabase.
env.isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
// Whether server-side dev authentication (mock accounts + signed tokens) may
// be used. Never in production, and never when real Supabase auth is available.
env.isDevAuthEnabled = !env.isProduction && !env.isSupabaseConfigured;

export default env;

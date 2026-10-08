import dotenv from 'dotenv';

dotenv.config();

const isProduction = (process.env.NODE_ENV || 'development') === 'production';
const clientUrlValue = process.env.CLIENT_URL || '';
const corsOriginValue = process.env.CORS_ORIGIN || '';
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (isProduction) {
  const missing = [];
  if (!clientUrlValue) missing.push('CLIENT_URL');
  if (!corsOriginValue) missing.push('CORS_ORIGIN');
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
  if (!supabaseServiceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    throw new Error(
      `Production configuration is incomplete. Missing required environment variable(s): ${missing.join(', ')}`,
    );
  }
}

const configuredClientUrls = isProduction
  ? `${clientUrlValue},${corsOriginValue}`
  : clientUrlValue || corsOriginValue || 'http://localhost:5173';

/**
 * Single source of truth for backend configuration.
 *
 * Application runtime configuration is centralized here. Operational scripts
 * may read script-specific variables directly.
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
  clientUrls: configuredClientUrls
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).origin),

  // --- Supabase (server side) ------------------------------------------------
  // The service-role key bypasses Row Level Security, so it lives ONLY here on
  // the server. It must never be sent to the browser or committed to git.
  supabaseUrl,
  supabaseServiceRoleKey,
  // The anon key is safe to use for verifying end-user access tokens.
  supabaseAnonKey,

  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpUser: process.env.SMTP_USER || '',
  smtpPassword: process.env.SMTP_PASSWORD || '',
  smtpFrom: process.env.SMTP_FROM || '',
  otpPepper: process.env.OTP_PEPPER || '',

  // --- Local data store ------------------------------------------------------
  // Used only while Supabase is not configured (see repository). Holds the
  // JSON file that persists residents, submissions and referrals so the
  // workflow works end-to-end in local development. Never a production store.
  dataDir: process.env.DATA_DIR || '',
};

env.isProduction = isProduction;
// True only when the server has enough configuration to talk to Supabase.
// Supabase Auth is the ONLY sign-in path — there is no local/mock authentication.
env.isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);

export default env;

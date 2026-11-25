import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { assertDevelopmentEnvironment } from './localSafety.js';
import { normalizeClientUrl } from './clientUrl.js';

/**
 * KALUSAGAP — centralized backend environment & runtime configuration.
 *
 * Architectural role: loaded at startup by `app.js`, `server.js`, middleware
 * (CORS, rate limiting, auth), services (SMTP mail, OTP hashing, personnel
 * notifications), and `config/supabase.js` across the entire
 * `route -> authenticate -> authorize -> controller -> service -> repository/Supabase`
 * stack.
 */
// Load the folder's single .env; hosting-provided variables take precedence.
const runtimeMode = process.env.NODE_ENV || 'development';
if (!['development', 'test', 'production'].includes(runtimeMode)) {
  throw new Error('NODE_ENV must be development, test, or production.');
}
if (runtimeMode === 'development') {
  dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
}
if ((process.env.NODE_ENV || 'development') !== runtimeMode) {
  throw new Error('Environment files cannot change NODE_ENV.');
}

const isProduction = (process.env.NODE_ENV || 'development') === 'production';
const clientUrlValue = process.env.CLIENT_URL || '';
const corsOriginValue = process.env.CORS_ORIGIN || '';
const clientUrl = clientUrlValue.trim()
  ? normalizeClientUrl(clientUrlValue, { nodeEnv: runtimeMode })
  : '';
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseMode = process.env.SUPABASE_MODE || 'local';
const personnelIntervalSeconds = Number(process.env.PERSONNEL_NOTIFICATION_INTERVAL_SECONDS || 60);
const DEVELOPMENT_CLIENT_URLS = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

// Fail fast on boot in production if mandatory CORS or Supabase credentials are missing,
// preventing a misconfigured deployment from starting with degraded security or broken auth.
if (isProduction) {
  const missing = [];
  if (!clientUrlValue.trim()) missing.push('CLIENT_URL');
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
  if (!supabaseServiceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    throw new Error(
      `Production configuration is incomplete. Missing required environment variable(s): ${missing.join(', ')}`,
    );
  }
}

/**
 * Validate and normalize a strict HTTP(S) browser origin string for CORS.
 * Rejects wildcards, non-HTTP(S) schemes, embedded credentials, non-root paths,
 * query strings, and URL fragments so only exact `scheme://host[:port]` origins pass.
 *
 * @param {string} value
 * @returns {string} Canonical `url.origin`
 */
const parseHttpOrigin = (value) => {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid browser origin configuration.'); }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || (url.pathname && url.pathname !== '/')
    || url.search
    || url.hash) {
    throw new Error('Invalid browser origin configuration. Use an HTTP(S) origin without credentials, path, query, or fragment.');
  }
  return url.origin;
};

// CORS is an allowlist. Authentication redirects always use `clientUrl` alone.
// Development keeps both loopback browser addresses; production must explicitly
// list any additional frontend origins in CORS_ORIGIN.
const configuredClientUrls = [
  ...new Set(
    [
      clientUrl,
      ...corsOriginValue.split(','),
      ...(!isProduction ? DEVELOPMENT_CLIENT_URLS : []),
    ]
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map(parseHttpOrigin),
  ),
];
if (isProduction && supabaseMode === 'hosted-development') {
  throw new Error('SUPABASE_MODE=hosted-development is only permitted in local development.');
}
if (!isProduction) assertDevelopmentEnvironment(process.env);

/**
 * Coerce `TRUST_PROXY` env string into Express `trust proxy` format:
 * booleans (`'false'`/`'0'`/`'true'`), numeric hop count, or subnet name (e.g. `'loopback'`).
 *
 * @param {string} value
 * @returns {boolean|number|string}
 */
const parseTrustProxy = (value) => {
  if (!value || value === 'false' || value === '0') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
};

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
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '1mb',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY || 'loopback'),
  apiRateLimitWindowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS) || 60_000,
  apiRateLimitMaxRequests: Number(process.env.API_RATE_LIMIT_MAX_REQUESTS) || 120,
  authRateLimitWindowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  authRateLimitMaxRequests: Number(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS) || 10,

  // Browser origins allowed to call this API. `CORS_ORIGIN` may add
  // comma-separated staging/preview origins; it never supplies email targets.
  clientUrls: configuredClientUrls,
  // One normalized origin for every authentication email redirect.
  clientUrl,

  // --- Supabase (server side) ------------------------------------------------
  // The service-role key bypasses Row Level Security, so it lives ONLY here on
  // the server. It must never be sent to the browser or committed to git.
  supabaseUrl,
  supabaseServiceRoleKey,
  // The anon key is safe to use for verifying end-user access tokens.
  supabaseAnonKey,
  supabaseMode,
  isHostedSupabaseDevelopment: !isProduction && supabaseMode === 'hosted-development',

  // --- Outbound email, background worker & OTP security --------------------
  smtpHost: process.env.SMTP_HOST || (isProduction ? '' : '127.0.0.1'),
  smtpPort: Number(process.env.SMTP_PORT) || (isProduction ? 587 : 54325),
  smtpUser: process.env.SMTP_USER || '',
  smtpPassword: process.env.SMTP_PASSWORD || '',
  smtpFrom: process.env.SMTP_FROM || (isProduction ? '' : 'KALUSAGAP Local <noreply@kalusagap.test>'),
  // Poll cadence for the background personnel notification worker, clamped to [10s, 3600s].
  personnelNotificationIntervalMs: Math.round(Math.min(3600, Math.max(10,
    Number.isFinite(personnelIntervalSeconds) ? personnelIntervalSeconds : 60,
  ))) * 1000,
  // Server-side secret mixed into one-time verification code hashes.
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

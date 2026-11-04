import { lookup } from 'node:dns/promises';
import env from '../src/config/env.js';
import { publicSupabaseConfigurationError } from '../../shared/authConnectivity.js';

// Read-only diagnostics: never submit credentials, create users, or send email.
const configurationError = publicSupabaseConfigurationError(env.supabaseUrl, env.supabaseAnonKey);
const results = {
  configuration: {
    publicAuthConfigured: !configurationError,
    error: configurationError,
    serverKeyConfigured: Boolean(env.supabaseServiceRoleKey),
    allowedOrigins: env.clientUrls,
  },
};

const probe = async (url, options = {}) => {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
    return {
      reachable: true,
      status: response.status,
      allowOrigin: response.headers.get('access-control-allow-origin'),
      allowCredentials: response.headers.get('access-control-allow-credentials'),
    };
  } catch (error) {
    return { reachable: false, error: error.cause?.code || error.name };
  }
};

const origin = env.clientUrls[0];
results.backend = await probe(`http://localhost:${env.port}/api/health`, {
  headers: origin ? { Origin: origin } : {},
});
results.cors = await probe(`http://localhost:${env.port}/api/auth/login`, {
  method: 'OPTIONS',
  headers: {
    ...(origin ? { Origin: origin } : {}),
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type,authorization',
  },
});

if (!configurationError) {
  const hostname = new URL(env.supabaseUrl).hostname;
  try {
    results.dns = { hostname, resolved: (await lookup(hostname, { all: true })).length > 0 };
  } catch (error) {
    results.dns = { hostname, resolved: false, error: error.code };
  }
  results.supabaseAuth = await probe(`${env.supabaseUrl.replace(/\/+$/, '')}/auth/v1/health`, {
    headers: { apikey: env.supabaseAnonKey },
  });
}

console.log(JSON.stringify(results, null, 2));
if (configurationError || results.backend.status !== 200 || !results.supabaseAuth?.reachable
  || results.supabaseAuth.status !== 200 || results.cors.status !== 204
  || (origin && results.cors.allowOrigin !== origin)) process.exitCode = 1;

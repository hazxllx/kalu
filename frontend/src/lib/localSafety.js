import { hostedSupabaseProjectRef } from '../../../shared/authConnectivity.js';

export const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
// Intentional public basemap dependency: styles, tiles, sprites and glyphs only.
// Health records and application APIs must never use this origin.
export const PUBLIC_MAP_ORIGIN = 'https://tiles.openfreemap.org';

export function requireLocalUrl(value, name) {
  let url;
  try { url = new URL(value); } catch {
    throw new Error(`${name} must be an absolute loopback HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || /[\\\s\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} must use loopback HTTP(S), without credentials, queries or fragments.`);
  }
  return url;
}

export function validateLocalEnvironment(env) {
  requireLocalUrl(env.VITE_APP_BASE_URL, 'VITE_APP_BASE_URL');
  requireLocalUrl(env.VITE_API_URL, 'VITE_API_URL');
  const supabaseMode = env.VITE_SUPABASE_MODE || 'local';
  if (!['local', 'hosted-development'].includes(supabaseMode)) {
    throw new Error('VITE_SUPABASE_MODE must be local or hosted-development.');
  }
  let hostedProjectRef = null;
  if (env.VITE_SUPABASE_URL) {
    if (supabaseMode === 'hosted-development') {
      hostedProjectRef = hostedSupabaseProjectRef(env.VITE_SUPABASE_URL);
      if (!hostedProjectRef) {
        throw new Error('Hosted development requires an HTTPS Supabase project URL without credentials, path, query, or fragment.');
      }
    } else {
      const url = requireLocalUrl(env.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL');
      if (url.pathname !== '/') throw new Error('VITE_SUPABASE_URL must be the local project base URL.');
    }
  } else if (supabaseMode === 'hosted-development') {
    throw new Error('VITE_SUPABASE_URL is required for hosted development.');
  }

  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('VITE_') || !String(value).trim()) continue;
    if (name === 'VITE_MAP_STYLE_URL' || name === 'VITE_SUPABASE_ANON_KEY') continue;
    if (name === 'VITE_SUPABASE_URL' && supabaseMode === 'hosted-development') continue;
    if (/(KEY|TOKEN|SECRET|PASSWORD|PRIVATE|SERVICE_ROLE)/i.test(name)
      || ['VITE_APP_ID', 'VITE_FUNCTIONS_VERSION'].includes(name)) {
      throw new Error(`${name} is not permitted in local browser configuration.`);
    }
    if (/(URL|ORIGIN|ENDPOINT|HOST)$/.test(name) || /^\w+:\/\//.test(value)) {
      requireLocalUrl(value, name);
    }
  }

  const key = String(env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (supabaseMode === 'hosted-development' && !key) {
    throw new Error('VITE_SUPABASE_ANON_KEY is required for hosted development.');
  }
  if (key) {
    if (!env.VITE_SUPABASE_URL) throw new Error('A local Supabase URL is required with its anon key.');
    if (supabaseMode === 'hosted-development' && key.startsWith('sb_publishable_')) {
      return validateLocalMapStyle(env);
    }
    if (supabaseMode === 'hosted-development' && key.startsWith('sb_secret_')) {
      throw new Error('VITE_SUPABASE_ANON_KEY must not contain a server secret or service-role key.');
    }
    let claims;
    try {
      const parts = key.split('.');
      if (parts.length !== 3) throw new Error();
      claims = JSON.parse(globalThis.atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
      throw new Error(supabaseMode === 'hosted-development'
        ? 'VITE_SUPABASE_ANON_KEY must be a public key from the hosted development project.'
        : 'Local Supabase requires a local anon JWT; hosted/opaque credentials are not permitted.');
    }
    if (supabaseMode === 'hosted-development') {
      if (!claims || claims.role !== 'anon' || claims.ref !== hostedProjectRef || claims.iss === 'supabase-demo') {
        throw new Error('VITE_SUPABASE_ANON_KEY does not match the hosted development project.');
      }
    } else if (!claims || claims.role !== 'anon' || claims.ref || claims.iss !== 'supabase-demo') {
      throw new Error('Local Supabase requires an anon JWT issued by supabase-demo without a hosted project reference.');
    }
  }

  return validateLocalMapStyle(env);
}

function validateLocalMapStyle(env) {
  const map = new URL(env.VITE_MAP_STYLE_URL || DEFAULT_MAP_STYLE_URL);
  if (map.origin !== PUBLIC_MAP_ORIGIN) {
    requireLocalUrl(map.href, 'VITE_MAP_STYLE_URL');
  } else if (map.username || map.password || map.search || map.hash) {
    throw new Error('VITE_MAP_STYLE_URL must not contain credentials, queries or fragments.');
  }
}

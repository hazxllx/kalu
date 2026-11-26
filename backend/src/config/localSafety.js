// backend/src/config/localSafety.js
import { hostedSupabaseProjectRef } from '../../../shared/authConnectivity.js';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export const assertHostedSupabaseUrl = (value) => {
  const projectRef = hostedSupabaseProjectRef(value);
  if (!projectRef) {
    throw new Error('Hosted development requires an HTTPS Supabase project URL without credentials, path, query, or fragment.');
  }
  return projectRef;
};

const assertHostedSupabaseKey = (value, name, role, projectRef) => {
  if (!value) throw new Error(`${name} is required for hosted development.`);
  if (role === 'anon' && value.startsWith('sb_publishable_')) return;
  if (role === 'service_role' && value.startsWith('sb_secret_')) return;
  if (value.startsWith('sb_publishable_') || value.startsWith('sb_secret_')) {
    throw new Error(`${name} has the wrong key type for hosted development.`);
  }

  let claims;
  try {
    const parts = value.split('.');
    if (parts.length !== 3) throw new Error();
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    throw new Error(`${name} must be a project key from the configured Supabase project.`);
  }
  if (!claims || typeof claims !== 'object'
    || claims.role !== role || claims.ref !== projectRef || claims.iss === 'supabase-demo') {
    throw new Error(`${name} does not match the configured hosted Supabase project.`);
  }
};

const validateHostedDevelopmentSmtp = (values) => {
  const host = String(values.SMTP_HOST || '').trim();
  if (!host || loopbackHosts.has(host)) return false;
  if (!values.SMTP_USER || !values.SMTP_PASSWORD) {
    throw new Error('Remote SMTP in hosted development requires SMTP_USER and SMTP_PASSWORD.');
  }

  let url;
  try { url = new URL(`smtp://${host}`); } catch {
    throw new Error('SMTP_HOST must be a hostname for hosted development.');
  }
  if (!url.hostname || url.username || url.password || url.port
    || url.host.toLowerCase() !== host.toLowerCase()
    || (url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('SMTP_HOST must be a hostname without credentials, port, path, query, or fragment.');
  }

  const port = Number(values.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid port for hosted development SMTP.');
  }
  return true;
};

export const assertLocalUrl = (value, name, protocols = ['http:', 'https:']) => {
  if (!value) return;
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid local URL.`); }
  if (!protocols.includes(url.protocol) || !loopbackHosts.has(url.hostname)
    || (protocols.includes('http:') && (url.username || url.password))) {
    throw new Error(`${name} must point to a loopback service in development.`);
  }
};

export const assertLocalKey = (value, name) => {
  if (!value) return;
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) {
    throw new Error(`${name} must be a local Supabase JWT from supabase status.`);
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString()); } catch {
    throw new Error(`${name} must be a local Supabase JWT from supabase status.`);
  }
  if (payload.iss !== 'supabase-demo' || payload.ref
    || !['anon', 'service_role'].includes(payload.role)
    || (name.endsWith('ANON_KEY') && payload.role !== 'anon')
    || (name.endsWith('SERVICE_ROLE_KEY') && payload.role !== 'service_role')) {
    throw new Error(`${name} is not a local Supabase credential.`);
  }
};

export const assertLocalEnvironment = (values) => {
  for (const name of ['SUPABASE_URL', 'API_URL', 'CLIENT_URL', 'CORS_ORIGIN',
    'SUPABASE_DEV_URL', 'TEST_SUPABASE_URL']) {
    for (const value of (values[name] || '').split(',').filter(Boolean)) {
      assertLocalUrl(value.trim(), name);
      const url = new URL(value.trim());
      if (url.search || url.hash) throw new Error(`${name} cannot contain a query or fragment.`);
    }
  }
  for (const name of ['DATABASE_URL', 'DIRECT_URL', 'TEST_DATABASE_URL', 'SUPABASE_DB_URL', 'POSTGRES_URL']) {
    assertLocalUrl(values[name], name, ['postgres:', 'postgresql:']);
    if (values[name] && (new URL(values[name]).search || new URL(values[name]).hash)) {
      throw new Error(`${name} cannot override database connection options in development.`);
    }
  }
  for (const name of ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_DEV_ANON_KEY', 'SUPABASE_DEV_SERVICE_ROLE_KEY',
    'TEST_SUPABASE_ANON_KEY', 'TEST_SUPABASE_SERVICE_ROLE_KEY']) assertLocalKey(values[name], name);
  if (values.SMTP_HOST && !loopbackHosts.has(values.SMTP_HOST)) {
    throw new Error('SMTP_HOST must be a loopback email capture service in development.');
  }
  for (const name of ['SMTP_USER', 'SMTP_PASSWORD', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
    if (values[name]) throw new Error(`${name} must be empty in local development.`);
  }
};

export const assertDevelopmentEnvironment = (values) => {
  const mode = values.SUPABASE_MODE || 'local';
  if (mode === 'local') return assertLocalEnvironment(values);
  if (mode !== 'hosted-development') {
    throw new Error('SUPABASE_MODE must be local or hosted-development.');
  }

  const projectRef = assertHostedSupabaseUrl(values.SUPABASE_URL);
  assertHostedSupabaseKey(values.SUPABASE_ANON_KEY, 'SUPABASE_ANON_KEY', 'anon', projectRef);
  assertHostedSupabaseKey(values.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY', 'service_role', projectRef);
  const usesRemoteSmtp = validateHostedDevelopmentSmtp(values);
  const localValues = {
    ...values,
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  };
  if (usesRemoteSmtp) {
    localValues.SMTP_HOST = '127.0.0.1';
    localValues.SMTP_USER = '';
    localValues.SMTP_PASSWORD = '';
  }
  assertLocalEnvironment(localValues);
};

export const localServiceFetch = (input, options) => {
  assertLocalUrl(input instanceof Request ? input.url : String(input), 'Service request');
  return fetch(input, { ...options, redirect: 'error' });
};

export const hostedSupabaseDevelopmentFetch = (supabaseUrl) => {
  const allowedOrigin = new URL(supabaseUrl).origin;
  return (input, options) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.origin !== allowedOrigin) {
      throw new Error('Hosted development Supabase requests must use the configured project origin.');
    }
    return fetch(input, { ...options, redirect: 'error' });
  };
};

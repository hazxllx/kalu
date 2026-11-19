const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

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

export const localServiceFetch = (input, options) => {
  assertLocalUrl(input instanceof Request ? input.url : String(input), 'Service request');
  return fetch(input, { ...options, redirect: 'error' });
};

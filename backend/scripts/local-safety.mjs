import { assertLocalKey, assertLocalUrl } from '../src/config/localSafety.js';

export function assertLocalScriptEnvironment(values = process.env) {
  for (const name of ['SUPABASE_URL', 'SUPABASE_DEV_URL', 'TEST_SUPABASE_URL', 'API_URL']) {
    const value = values[name];
    if (!value) continue;
    assertLocalUrl(value, name);
    const url = new URL(value);
    if (url.search || url.hash) throw new Error(`${name} cannot contain a query or fragment.`);
  }

  for (const name of ['DATABASE_URL', 'DIRECT_URL', 'TEST_DATABASE_URL', 'SUPABASE_DB_URL', 'POSTGRES_URL']) {
    const value = values[name];
    if (!value) continue;
    assertLocalUrl(value, name, ['postgres:', 'postgresql:']);
    const url = new URL(value);
    // PostgreSQL connection options can override the URL host or select a service file.
    if ([...url.searchParams.keys()].some((key) => ['host', 'hostaddr', 'service'].includes(key.toLowerCase()))) {
      throw new Error(`${name} cannot override the database host or service.`);
    }
  }

  for (const prefix of ['SUPABASE', 'SUPABASE_DEV', 'TEST_SUPABASE']) {
    for (const [suffix, role] of [['ANON_KEY', 'anon'], ['SERVICE_ROLE_KEY', 'service_role']]) {
      const name = `${prefix}_${suffix}`;
      const key = values[name];
      if (!key) continue;
      if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) {
        throw new Error(`${name} must be a local Supabase JWT from supabase status.`);
      }
      assertLocalKey(key, name);
      const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
      if (payload.role !== role) throw new Error(`${name} must have the ${role} role.`);
    }
  }
}

export function localFetch(input, options) {
  assertLocalUrl(input instanceof Request ? input.url : String(input), 'Script request URL');
  return fetch(input, { ...options, redirect: 'error' });
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { AUTH_NETWORK_FAILURE_MESSAGE, authFailureMessage } from '../../../shared/authConnectivity.js';

test('the existing login uses Supabase Auth with an accurate network-outage message', async () => {
  const source = await readFile(new URL('../../src/context/AuthContext.jsx', import.meta.url), 'utf8');
  assert.match(source, /supabase\.auth\.signInWithPassword\(\{ email, password \}\)/);
  assert.match(source, /authFailureMessage\(error\)/);
  assert.equal(authFailureMessage({ name: 'AuthRetryableFetchError', status: 0 }), AUTH_NETWORK_FAILURE_MESSAGE);
});

test('the current login form and design remain in place with no role picker or hardcoded sign-in', async () => {
  const source = await readFile(new URL('../../src/features/authentication/pages/Login.jsx', import.meta.url), 'utf8');
  assert.match(source, /login\(\{ email, password \}\)/);
  assert.match(source, /gov-navy-panel/);
  assert.match(source, /Sign in to the portal/);
  assert.match(source, /id="login-email"/);
  assert.match(source, /id="login-password"/);
  assert.doesNotMatch(source, /mock|hardcodedPassword|service_role/);
});

test('build-time validation prevents a service-role credential from being shipped to the browser', async () => {
  const source = await readFile(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(source, /publicSupabaseConfigurationError\(env\.VITE_SUPABASE_URL, env\.VITE_SUPABASE_ANON_KEY\)/);
  assert.match(source, /throw new Error\(`Frontend authentication configuration is invalid/);
});

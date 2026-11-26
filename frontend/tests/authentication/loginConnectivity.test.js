import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { productionFrontendEnvironment } from '../../vite.config.js';
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
  assert.doesNotMatch(source, /Sign-in is unavailable|Supabase project URL|anon\/publishable key|redeploy/);
});

test('personnel invitation login prevents an existing session from redirecting to its dashboard', async () => {
  const source = await readFile(new URL('../../src/features/authentication/pages/Login.jsx', import.meta.url), 'utf8');
  assert.match(source, /get\("switchAccount"\) === "1"/);
  assert.match(source, /!invitationAccountSwitch/);
  assert.match(source, /invitationSwitchHandled\.current = true/);
  assert.match(source, /logout\(false\)/);
});

test('build-time validation prevents a service-role credential from being shipped to the browser', async () => {
  const source = await readFile(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(source, /publicSupabaseConfigurationError\(env\.VITE_SUPABASE_URL, env\.VITE_SUPABASE_ANON_KEY\)/);
  assert.match(source, /throw new Error\(`Frontend authentication configuration is invalid/);
});

test('production builds can use the existing public Supabase settings without exposing server secrets', () => {
  const env = productionFrontendEnvironment({
    SUPABASE_URL: 'https://existing-project.supabase.co',
    SUPABASE_ANON_KEY: 'public-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
    VITE_API_URL: 'https://api.example.test',
  });

  assert.equal(env.VITE_SUPABASE_URL, 'https://existing-project.supabase.co');
  assert.equal(env.VITE_SUPABASE_ANON_KEY, 'public-anon-key');
  assert.equal(Object.hasOwn(env, 'SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(Object.hasOwn(env, 'VITE_SUPABASE_SERVICE_ROLE_KEY'), false);
});

test('explicit Vite Supabase settings take precedence over backend-style aliases', () => {
  const env = productionFrontendEnvironment({
    SUPABASE_URL: 'https://backend-project.supabase.co',
    SUPABASE_ANON_KEY: 'backend-anon-key',
    VITE_SUPABASE_URL: 'https://frontend-project.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'frontend-anon-key',
  });

  assert.equal(env.VITE_SUPABASE_URL, 'https://frontend-project.supabase.co');
  assert.equal(env.VITE_SUPABASE_ANON_KEY, 'frontend-anon-key');
});

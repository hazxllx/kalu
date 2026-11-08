import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTH_SERVICE_UNAVAILABLE_MESSAGE,
  AUTH_NETWORK_FAILURE_MESSAGE,
  authFailureMessage,
  isAuthNetworkFailure,
  isAuthServiceUnavailable,
  publicSupabaseConfigurationError,
} from '../../shared/authConnectivity.js';

const publicKey = (claims) => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

test('Supabase retryable, DNS, browser fetch, and server errors are availability failures, not bad credentials', () => {
  for (const error of [
    { name: 'AuthRetryableFetchError', status: 0 },
    { name: 'TypeError', message: 'Failed to fetch' },
    new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }),
    { name: 'NetworkError', message: 'Network request failed' },
    { status: 503 }, { statusCode: 503 },
  ]) {
    assert.equal(isAuthServiceUnavailable(error), true);
    assert.equal(authFailureMessage(error), isAuthNetworkFailure(error) ? AUTH_NETWORK_FAILURE_MESSAGE : AUTH_SERVICE_UNAVAILABLE_MESSAGE);
  }
});

test('sign-in failures distinguish verification, expiry, interruption, invalid credentials and unexpected errors', () => {
  assert.match(authFailureMessage({ code: 'email_not_confirmed', status: 400 }), /not verified.*confirm your email/i);
  assert.match(authFailureMessage({ code: 'jwt_expired', status: 401 }), /session expired/i);
  assert.match(authFailureMessage({ code: 'AUTH_SESSION_CHANGED' }), /changed unexpectedly/i);
  assert.match(authFailureMessage({ code: 'AUTH_INVALID_RESPONSE' }), /incomplete session/i);
  assert.match(authFailureMessage({ name: 'UnexpectedError' }), /unexpected authentication error/i);
  assert.equal(authFailureMessage({ code: 'invalid_credentials', status: 400 }), 'Invalid email or password');
});

test('invalid credentials and rate limiting remain distinct from service downtime', () => {
  assert.equal(isAuthServiceUnavailable({ status: 400, code: 'invalid_credentials' }), false);
  assert.equal(authFailureMessage({ status: 400, message: 'Private provider account detail' }), 'Invalid email or password');
  assert.match(authFailureMessage({ status: 429 }), /Too many sign-in attempts/);
  assert.equal(isAuthServiceUnavailable(null), false);
});

test('public configuration accepts existing anonymous and publishable keys without returning credentials', () => {
  assert.equal(publicSupabaseConfigurationError('https://existing-project.supabase.co', publicKey({ role: 'anon', ref: 'existing-project' })), null);
  assert.equal(publicSupabaseConfigurationError('http://127.0.0.1:54321', publicKey({ role: 'anon' })), null);
  assert.equal(publicSupabaseConfigurationError('https://auth.example.test', 'sb_publishable_test-only'), null);
});

test('browser configuration rejects server credentials, user tokens, malformed endpoints, and project mismatch', () => {
  const secret = 'sb_secret_DO_NOT_EXPOSE';
  for (const [url, key] of [
    ['https://existing-project.supabase.co', secret],
    ['https://existing-project.supabase.co', publicKey({ role: 'service_role' })],
    ['https://existing-project.supabase.co', publicKey({ role: 'authenticated' })],
    ['https://different-project.supabase.co', publicKey({ role: 'anon', ref: 'existing-project' })],
    ['not-a-url', 'sb_publishable_test-only'],
    ['https://user:password@example.test', 'sb_publishable_test-only'],
    ['https://example.test/auth/v1', 'sb_publishable_test-only'],
    ['https://example.test?token=private', 'sb_publishable_test-only'],
  ]) {
    const error = publicSupabaseConfigurationError(url, key);
    assert.equal(typeof error, 'string');
    assert.equal(error.includes(secret), false);
    assert.equal(error.includes('DO_NOT_EXPOSE'), false);
  }
  assert.match(publicSupabaseConfigurationError('', ''), /VITE_SUPABASE_URL/);
});

test('the existing backend Supabase password grant reports actual transport failure as 503, not invalid credentials', async () => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://auth-connectivity-tests.invalid';
  process.env.SUPABASE_ANON_KEY = 'test-only-public-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-server-key';
  const auth = await import('../src/services/auth.service.js');
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  };
  console.error = () => {};
  try {
    await assert.rejects(() => auth.signIn({ email: 'test-only@example.test', password: 'test-only-password' }),
      (error) => error.statusCode === 503 && error.details.code === 'AUTH_SERVICE_UNAVAILABLE'
        && error.message === AUTH_SERVICE_UNAVAILABLE_MESSAGE);
    assert.match(calls[0], /\/auth\/v1\/token\?grant_type=password$/);
    await assert.rejects(() => auth.getCurrentUser('test-only-token'), (error) => error.statusCode === 503);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

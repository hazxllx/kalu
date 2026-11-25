import assert from 'node:assert/strict';
import test from 'node:test';
import { authRedirectUrl, normalizeClientUrl, passwordRecoveryUrl } from '../src/config/clientUrl.js';

test('production canonical frontend URL is normalized and used for auth redirects', () => {
  assert.equal(normalizeClientUrl(' https://kalusagap.vercel.app/ ', { nodeEnv: 'production' }), 'https://kalusagap.vercel.app');
  assert.equal(authRedirectUrl('https://kalusagap.vercel.app/', '/reset-password', { nodeEnv: 'production' }), 'https://kalusagap.vercel.app/reset-password');
});

test('development supports a localhost canonical frontend URL', () => {
  assert.equal(normalizeClientUrl('http://localhost:5173', { nodeEnv: 'development' }), 'http://localhost:5173');
  assert.equal(authRedirectUrl('http://localhost:5173', '/reset-password', { nodeEnv: 'development' }), 'http://localhost:5173/reset-password');
});

test('production rejects localhost, loopback, and non-HTTPS frontend URLs', () => {
  for (const value of [
    'http://kalusagap.vercel.app',
    'https://localhost:5173',
    'https://127.0.0.1:5173',
    'https://[::1]:5173',
    'https://[::ffff:7f00:1]',
  ]) {
    assert.throws(() => normalizeClientUrl(value, { nodeEnv: 'production' }), /Production CLIENT_URL must use HTTPS/);
  }
});

test('password recovery link uses the canonical frontend and keeps Supabase proof fields', () => {
  const generated = new URL(passwordRecoveryUrl(
    'https://kalusagap.vercel.app', 'private-token.hash+value', 'recovery', { nodeEnv: 'production' },
  ));
  assert.equal(generated.origin, 'https://kalusagap.vercel.app');
  assert.equal(generated.pathname, '/reset-password');
  assert.equal(generated.searchParams.get('token_hash'), 'private-token.hash+value');
  assert.equal(generated.searchParams.get('type'), 'recovery');
});

test('canonical frontend URLs reject paths, credentials, queries, and fragments', () => {
  for (const value of [
    'https://user:password@example.test',
    'https://example.test/path',
    'https://example.test/?next=/login',
    'https://example.test/#token',
    'http://example.test',
  ]) assert.throws(() => normalizeClientUrl(value), /CLIENT_URL must|HTTP CLIENT_URL/);
});

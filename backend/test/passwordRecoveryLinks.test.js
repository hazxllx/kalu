import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPasswordActionUrl } from '../src/services/auth.service.js';

test('password recovery links use the configured canonical frontend origin and preserve token hash and type', () => {
  const link = new URL(buildPasswordActionUrl({
    frontendUrl: 'https://kalusagap.vercel.app/',
    tokenHash: 'one-time-hash',
    type: 'recovery',
  }));
  assert.equal(link.origin, 'https://kalusagap.vercel.app');
  assert.equal(link.pathname, '/reset-password');
  assert.equal(link.searchParams.get('token_hash'), 'one-time-hash');
  assert.equal(link.searchParams.get('type'), 'recovery');
  assert.equal(link.searchParams.has('token'), false);
});

test('personnel setup links keep their invitation action type', () => {
  const link = new URL(buildPasswordActionUrl({
    frontendUrl: 'https://kalusagap.vercel.app',
    tokenHash: 'one-time-hash',
    type: 'invite',
  }));
  assert.equal(link.searchParams.get('type'), 'invite');
});

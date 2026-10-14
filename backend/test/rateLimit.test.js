import assert from 'node:assert/strict';
import test from 'node:test';

import { getClientIdentifier } from '../src/middleware/rateLimit.js';

test('anonymous rate-limit keys use Express IP rather than the raw forwarded header', () => {
  const req = {
    ip: '203.0.113.9',
    headers: { 'x-forwarded-for': '198.51.100.1' },
  };

  assert.equal(getClientIdentifier(req), 'ip:203.0.113.9');
});

test('authenticated rate-limit keys use the verified account identity', () => {
  const req = {
    ip: '203.0.113.9',
    user: { id: 'verified-user-id' },
    headers: { 'x-forwarded-for': '198.51.100.1' },
  };

  assert.equal(getClientIdentifier(req), 'user:verified-user-id');
});

test('IPv6 addresses in the same subnet share an anonymous rate-limit key', () => {
  const first = getClientIdentifier({ ip: '2001:db8:abcd:12::1' });
  const second = getClientIdentifier({ ip: '2001:db8:abcd:12::2' });

  assert.equal(first, second);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveApiBaseUrl } from '../../src/services/api/apiBaseUrl.js';

test('production uses the documented backend URL when VITE_API_URL is unset', () => {
  assert.equal(resolveApiBaseUrl(undefined, true), 'https://kalusagap.onrender.com/api');
});

test('configured production API URLs override the safe default', () => {
  assert.equal(resolveApiBaseUrl('https://api.example.test', true), 'https://api.example.test/api');
});

test('development continues to use the same-origin API fallback when unset', () => {
  assert.equal(resolveApiBaseUrl(undefined, false), '/api');
});

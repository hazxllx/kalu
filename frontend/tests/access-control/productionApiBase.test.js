import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeApiBaseUrl, resolveApiBaseUrl } from '../../src/services/api/apiBaseUrl.js';

test('production fails closed when VITE_API_URL is unset', () => {
  assert.throws(() => resolveApiBaseUrl(undefined, true), /VITE_API_URL is required for production builds/);
});

test('configured production API URLs are normalized explicitly', () => {
  assert.equal(resolveApiBaseUrl('https://api.example.test', true), 'https://api.example.test/api');
});

test('development uses only the safe local backend when configuration is absent', () => {
  assert.equal(resolveApiBaseUrl(undefined, false), 'http://localhost:5000/api');
});

test('API configuration rejects relative and non-http URLs', () => {
  assert.throws(() => normalizeApiBaseUrl('/api'), /absolute http\(s\) URL/);
  assert.throws(() => normalizeApiBaseUrl('file:///tmp/api'), /must use http or https/);
});

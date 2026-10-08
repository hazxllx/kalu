import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeApiBaseUrl } from '../src/services/api/apiBaseUrl.js';

test('defaults to the same-origin API mount', () => {
  assert.equal(normalizeApiBaseUrl(undefined), '/api');
  assert.equal(normalizeApiBaseUrl(''), '/api');
});

test('adds the backend API mount to a bare deployment origin', () => {
  assert.equal(normalizeApiBaseUrl('https://kalusagap.onrender.com'), 'https://kalusagap.onrender.com/api');
});

test('preserves an API base URL that already includes the mount', () => {
  assert.equal(normalizeApiBaseUrl('https://kalusagap.onrender.com/api'), 'https://kalusagap.onrender.com/api');
  assert.equal(normalizeApiBaseUrl('https://kalusagap.onrender.com/api/'), 'https://kalusagap.onrender.com/api');
});

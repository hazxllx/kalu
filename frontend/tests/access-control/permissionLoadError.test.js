import assert from 'node:assert/strict';
import test from 'node:test';

import { permissionLoadErrorMessage } from '../../src/services/api/permissionLoadError.js';

test('permission load errors distinguish expired authentication', () => {
  assert.match(permissionLoadErrorMessage({ status: 401 }), /session is invalid or has expired/i);
});

test('permission load errors distinguish authorization failures', () => {
  assert.match(permissionLoadErrorMessage({ status: 403 }), /not authorized/i);
});

test('permission load errors identify a missing or misconfigured endpoint', () => {
  assert.match(permissionLoadErrorMessage({ status: 404 }), /API endpoint was not found/i);
  assert.match(permissionLoadErrorMessage(new TypeError('Invalid URL')), /API URL is invalid/i);
});

test('permission load errors distinguish server and network failures', () => {
  assert.match(permissionLoadErrorMessage({ status: 503 }), /server error \(HTTP 503\)/i);
  assert.match(permissionLoadErrorMessage(new TypeError('Failed to fetch')), /network, API URL, and CORS/i);
});

test('permission load errors provide a safe fallback for unknown failures', () => {
  assert.equal(
    permissionLoadErrorMessage(new Error()),
    'Role permissions could not be loaded. Please retry.',
  );
});

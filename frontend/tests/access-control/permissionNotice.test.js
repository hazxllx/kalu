import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasValidPermissionSnapshot,
  permissionNotice,
} from '../../src/services/accessControl/permissionAccess.js';

const now = 1_000;
const userId = 'user-1';
const cached = {
  userId,
  role: 'bhw',
  status: 'ready',
  source: 'cache',
  expiresAt: now + 100,
};

test('only offline use or failed server verification calls attention to a valid cached snapshot', () => {
  assert.equal(permissionNotice(cached, userId, true, now), null);
  assert.equal(permissionNotice(cached, userId, false, now), 'cached-offline');
  assert.equal(permissionNotice({ ...cached, failureKind: 'network' }, userId, true, now), 'cached-failed');
  assert.equal(permissionNotice({ ...cached, failureKind: 'network' }, userId, false, now), 'cached-offline');
  assert.equal(permissionNotice({ ...cached, source: 'server' }, userId, false, now), null);
});

test('expired or other-account cache cannot produce an offline access notice or a grant', () => {
  assert.equal(permissionNotice(cached, 'user-2', false, now), null);
  assert.equal(permissionNotice(cached, userId, false, now + 100), null);
  assert.equal(hasValidPermissionSnapshot(cached, userId, 'bhw', now + 100), false);
  assert.equal(permissionNotice({ ...cached, status: 'loading' }, userId, false, now), null);
});

test('session rejection stays distinct from service errors without using a cached grant', () => {
  assert.equal(permissionNotice({ userId, status: 'error', failureKind: 'auth' }, userId, true, now), 'auth');
  assert.equal(permissionNotice({ userId, status: 'error', failureKind: 'forbidden' }, userId, true, now), 'error');
  assert.equal(hasValidPermissionSnapshot({ ...cached, status: 'error' }, userId, 'bhw', now), false);
});

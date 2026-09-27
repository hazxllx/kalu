import test from 'node:test';
import assert from 'node:assert/strict';

import { effectiveRole, profileToSessionUser } from '../src/services/profile.service.js';

/**
 * Source-of-truth regression for the resident verification -> access chain.
 *
 * The whole "approve unlocks features" flow hinges on ONE rule: a resident's
 * served role is derived from `profiles.status`, not from any cached/session
 * value. When a Health Supervisor approves, `profiles.status` becomes 'active'
 * and the resident must be served as 'resident' (full access); while pending
 * they are 'resident-limited' (locked). `/api/auth/me` returns this, so a page
 * refresh that re-fetches the profile always reflects the current status.
 */

test('an approved resident (profiles.status=active) is served as full resident', () => {
  assert.equal(effectiveRole({ role: 'resident', status: 'active' }), 'resident');
});

test('a pending resident is served as resident-limited (locked)', () => {
  assert.equal(effectiveRole({ role: 'resident', status: 'pending_verification' }), 'resident-limited');
});

test('the limited sub-state resolves through profiles.status, not a stored flag', () => {
  // Same account, only the persisted status changed -> role flips. This is what
  // a post-approval refresh observes via /api/auth/me.
  const pending = profileToSessionUser({ id: 'u1', email: 'r@x.ph', role: 'resident', status: 'pending_verification' });
  const approved = profileToSessionUser({ id: 'u1', email: 'r@x.ph', role: 'resident', status: 'active' });
  assert.equal(pending.role, 'resident-limited');
  assert.equal(approved.role, 'resident');
});

test('staff roles are unaffected by the resident sub-state rule', () => {
  assert.equal(effectiveRole({ role: 'health_supervisor', status: 'active' }), 'health_supervisor');
  assert.equal(effectiveRole({ role: 'phn', status: 'active' }), 'phn');
  // A pending staff account keeps its role (it is blocked elsewhere, not downgraded).
  assert.equal(effectiveRole({ role: 'mho', status: 'pending_verification' }), 'mho');
});

test('a null profile has no role', () => {
  assert.equal(effectiveRole(null), null);
});

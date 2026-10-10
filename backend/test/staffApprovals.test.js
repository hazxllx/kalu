import test from 'node:test';
import assert from 'node:assert/strict';

import { approvableRolesFor, canApproveRole } from '../src/config/staffApprovals.js';

test('a Health Supervisor is authorized to approve BHW accounts', () => {
  assert.equal(canApproveRole('health_supervisor', 'bhw'), true);
  assert.ok(approvableRolesFor('health_supervisor').includes('bhw'));
});

test('a PHN cannot approve BHW accounts', () => {
  assert.equal(canApproveRole('phn', 'bhw'), false);
  assert.ok(!approvableRolesFor('phn').includes('bhw'));
});

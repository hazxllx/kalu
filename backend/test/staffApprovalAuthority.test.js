import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REQUESTABLE_ROLES,
  STAFF_APPROVALS,
  APPROVER_ROLES,
  canApproveRole,
  approvableRolesFor,
  approverLabelForRole,
} from '../src/config/staffApprovals.js';
import { registerPersonnelValidator } from '../src/validators/staffAccounts.validators.js';

/**
 * Operational account-approval authority.
 *
 * The rule the whole approval workflow rests on: a role may only be requested
 * through the personnel registration form when some operational officer is
 * able to approve it. `phn` and `mho` have no approver — they are provisioned
 * administratively — so accepting a request for them would create a row that
 * sits in nobody's queue forever.
 */

const basePayload = {
  fullName: 'Test Applicant',
  email: 'applicant@example.test',
  password: 'QaPassw0rd',
};

test('every requestable role has an operational approver', () => {
  for (const role of REQUESTABLE_ROLES) {
    const approvers = Object.keys(STAFF_APPROVALS).filter((approver) => canApproveRole(approver, role));
    assert.ok(approvers.length > 0, `${role} is requestable but nobody can approve it`);
  }
});

test('PHN and MHO are not requestable — they have no operational approver', () => {
  for (const role of ['phn', 'mho']) {
    assert.equal(
      REQUESTABLE_ROLES.includes(role),
      false,
      `${role} must not be requestable: no role may approve it`,
    );
    assert.equal(approverLabelForRole(role), null, `${role} has no approving officer to name`);
    assert.equal(
      Object.keys(STAFF_APPROVALS).some((approver) => canApproveRole(approver, role)),
      false,
    );
  }
});

test('registration validator rejects phn and mho requests', () => {
  for (const role of ['phn', 'mho']) {
    const result = registerPersonnelValidator({ ...basePayload, role });
    assert.ok(result.error, `${role} registration should be rejected: ${JSON.stringify(result)}`);
    assert.ok(result.error.role, `${role} should produce a role error`);
  }
});

test('registration validator accepts each requestable role', () => {
  for (const role of REQUESTABLE_ROLES) {
    const result = registerPersonnelValidator({ ...basePayload, role });
    assert.ok(result.value, `${role} registration should be accepted: ${JSON.stringify(result.error)}`);
    assert.equal(result.value.role, role);
  }
});

test('PHN approves Health Supervisor and RHU Personnel only', () => {
  assert.deepEqual(approvableRolesFor('phn'), ['health_supervisor', 'rhu_personnel']);
  assert.equal(canApproveRole('phn', 'health_supervisor'), true);
  assert.equal(canApproveRole('phn', 'rhu_personnel'), true);
  assert.equal(canApproveRole('phn', 'bhw'), false);
  assert.equal(canApproveRole('phn', 'resident'), false);
  assert.equal(canApproveRole('phn', 'phn'), false);
});

test('Health Supervisor approves BHW and Resident only', () => {
  assert.deepEqual(approvableRolesFor('health_supervisor'), ['bhw', 'resident']);
  assert.equal(canApproveRole('health_supervisor', 'bhw'), true);
  assert.equal(canApproveRole('health_supervisor', 'resident'), true);
  assert.equal(canApproveRole('health_supervisor', 'health_supervisor'), false);
  assert.equal(canApproveRole('health_supervisor', 'rhu_personnel'), false);
});

test('System Admin and MHO are never operational approvers', () => {
  for (const role of ['admin', 'mho']) {
    assert.equal(
      APPROVER_ROLES.includes(role),
      false,
      `${role} must not be an approval authority`,
    );
    for (const target of ['health_supervisor', 'rhu_personnel', 'bhw', 'resident']) {
      assert.equal(canApproveRole(role, target), false, `${role} must not approve ${target}`);
    }
  }
});

test('approverLabelForRole names the correct operational officer', () => {
  assert.equal(approverLabelForRole('health_supervisor'), 'Public Health Nurse');
  assert.equal(approverLabelForRole('rhu_personnel'), 'Public Health Nurse');
  assert.equal(approverLabelForRole('bhw'), 'Health Supervisor');
  assert.equal(approverLabelForRole('resident'), 'Health Supervisor');
});

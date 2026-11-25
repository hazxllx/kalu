import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyHouseholdEvent } from '../src/services/householdWorkflow.js';

test('returned household correction resubmission reuses the existing profile and notifies verification', () => {
  assert.deepEqual(classifyHouseholdEvent(
    { hhStatus: 'Submitted', verificationStatus: 'Returned for Correction' },
    { hhStatus: 'Submitted', verificationStatus: 'Pending Verification' },
  ), { action: 'HOUSEHOLD_RESUBMITTED', audience: 'supervisor' });
});

test('only household profiles returned for correction notify the submitting collector', () => {
  assert.deepEqual(classifyHouseholdEvent({}, { verificationStatus: 'Returned for Correction' }), {
    action: 'HOUSEHOLD_RETURNED', audience: 'collector',
  });
  assert.deepEqual(classifyHouseholdEvent({}, { verificationStatus: 'Verified' }), {
    action: 'HOUSEHOLD_VERIFIED', audience: 'none',
  });
});

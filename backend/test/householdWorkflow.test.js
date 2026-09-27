import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyHouseholdEvent } from '../src/services/householdWorkflow.js';

/**
 * Pure classification of household lifecycle transitions. The audit + notify
 * side effects are best-effort and no-op without Supabase, so only the pure
 * classifier is unit-tested here (it decides which event, if any, a patch is).
 */

test('a submit transition (Pending -> Submitted) is a submission to the supervisor', () => {
  const event = classifyHouseholdEvent({ hhStatus: 'Pending', verificationStatus: 'Pending Verification' }, { hhStatus: 'Submitted' });
  assert.deepEqual(event, { action: 'HOUSEHOLD_SUBMITTED', audience: 'supervisor' });
});

test('re-submitting after a return is a resubmission, not a first submission', () => {
  const event = classifyHouseholdEvent(
    { hhStatus: 'Needs Update', verificationStatus: 'Returned for Correction' },
    { hhStatus: 'Submitted' },
  );
  assert.deepEqual(event, { action: 'HOUSEHOLD_RESUBMITTED', audience: 'supervisor' });
});

test('re-saving an already-submitted household is not a new submission event', () => {
  const event = classifyHouseholdEvent({ hhStatus: 'Submitted', verificationStatus: 'Pending Verification' }, { hhStatus: 'Submitted' });
  assert.equal(event, null);
});

test('verifying notifies the collector', () => {
  const event = classifyHouseholdEvent({ hhStatus: 'Submitted', verificationStatus: 'Pending Verification' }, { verificationStatus: 'Verified' });
  assert.deepEqual(event, { action: 'HOUSEHOLD_VERIFIED', audience: 'collector' });
});

test('returning for correction notifies the collector', () => {
  const event = classifyHouseholdEvent(
    { hhStatus: 'Submitted', verificationStatus: 'Pending Verification' },
    { verificationStatus: 'Returned for Correction', correctionReason: 'Incomplete WASH data' },
  );
  assert.deepEqual(event, { action: 'HOUSEHOLD_RETURNED', audience: 'collector' });
});

test('a plain field edit is not a lifecycle event', () => {
  const event = classifyHouseholdEvent({ hhStatus: 'Ongoing', verificationStatus: 'Pending Verification' }, { contact: '09171234567' });
  assert.equal(event, null);
});

test('a verification outcome takes priority even if hh_status also changes', () => {
  const event = classifyHouseholdEvent(
    { hhStatus: 'Submitted', verificationStatus: 'Pending Verification' },
    { hhStatus: 'Approved', verificationStatus: 'Verified' },
  );
  assert.deepEqual(event, { action: 'HOUSEHOLD_VERIFIED', audience: 'collector' });
});

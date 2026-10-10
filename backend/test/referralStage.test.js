import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveStage, REFERRAL_STAGE } from '../src/config/referralStage.js';

/**
 * The referral progress stage is derived from the stored health_referrals status
 * PLUS the linked RHU encounter visit — reusing the 5 statuses rather than adding
 * new enum values. Completing triage must never read as consultation-completed;
 * only a completed visit does.
 */

test('no linked visit → awaiting RHU action', () => {
  assert.equal(deriveStage({ status: 'Pending' }, null).key, REFERRAL_STAGE.AWAITING_RHU);
});

test('a draft/submitted visit → resident arrived, triage', () => {
  assert.equal(deriveStage({ status: 'In Progress' }, { status: 'submitted' }).key, REFERRAL_STAGE.TRIAGE);
  assert.equal(deriveStage({ status: 'Pending' }, { status: 'draft' }).key, REFERRAL_STAGE.TRIAGE);
});

test('a received/in_review/referred visit → triage completed, awaiting consultation', () => {
  for (const s of ['received', 'in_review', 'referred']) {
    assert.equal(
      deriveStage({ status: 'In Progress' }, { status: s }).key,
      REFERRAL_STAGE.AWAITING_CONSULTATION,
    );
  }
});

test('only a completed visit (or Completed referral) reads as consultation completed', () => {
  assert.equal(
    deriveStage({ status: 'In Progress' }, { status: 'completed' }).key,
    REFERRAL_STAGE.CONSULTATION_COMPLETED,
  );
  assert.equal(deriveStage({ status: 'Completed' }, null).key, REFERRAL_STAGE.CONSULTATION_COMPLETED);
  // Triage finished is NOT consultation completed.
  assert.notEqual(
    deriveStage({ status: 'In Progress' }, { status: 'in_review' }).key,
    REFERRAL_STAGE.CONSULTATION_COMPLETED,
  );
});

test('a cancelled referral always reads cancelled', () => {
  assert.equal(deriveStage({ status: 'Cancelled' }, { status: 'completed' }).key, REFERRAL_STAGE.CANCELLED);
});

test('every stage has a human label', () => {
  assert.equal(typeof deriveStage({ status: 'Pending' }, null).label, 'string');
  assert.ok(deriveStage({ status: 'Pending' }, null).label.length > 0);
});

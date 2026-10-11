// KALUSAGAP — resident registration document-screening status rendering tests.
//
// Guards the backend-status -> UI-status -> label/tone mapping so a document
// that only reached MANUAL REVIEW is never shown as automatically verified /
// "accepted", and the submission-eligibility rules (staff-review workflow) stay
// intact.
//
// Run: node --test tests/registration/documentScreening.test.js

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SLOT_STATUS,
  mapScreeningStatus,
  slotStateFromScreening,
  slotStatusLabel,
  slotStatusTone,
  isSlotEligible,
  canSubmitDocuments,
  firstBlockingSlot,
} from '../../src/features/registration/documentScreening.js';

test('backend status maps to the correct UI slot status', () => {
  assert.equal(mapScreeningStatus('pending_manual_review'), SLOT_STATUS.PASSED);
  assert.equal(mapScreeningStatus('automated_flagged'), SLOT_STATUS.FLAGGED);
  assert.equal(mapScreeningStatus('automated_rejected'), SLOT_STATUS.REJECTED);
  assert.equal(mapScreeningStatus('something_else'), SLOT_STATUS.ERROR);
  assert.equal(mapScreeningStatus(undefined), SLOT_STATUS.ERROR);
});

test('a pending-manual-review document is labelled "Uploaded — Manual Review Required", not "Accepted"', () => {
  const slot = { status: SLOT_STATUS.PASSED };
  assert.equal(slotStatusLabel(slot), 'Uploaded — Manual Review Required');
  // Regression: it must never read as if the identity/document was verified.
  assert.doesNotMatch(slotStatusLabel(slot), /accepted|verified|approved/i);
});

test('pending-manual-review is informational, never a green "success/verified" tone', () => {
  assert.equal(slotStatusTone({ status: SLOT_STATUS.PASSED }), 'info');
  assert.notEqual(slotStatusTone({ status: SLOT_STATUS.PASSED }), 'success');
  assert.equal(slotStatusTone({ status: SLOT_STATUS.FLAGGED }), 'warning');
  assert.equal(slotStatusTone({ status: SLOT_STATUS.REJECTED }), 'danger');
});

test('distinct labels per status', () => {
  assert.equal(slotStatusLabel({ status: SLOT_STATUS.FLAGGED }), 'Manual Review Required');
  assert.equal(slotStatusLabel({ status: SLOT_STATUS.REJECTED }), 'Rejected — Action Required');
  assert.equal(slotStatusLabel({ status: SLOT_STATUS.CHECKING }), 'Checking document...');
  assert.equal(slotStatusLabel({ status: SLOT_STATUS.ERROR }), 'Screening unavailable — Retry');
  assert.equal(slotStatusLabel({ status: SLOT_STATUS.NOT_CHECKED }), 'Not checked');
});

test('slotStateFromScreening carries message + crossVerificationMessage and forces mismatch to rejected', () => {
  const flagged = slotStateFromScreening({
    status: 'automated_flagged',
    reason: 'ID_SIDE_FIELDS_CONFLICT',
    message: 'Some readable details on the front and back appear inconsistent.',
    crossVerificationMessage: 'Some readable details on the front and back appear inconsistent.',
  });
  assert.equal(flagged.status, SLOT_STATUS.FLAGGED);
  assert.equal(flagged.reason, 'ID_SIDE_FIELDS_CONFLICT');
  assert.ok(flagged.message.length > 0);

  const mismatch = slotStateFromScreening({
    status: 'pending_manual_review',
    reason: 'DOCUMENT_TYPE_MISMATCH',
    message: 'The uploaded document does not match the selected government ID type.',
  });
  assert.equal(mismatch.status, SLOT_STATUS.REJECTED, 'a type mismatch must block submission');
  assert.equal(mismatch.result.status, 'automated_rejected');
});

test('eligibility preserves the staff-review workflow (pending & flagged may submit; rejected/error/unchecked may not)', () => {
  assert.equal(isSlotEligible({ status: SLOT_STATUS.PASSED }), true);
  assert.equal(isSlotEligible({ status: SLOT_STATUS.FLAGGED }), true);
  assert.equal(isSlotEligible({ status: SLOT_STATUS.REJECTED }), false);
  assert.equal(isSlotEligible({ status: SLOT_STATUS.ERROR }), false);
  assert.equal(isSlotEligible({ status: SLOT_STATUS.NOT_CHECKED }), false);
  assert.equal(isSlotEligible({ status: SLOT_STATUS.CHECKING }), false);
});

test('canSubmitDocuments requires every required slot to be eligible', () => {
  const eligible = { status: SLOT_STATUS.PASSED };
  const ok = { governmentIdFront: eligible, governmentIdBack: { status: SLOT_STATUS.FLAGGED }, identityPhoto: eligible };
  assert.equal(canSubmitDocuments(ok), true);
  assert.equal(firstBlockingSlot(ok), null);

  const blocked = { ...ok, governmentIdBack: { status: SLOT_STATUS.REJECTED } };
  assert.equal(canSubmitDocuments(blocked), false);
  assert.equal(firstBlockingSlot(blocked), 'governmentIdBack');
});

test('identical front/back: the rejected back blocks submission and surfaces the replace instruction', () => {
  const identicalMsg = 'The front and back images appear to be identical. Please upload a separate image of the other side of your government ID.';
  const back = slotStateFromScreening({
    status: 'automated_rejected',
    reason: 'ID_SIDES_IDENTICAL',
    message: identicalMsg,
    crossVerificationMessage: identicalMsg,
  });
  const front = slotStateFromScreening({
    status: 'automated_flagged',
    reason: 'ID_SIDES_IDENTICAL',
    message: identicalMsg,
    crossVerificationMessage: identicalMsg,
  });
  assert.equal(back.status, SLOT_STATUS.REJECTED);
  assert.equal(back.message, identicalMsg);
  assert.equal(front.status, SLOT_STATUS.FLAGGED);
  // The back (the side to replace) must block submission; the front need not.
  assert.equal(isSlotEligible(back), false);
  assert.equal(isSlotEligible(front), true);

  const screening = { governmentIdFront: front, governmentIdBack: back, identityPhoto: { status: SLOT_STATUS.PASSED } };
  assert.equal(canSubmitDocuments(screening), false);
  assert.equal(firstBlockingSlot(screening), 'governmentIdBack');
});

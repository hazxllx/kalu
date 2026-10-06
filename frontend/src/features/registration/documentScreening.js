/**
 * Pure helpers for the resident registration document-screening UI state.
 *
 * Kept free of React so the same rules drive the upload cards, Step 3
 * validation and the final review page, and can be unit-tested. These helpers
 * only organise the deterministic result the backend already produced; they
 * never mark a document as verified. Final verification remains with staff.
 */

/** UI state for one document slot. */
export const SLOT_STATUS = Object.freeze({
  NOT_CHECKED: 'not_checked',
  CHECKING: 'checking',
  PASSED: 'passed', // backend pending_manual_review — eligible for staff review
  FLAGGED: 'flagged', // backend automated_flagged — eligible, needs attention
  REJECTED: 'rejected', // backend automated_rejected — must not be submitted
  ERROR: 'error', // screening request failed — must be retried
});

/** Slot key -> backend document type. Each slot is screened independently. */
export const SLOT_DOCUMENT_TYPE = Object.freeze({
  governmentIdFront: 'government_id_front',
  governmentIdBack: 'government_id_back',
  identityPhoto: 'identity_photo',
  studentId: 'student_id',
});

/** Slots that must be uploaded and pass screening before submission. */
export const REQUIRED_DOCUMENT_SLOTS = Object.freeze([
  'governmentIdFront',
  'governmentIdBack',
  'identityPhoto',
]);

export const SLOT_LABEL = Object.freeze({
  governmentIdFront: 'Government ID — Front',
  governmentIdBack: 'Government ID — Back',
  identityPhoto: 'Identity Photo',
  studentId: 'Student ID Verification',
});

export const initialSlotState = () => ({
  status: SLOT_STATUS.NOT_CHECKED,
  requestId: null,
  reason: '',
  message: '',
  result: null,
});

export const initialScreeningState = () => ({
  governmentIdFront: initialSlotState(),
  governmentIdBack: initialSlotState(),
  identityPhoto: initialSlotState(),
  studentId: initialSlotState(),
});

/** Backend screening status -> UI slot status. */
export const mapScreeningStatus = (status) => {
  switch (status) {
    case 'pending_manual_review':
      return SLOT_STATUS.PASSED;
    case 'automated_flagged':
      return SLOT_STATUS.FLAGGED;
    case 'automated_rejected':
      return SLOT_STATUS.REJECTED;
    default:
      return SLOT_STATUS.ERROR;
  }
};

export const slotStateFromScreening = (screening, requestId = null) => {
  if (!screening || !screening.status) return initialSlotState();
  const result = { ...screening };
  const status = screening.reason === 'DOCUMENT_TYPE_MISMATCH'
    ? SLOT_STATUS.REJECTED
    : mapScreeningStatus(screening.status);
  if (status === SLOT_STATUS.REJECTED && screening.reason === 'DOCUMENT_TYPE_MISMATCH') {
    result.status = 'automated_rejected';
  }
  return {
    status,
    requestId,
    reason: screening.reason || '',
    message: screening.message || '',
    crossVerificationMessage: screening.crossVerificationMessage || '',
    result,
  };
};

/**
 * A slot is eligible when screening passed or flagged it for manual review.
 * Rejected / not-checked / checking / error slots block submission.
 */
export const isSlotEligible = (slot) =>
  slot?.status === SLOT_STATUS.PASSED || slot?.status === SLOT_STATUS.FLAGGED;

export const isSlotBlocking = (slot) => !isSlotEligible(slot);

/** True only when every required document slot is eligible. */
export const canSubmitDocuments = (screening) =>
  REQUIRED_DOCUMENT_SLOTS.every((slot) => isSlotEligible(screening?.[slot]));

/** First blocking slot, or null when all required documents are eligible. */
export const firstBlockingSlot = (screening) =>
  REQUIRED_DOCUMENT_SLOTS.find((slot) => isSlotBlocking(screening?.[slot])) || null;

export const isCurrentScreeningRequest = (requestSequence, currentSequence) =>
  requestSequence === currentSequence;

/** Update only the slot that owns this still-current screening request. */
export const updateSlotForCurrentRequest = (
  screeningState,
  slot,
  requestId,
  currentRequestId,
  nextSlotState,
) => {
  if (!isCurrentScreeningRequest(requestId, currentRequestId)) return screeningState;
  return {
    ...screeningState,
    [slot]: { ...nextSlotState, requestId },
  };
};

/** Human-readable status for the review page / upload card. */
export const slotStatusLabel = (slot) => {
  switch (slot?.status) {
    case SLOT_STATUS.CHECKING:
      return 'Checking document...';
    case SLOT_STATUS.PASSED:
      return 'Accepted for Staff Review';
    case SLOT_STATUS.FLAGGED:
      return 'Manual Review Required';
    case SLOT_STATUS.REJECTED:
      return 'Rejected — Action Required';
    case SLOT_STATUS.ERROR:
      return 'Screening unavailable — Retry';
    default:
      return 'Not checked';
  }
};

/** Semantic tone for status styling: success | warning | danger | neutral. */
export const slotStatusTone = (slot) => {
  switch (slot?.status) {
    case SLOT_STATUS.PASSED:
      return 'success';
    case SLOT_STATUS.FLAGGED:
      return 'warning';
    case SLOT_STATUS.REJECTED:
    case SLOT_STATUS.ERROR:
      return 'danger';
    default:
      return 'neutral';
  }
};

/** Message shown when a required slot blocks submission. */
export const blockingSlotError = (slot) => {
  switch (slot?.status) {
    case SLOT_STATUS.REJECTED:
      return slot.message || 'The uploaded document was rejected. Please replace it with a clear copy.';
    case SLOT_STATUS.ERROR:
      return 'We could not check this document. Please retry screening.';
    case SLOT_STATUS.CHECKING:
      return 'This document is still being checked. Please wait a moment.';
    default:
      return 'Please upload this required document.';
  }
};

export default {
  SLOT_STATUS,
  SLOT_DOCUMENT_TYPE,
  REQUIRED_DOCUMENT_SLOTS,
  SLOT_LABEL,
  initialSlotState,
  initialScreeningState,
  mapScreeningStatus,
  slotStateFromScreening,
  updateSlotForCurrentRequest,
  isSlotEligible,
  isSlotBlocking,
  canSubmitDocuments,
  firstBlockingSlot,
  isCurrentScreeningRequest,
  slotStatusLabel,
  slotStatusTone,
  blockingSlotError,
};

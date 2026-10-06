import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SLOT_STATUS,
  SLOT_DOCUMENT_TYPE,
  REQUIRED_DOCUMENT_SLOTS,
  initialSlotState,
  initialScreeningState,
  slotStateFromScreening,
  isSlotEligible,
  canSubmitDocuments,
  firstBlockingSlot,
  isCurrentScreeningRequest,
  updateSlotForCurrentRequest,
  slotStatusLabel,
  slotStatusTone,
  blockingSlotError,
} from '../src/features/registration/documentScreening.js';
import { isPasswordReuseError } from '../src/features/registration/passwordErrors.js';
import {
  normalizeRegistrationEmail,
  signupResponseIssue,
} from '../src/features/registration/signupResponse.js';
import { isStrictMobile, digitsOnly } from '../src/utils/validation/index.js';

/**
 * Registration document-screening + mobile + password regression tests.
 *
 * These cover the exact bug reported: OCR text alone must not pass, a rejected
 * required document must block submission, replacement must clear stale
 * results, and the mobile/password rules must match the required formats.
 */

// ---------------------------------------------------------------------------
// Document screening slot helpers (frontend logic)
// ---------------------------------------------------------------------------

test('initial screening state has every required slot not_checked', () => {
  const state = initialScreeningState();
  assert.deepEqual(SLOT_DOCUMENT_TYPE, {
    governmentIdFront: 'government_id_front',
    governmentIdBack: 'government_id_back',
    identityPhoto: 'identity_photo',
    proofOfResidency: 'proof_of_residency',
  });
  for (const slot of REQUIRED_DOCUMENT_SLOTS) {
    assert.equal(state[slot].status, SLOT_STATUS.NOT_CHECKED);
  }
});

test('a rejected slot blocks submission; passed/flagged slots do not', () => {
  const rejected = { ...initialSlotState(), status: SLOT_STATUS.REJECTED };
  const passed = { ...initialSlotState(), status: SLOT_STATUS.PASSED };
  const flagged = { ...initialSlotState(), status: SLOT_STATUS.FLAGGED };
  assert.equal(isSlotEligible(rejected), false);
  assert.equal(isSlotEligible(passed), true);
  assert.equal(isSlotEligible(flagged), true);
});

test('REGRESSION — a Roblox-style rejected front blocks submission even if the back passed', () => {
  const state = initialScreeningState();
  state.governmentIdFront = { status: SLOT_STATUS.REJECTED, reason: 'NO_DOCUMENT_INDICATORS' };
  state.governmentIdBack = { status: SLOT_STATUS.PASSED };
  state.identityPhoto = { status: SLOT_STATUS.PASSED };
  assert.equal(canSubmitDocuments(state), false);
  assert.equal(firstBlockingSlot(state), 'governmentIdFront');
});

test('front rejected + back passed and front passed + back rejected both block', () => {
  const frontRejected = initialScreeningState();
  frontRejected.governmentIdFront = { status: SLOT_STATUS.REJECTED };
  frontRejected.governmentIdBack = { status: SLOT_STATUS.PASSED };
  frontRejected.identityPhoto = { status: SLOT_STATUS.PASSED };
  assert.equal(canSubmitDocuments(frontRejected), false);

  const backRejected = initialScreeningState();
  backRejected.governmentIdFront = { status: SLOT_STATUS.PASSED };
  backRejected.governmentIdBack = { status: SLOT_STATUS.REJECTED };
  backRejected.identityPhoto = { status: SLOT_STATUS.PASSED };
  assert.equal(canSubmitDocuments(backRejected), false);
});

test('both front and back passed/eligible allows submission', () => {
  const state = initialScreeningState();
  state.governmentIdFront = { status: SLOT_STATUS.PASSED };
  state.governmentIdBack = { status: SLOT_STATUS.FLAGGED };
  state.identityPhoto = { status: SLOT_STATUS.PASSED };
  state.proofOfResidency = { status: SLOT_STATUS.PASSED };
  assert.equal(canSubmitDocuments(state), true);
  assert.equal(firstBlockingSlot(state), null);
});

test('not_checked, checking and error all block submission (uploaded != verified)', () => {
  for (const status of [SLOT_STATUS.NOT_CHECKED, SLOT_STATUS.CHECKING, SLOT_STATUS.ERROR]) {
    const state = initialScreeningState();
    state.governmentIdFront = { status };
    state.governmentIdBack = { status: SLOT_STATUS.PASSED };
    state.identityPhoto = { status: SLOT_STATUS.PASSED };
    state.proofOfResidency = { status: SLOT_STATUS.PASSED };
    assert.equal(canSubmitDocuments(state), false, `${status} must block`);
  }
});

test('replacement clears the old result and a new result is used independently', () => {
  const state = initialScreeningState();
  state.governmentIdFront = { status: SLOT_STATUS.REJECTED, reason: 'NO_DOCUMENT_INDICATORS' };
  // Replace: clear the old slot result, then a fresh screen result arrives.
  state.governmentIdFront = { status: SLOT_STATUS.CHECKING };
  assert.equal(state.governmentIdFront.status, SLOT_STATUS.CHECKING);
  assert.equal(canSubmitDocuments(state), false);
  // New (valid) result for the SAME slot:
  state.governmentIdFront = { status: SLOT_STATUS.PASSED };
  state.governmentIdBack = { status: SLOT_STATUS.PASSED };
  state.identityPhoto = { status: SLOT_STATUS.PASSED };
  state.proofOfResidency = { status: SLOT_STATUS.PASSED };
  assert.equal(canSubmitDocuments(state), true);
});

test('same file used in multiple slots keeps independent results', () => {
  // Both slots hold a file; each is evaluated by ITS OWN result.
  const state = initialScreeningState();
  state.governmentIdFront = { status: SLOT_STATUS.REJECTED };
  state.governmentIdBack = { status: SLOT_STATUS.PASSED };
  state.identityPhoto = { status: SLOT_STATUS.PASSED };
  assert.equal(state.governmentIdFront.status, SLOT_STATUS.REJECTED);
  assert.equal(state.governmentIdBack.status, SLOT_STATUS.PASSED);
  assert.equal(canSubmitDocuments(state), false);
});

test('slot status labels and tones are stable', () => {
  assert.equal(slotStatusLabel({ status: SLOT_STATUS.REJECTED }), 'Rejected — Action Required');
  assert.equal(slotStatusLabel({ status: SLOT_STATUS.PASSED }), 'Ready for Review');
  assert.equal(slotStatusTone({ status: SLOT_STATUS.PASSED }), 'success');
  assert.equal(slotStatusTone({ status: SLOT_STATUS.FLAGGED }), 'warning');
  assert.equal(slotStatusTone({ status: SLOT_STATUS.REJECTED }), 'danger');
  assert.equal(blockingSlotError({ status: SLOT_STATUS.REJECTED, message: 'The uploaded image does not appear to contain the required identification document information.' }),
    'The uploaded image does not appear to contain the required identification document information.');
});

test('backend screening status maps to UI slot status', () => {
  assert.equal(slotStateFromScreening({ status: 'pending_manual_review' }).status, SLOT_STATUS.PASSED);
  assert.equal(slotStateFromScreening({ status: 'automated_flagged' }).status, SLOT_STATUS.FLAGGED);
  assert.equal(slotStateFromScreening({ status: 'automated_rejected' }).status, SLOT_STATUS.REJECTED);
});

test('review-ready and rejected UI states stay consistent with their current message', () => {
  const reviewReady = slotStateFromScreening({
    status: 'pending_manual_review',
    reason: 'DOCUMENT_SIDE_INCONCLUSIVE',
    message: 'We could not automatically identify this ID side. It may require staff review.',
  });
  assert.equal(slotStatusLabel(reviewReady), 'Ready for Review');
  assert.doesNotMatch(reviewReady.message, /does not match/i);

  const inconsistentLegacyResult = slotStateFromScreening({
    status: 'pending_manual_review',
    reason: 'DOCUMENT_TYPE_MISMATCH',
    message: 'The uploaded document does not match the selected government ID type. Please upload the selected ID.',
  });
  assert.equal(inconsistentLegacyResult.status, SLOT_STATUS.REJECTED);
  assert.equal(slotStatusLabel(inconsistentLegacyResult), 'Rejected — Action Required');
  assert.match(blockingSlotError(inconsistentLegacyResult), /does not match/i);
  assert.equal(inconsistentLegacyResult.result.status, 'automated_rejected');
});

test('an old screening response cannot overwrite the latest replacement request', () => {
  assert.equal(isCurrentScreeningRequest(4, 4), true);
  assert.equal(isCurrentScreeningRequest(3, 4), false);
});

test('replacing an identity photo invalidates its previous result and request', () => {
  const previous = initialScreeningState();
  previous.identityPhoto = slotStateFromScreening({
    status: 'pending_manual_review',
    reason: 'old-photo',
    message: 'Old photo result',
  }, 1);
  const replacement = updateSlotForCurrentRequest(
    previous,
    'identityPhoto',
    2,
    2,
    { ...initialSlotState(), status: SLOT_STATUS.CHECKING },
  );
  assert.equal(replacement.identityPhoto.status, SLOT_STATUS.CHECKING);
  assert.equal(replacement.identityPhoto.result, null);
  assert.equal(replacement.identityPhoto.requestId, 2);
  assert.equal(updateSlotForCurrentRequest(
    replacement,
    'identityPhoto',
    1,
    2,
    slotStateFromScreening({ status: 'automated_rejected', message: 'stale' }, 1),
  ), replacement);
});

test('a delayed residency result or error updates only the residency upload slot', () => {
  const state = initialScreeningState();
  state.identityPhoto = slotStateFromScreening({
    status: 'pending_manual_review',
    reason: 'IMAGE_REQUIRES_MANUAL_REVIEW',
    message: 'We could not automatically verify this photo. It may require staff review.',
  }, 1);

  const residencyResult = updateSlotForCurrentRequest(
    state,
    'proofOfResidency',
    1,
    1,
    slotStateFromScreening({
      status: 'automated_rejected',
      reason: 'NO_DOCUMENT_INDICATORS',
      message: 'Residency-specific rejection',
    }, 1),
  );
  assert.equal(residencyResult.identityPhoto.message, state.identityPhoto.message);
  assert.equal(residencyResult.proofOfResidency.status, SLOT_STATUS.REJECTED);

  const residencyError = updateSlotForCurrentRequest(
    residencyResult,
    'proofOfResidency',
    2,
    2,
    { ...initialSlotState(), status: SLOT_STATUS.ERROR, message: 'Residency request failed' },
  );
  assert.equal(residencyError.identityPhoto.status, SLOT_STATUS.PASSED);
  assert.equal(residencyError.identityPhoto.message, state.identityPhoto.message);
  assert.equal(residencyError.proofOfResidency.message, 'Residency request failed');
});

test('a delayed front-side response cannot overwrite the back-side result', () => {
  const state = initialScreeningState();
  state.governmentIdBack = slotStateFromScreening({
    status: 'pending_manual_review',
    reason: 'DOCUMENT_SIDE_INCONCLUSIVE',
    message: 'Back-side review',
  }, 1);
  const next = updateSlotForCurrentRequest(
    state,
    'governmentIdFront',
    3,
    3,
    slotStateFromScreening({
      status: 'automated_rejected',
      reason: 'NO_DOCUMENT_INDICATORS',
      message: 'Front-side rejection',
    }, 3),
  );
  assert.equal(next.governmentIdFront.status, SLOT_STATUS.REJECTED);
  assert.equal(next.governmentIdBack.status, SLOT_STATUS.PASSED);
  assert.equal(next.governmentIdBack.message, 'Back-side review');
});

test('registration email normalization trims whitespace and lowercases', () => {
  assert.equal(normalizeRegistrationEmail('  Resident.Example@Example.COM  '), 'resident.example@example.com');
});

test('signup response explicitly identifies duplicate email errors and obfuscated users', () => {
  assert.equal(signupResponseIssue({
    error: { code: 'user_already_exists', message: 'User already registered' },
    email: 'resident@example.com',
  }), 'duplicate_email');
  assert.equal(signupResponseIssue({
    data: {
      user: {
        id: 'auth-user-id',
        email: 'resident@example.com',
        identities: [],
      },
    },
    email: '  RESIDENT@EXAMPLE.COM  ',
  }), 'duplicate_email');
});

test('signup response permits a valid new signup and fails closed on malformed data', () => {
  assert.equal(signupResponseIssue({
    data: {
      user: {
        id: 'auth-user-id',
        email: 'resident@example.com',
        identities: [{ identity_id: 'identity-id' }],
      },
    },
    email: ' RESIDENT@EXAMPLE.COM ',
  }), null);
  assert.equal(signupResponseIssue({ data: {}, email: 'resident@example.com' }), 'invalid_response');
  assert.equal(signupResponseIssue({
    data: { user: { id: 'auth-user-id', email: 'resident@example.com' } },
    email: 'resident@example.com',
  }), 'invalid_response');
  assert.equal(signupResponseIssue({
    error: { message: 'Auth service unavailable' },
    email: 'resident@example.com',
  }), 'signup_failed');
});

// ---------------------------------------------------------------------------
// Mobile number: exactly 11 digits, starts 09, stored as a string
// ---------------------------------------------------------------------------

test('mobile accepts 09123456789 and 09987654321', () => {
  assert.equal(isStrictMobile('09123456789'), true);
  assert.equal(isStrictMobile('09987654321'), true);
});

test('mobile rejects 10 or 12 digits', () => {
  assert.equal(isStrictMobile('0912345678'), false);
  assert.equal(isStrictMobile('091234567890'), false);
});

test('mobile rejects +63, 63, separators, spaces and letters', () => {
  assert.equal(isStrictMobile('+639123456789'), false);
  assert.equal(isStrictMobile('639123456789'), false);
  assert.equal(isStrictMobile('09-1234-56789'), false);
  assert.equal(isStrictMobile('09 1234 56789'), false);
  assert.equal(isStrictMobile('abcdefghijk'), false);
});

test('digitsOnly strips formatting so the field only ever holds digits', () => {
  assert.equal(digitsOnly('+63 912 345 6789'), '639123456789');
  assert.equal(digitsOnly('09-1234-56789'), '09123456789');
  assert.equal(digitsOnly('abc'), '');
});

// ---------------------------------------------------------------------------
// Password: registration must not surface the password-CHANGE reuse error
// ---------------------------------------------------------------------------

test('isPasswordReuseError recognises Supabase password-reuse errors', () => {
  assert.equal(isPasswordReuseError('New password should be different from the old password.'), true);
  assert.equal(isPasswordReuseError('Password should be different from the old password.'), true);
});

test('isPasswordReuseError leaves real password errors untouched', () => {
  assert.equal(isPasswordReuseError('Password should be at least 8 characters.'), false);
  assert.equal(isPasswordReuseError(''), false);
});

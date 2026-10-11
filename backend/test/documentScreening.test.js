// KALUSAGAP — government ID & identity-photo screening regression tests.
//
// Covers the two reported defects and their fixes:
//   Bug A: both ID sides were forced to "Manual Review Required" with a
//          "could not compare enough information across both sides" message
//          whenever the sides shared no comparable OCR fields (the normal case).
//   Bug B: identity photos were messaged as if automated verification failed.
// Plus: unsupported ID type routes to manual review (not a misleading failure),
//       OCR failure never auto-rejects, and a genuine type mismatch is rejected.
//
// Deterministic: OCR is injected, images are generated in-memory. No network.
// Run: node --test test/documentScreening.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';

import {
  screenDocument,
  crossVerifyGovernmentIdSides,
  applyGovernmentIdCrossVerification,
  hashImageBuffer,
  buffersAreIdentical,
  applyIdenticalIdSides,
} from '../src/services/documentVerification.service.js';
import {
  screenUploadedGovernmentIdPair,
} from '../src/services/documents.service.js';
import {
  SCREENING_STATUS,
  SCREENING_REASON,
  SCREENING_MESSAGES,
} from '../src/config/documentScreening.js';

// A readable mid-contrast PNG (checkerboard) that passes the image-quality
// gate: 800x500, mean ~130, contrast ~70, no dark/bright domination.
const makeReadablePng = (w = 800, h = 500, cell = 3) => {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = ((w * y) + x) << 2;
      const v = (((x >> cell) + (y >> cell)) % 2 === 0) ? 60 : 200;
      png.data[idx] = v;
      png.data[idx + 1] = v;
      png.data[idx + 2] = v;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
};

const PNG_BUFFER = makeReadablePng();
const PNG_BUFFER_DIFFERENT = makeReadablePng(800, 500, 5); // different content
const okOcr = (text) => async () => ({ ok: true, text, confidence: 90 });
const failOcr = async () => ({ ok: false, text: '' });
const blob = (buf) => new Blob([buf], { type: 'image/png' });

// ---------------------------------------------------------------------------
// Bug B — identity photo
// ---------------------------------------------------------------------------

test('identity photo: uploaded image routes to manual review with an honest, non-failure message', async () => {
  const result = await screenDocument({
    buffer: PNG_BUFFER,
    mimeType: 'image/png',
    documentType: 'identity_photo',
    sizeBytes: PNG_BUFFER.length,
  });
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.IMAGE_REQUIRES_MANUAL_REVIEW);
  assert.equal(result.message, SCREENING_MESSAGES.IDENTITY_PHOTO_UPLOADED);
  // It must NOT claim the photo was verified or imply failure.
  assert.doesNotMatch(result.message, /could not automatically verify/i);
  assert.match(result.message, /uploaded successfully/i);
  assert.equal(result.ocrDetected, false);
});

// ---------------------------------------------------------------------------
// Bug A — cross-side comparison (pure functions)
// ---------------------------------------------------------------------------

test('crossVerify: no overlapping labelled fields => inconclusive (nothing to compare)', () => {
  const front = 'Republic of the Philippines PhilSys Juan Dela Cruz Date of Birth 1990/01/02';
  const back = 'QR code zone restrictions emergency contact';
  const cmp = crossVerifyGovernmentIdSides(front, back);
  assert.equal(cmp.status, 'inconclusive');
  assert.equal(cmp.comparedFields.length, 0);
  assert.equal(cmp.conflictingFields.length, 0);
});

test('applyCrossVerification: inconclusive keeps each side\'s own result and never flags or warns about comparison', () => {
  const side = (reason) => ({
    status: SCREENING_STATUS.PENDING_MANUAL_REVIEW,
    reason,
    quality: 'VALID',
    ocrDetected: true,
    message: SCREENING_MESSAGES.PASSED,
  });
  const { front, back } = applyGovernmentIdCrossVerification(
    side(SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED),
    side(SCREENING_REASON.DOCUMENT_SIDE_INCONCLUSIVE),
    { status: 'inconclusive', comparedFields: [], conflictingFields: [] },
  );
  // Status/reason unchanged — NOT downgraded to flagged.
  assert.equal(front.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(back.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.notEqual(front.reason, SCREENING_REASON.ID_SIDE_COMPARISON_INCONCLUSIVE);
  // No second user-facing paragraph for a benign "nothing to compare" result:
  // the side's own message stands alone (avoids duplicate "staff will review").
  assert.equal(front.crossVerificationMessage, '');
  assert.doesNotMatch(String(front.crossVerificationMessage), /could not compare enough information/i);
  // The descriptive note is still retained in metadata for staff/audit only.
  assert.equal(front.crossVerification.message, SCREENING_MESSAGES.ID_SIDE_COMPARISON_NOT_APPLICABLE);
  // Each side keeps its own user-facing message.
  assert.equal(front.message, SCREENING_MESSAGES.PASSED);
});

test('crossVerify: matching names on both sides => consistent', () => {
  const front = 'Surname: Dela Cruz Given Names: Juan Santos';
  const back = 'Surname: Dela Cruz Given Names: Juan Santos';
  const cmp = crossVerifyGovernmentIdSides(front, back);
  assert.equal(cmp.status, 'consistent');
  assert.ok(cmp.comparedFields.length > 0);
  assert.equal(cmp.conflictingFields.length, 0);
});

test('crossVerify: conflicting comparable fields => conflict, and both sides are flagged', () => {
  const front = 'Surname: Dela Cruz Given Names: Juan';
  const back = 'Surname: Reyes Given Names: Pedro';
  const cmp = crossVerifyGovernmentIdSides(front, back);
  assert.equal(cmp.status, 'conflict');
  assert.ok(cmp.conflictingFields.length > 0);

  const side = {
    status: SCREENING_STATUS.PENDING_MANUAL_REVIEW,
    reason: SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED,
    message: SCREENING_MESSAGES.PASSED,
  };
  const { front: f, back: b } = applyGovernmentIdCrossVerification({ ...side }, { ...side }, cmp);
  assert.equal(f.status, SCREENING_STATUS.AUTOMATED_FLAGGED);
  assert.equal(b.status, SCREENING_STATUS.AUTOMATED_FLAGGED);
  assert.equal(f.reason, SCREENING_REASON.ID_SIDE_FIELDS_CONFLICT);
  assert.equal(f.crossVerificationMessage, SCREENING_MESSAGES.ID_SIDE_FIELDS_CONFLICT);
});

test('applyCrossVerification: consistent promotes a borderline flagged side to plain manual review', () => {
  const flaggedSide = {
    status: SCREENING_STATUS.AUTOMATED_FLAGGED,
    reason: SCREENING_REASON.DOCUMENT_SIDE_INCONCLUSIVE,
    message: SCREENING_MESSAGES.DOCUMENT_SIDE_INCONCLUSIVE,
  };
  const { back } = applyGovernmentIdCrossVerification(
    { status: SCREENING_STATUS.PENDING_MANUAL_REVIEW, reason: SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED },
    flaggedSide,
    { status: 'consistent', comparedFields: ['surname'], conflictingFields: [] },
  );
  assert.equal(back.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
});

// ---------------------------------------------------------------------------
// Supported / unsupported / unreadable / mismatch (engine)
// ---------------------------------------------------------------------------

test('supported ID (philsys) with readable indicators routes to manual review, not rejection', async () => {
  const result = await screenDocument({
    buffer: PNG_BUFFER,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'philsys',
    sizeBytes: PNG_BUFFER.length,
    ocr: okOcr('Republic of the Philippines Philippine Identification System Juan Dela Cruz Date of Birth 1990 01 02'),
  });
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.notEqual(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
});

test('unsupported ID type ("other") routes to manual review with an "unavailable" message, never a failure', async () => {
  const result = await screenDocument({
    buffer: PNG_BUFFER,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'other',
    sizeBytes: PNG_BUFFER.length,
    ocr: okOcr('Some company identification card membership number 12345 issued to the bearer'),
  });
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.ID_TYPE_UNSUPPORTED);
  assert.equal(result.message, SCREENING_MESSAGES.ID_TYPE_UNSUPPORTED);
  assert.match(result.message, /unavailable for this ID type/i);
});

test('OCR failure on a supported ID never auto-rejects — it routes to manual review', async () => {
  const result = await screenDocument({
    buffer: PNG_BUFFER,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'philsys',
    sizeBytes: PNG_BUFFER.length,
    ocr: failOcr,
  });
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.notEqual(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.OCR_UNAVAILABLE);
});

test('a genuine type mismatch (selected postal ID, OCR shows a passport) is still rejected', async () => {
  const result = await screenDocument({
    buffer: PNG_BUFFER,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'postal_id',
    sizeBytes: PNG_BUFFER.length,
    ocr: okOcr('Republic of the Philippines Philippine Passport Passport No P1234567A'),
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_TYPE_MISMATCH);
});

// ---------------------------------------------------------------------------
// Identical front/back detection (SHA-256 content hashing)
// ---------------------------------------------------------------------------

test('content hashing compares bytes, not filenames/size/MIME', () => {
  assert.equal(hashImageBuffer(PNG_BUFFER), hashImageBuffer(Buffer.from(PNG_BUFFER)));
  assert.notEqual(hashImageBuffer(PNG_BUFFER), hashImageBuffer(PNG_BUFFER_DIFFERENT));
  assert.equal(buffersAreIdentical(PNG_BUFFER, Buffer.from(PNG_BUFFER)), true);
  assert.equal(buffersAreIdentical(PNG_BUFFER, PNG_BUFFER_DIFFERENT), false);
  assert.equal(buffersAreIdentical(PNG_BUFFER, Buffer.concat([PNG_BUFFER, Buffer.from([0])])), false);
  assert.equal(buffersAreIdentical(PNG_BUFFER, 'not a buffer'), false);
});

test('applyIdenticalIdSides: back is rejected for replacement, front is flagged, both carry the identical message', () => {
  const side = (reason) => ({
    status: SCREENING_STATUS.PENDING_MANUAL_REVIEW,
    reason,
    quality: 'VALID',
    ocrDetected: true,
    message: SCREENING_MESSAGES.PASSED,
  });
  const { front, back, overridden } = applyIdenticalIdSides(
    side(SCREENING_REASON.NO_DOCUMENT_INDICATORS),
    side(SCREENING_REASON.DOCUMENT_SIDE_INCONCLUSIVE),
  );
  assert.equal(overridden, true);
  assert.equal(back.status, SCREENING_STATUS.AUTOMATED_REJECTED, 'back must block submission');
  assert.equal(front.status, SCREENING_STATUS.AUTOMATED_FLAGGED, 'front stays submittable; only one side replaced');
  assert.equal(front.reason, SCREENING_REASON.ID_SIDES_IDENTICAL);
  assert.equal(back.reason, SCREENING_REASON.ID_SIDES_IDENTICAL);
  assert.equal(back.message, SCREENING_MESSAGES.ID_SIDES_IDENTICAL);
  assert.match(back.message, /appear to be identical/i);
});

test('applyIdenticalIdSides: a genuine file/upload failure takes precedence over identical', () => {
  const corruptFront = { status: SCREENING_STATUS.AUTOMATED_REJECTED, reason: SCREENING_REASON.CORRUPTED_FILE };
  const okBack = { status: SCREENING_STATUS.PENDING_MANUAL_REVIEW, reason: SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED };
  const { front, back, overridden } = applyIdenticalIdSides(corruptFront, okBack);
  assert.equal(overridden, false);
  assert.equal(front.reason, SCREENING_REASON.CORRUPTED_FILE);
  assert.notEqual(back.reason, SCREENING_REASON.ID_SIDES_IDENTICAL);
});

test('pair screen: same image (identical content) => front flagged, back rejected with the identical message', async () => {
  const pair = await screenUploadedGovernmentIdPair({
    frontFile: blob(PNG_BUFFER),
    backFile: blob(Buffer.from(PNG_BUFFER)), // identical bytes, independent Blob (any filename)
    governmentIdType: 'philsys',
    ocr: okOcr('Republic of the Philippines Philippine Identification System'),
  });
  assert.equal(pair.front.status, SCREENING_STATUS.AUTOMATED_FLAGGED);
  assert.equal(pair.back.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(pair.front.reason, SCREENING_REASON.ID_SIDES_IDENTICAL);
  assert.equal(pair.back.reason, SCREENING_REASON.ID_SIDES_IDENTICAL);
  assert.equal(pair.back.message, SCREENING_MESSAGES.ID_SIDES_IDENTICAL);
});

test('pair screen: different images => NOT treated as identical', async () => {
  const pair = await screenUploadedGovernmentIdPair({
    frontFile: blob(PNG_BUFFER),
    backFile: blob(PNG_BUFFER_DIFFERENT),
    governmentIdType: 'philsys',
    ocr: okOcr('Republic of the Philippines Philippine Identification System'),
  });
  assert.notEqual(pair.front.reason, SCREENING_REASON.ID_SIDES_IDENTICAL);
  assert.notEqual(pair.back.reason, SCREENING_REASON.ID_SIDES_IDENTICAL);
  assert.notEqual(pair.back.status, SCREENING_STATUS.AUTOMATED_REJECTED);
});

test('replace flow: identical pair blocks, then replacing one side with a distinct image clears it', async () => {
  const identical = await screenUploadedGovernmentIdPair({
    frontFile: blob(PNG_BUFFER),
    backFile: blob(Buffer.from(PNG_BUFFER)),
    governmentIdType: 'philsys',
    ocr: okOcr('Republic of the Philippines Philippine Identification System'),
  });
  assert.equal(identical.back.status, SCREENING_STATUS.AUTOMATED_REJECTED);

  // Applicant replaces the back with a genuinely different image and re-screens.
  const afterReplace = await screenUploadedGovernmentIdPair({
    frontFile: blob(PNG_BUFFER),
    backFile: blob(PNG_BUFFER_DIFFERENT),
    governmentIdType: 'philsys',
    ocr: okOcr('Republic of the Philippines Philippine Identification System'),
  });
  assert.notEqual(afterReplace.back.reason, SCREENING_REASON.ID_SIDES_IDENTICAL);
  assert.notEqual(afterReplace.back.status, SCREENING_STATUS.AUTOMATED_REJECTED);
});

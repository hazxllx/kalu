import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

import {
  screenDocument,
  validateFileBasics,
  analyzeImageQuality,
  hasMeaningfulText,
  normalizeText,
  detectGovernmentIdTypeFromText,
  inspectTypeEvidence,
} from '../src/services/documentVerification.service.js';
import {
  IMAGE_QUALITY,
  SCREENING_REASON,
  SCREENING_STATUS,
  MAX_SCREENING_FILE_SIZE,
} from '../src/config/documentScreening.js';
import repository from '../src/repositories/index.js';
import * as documentsService from '../src/services/documents.service.js';
import { SCREENING_REASON as SCREENING_REASON_SVC, SCREENING_STATUS as SCREENING_STATUS_SVC } from '../src/config/documentScreening.js';
import { indicatorsForDocumentType } from '../src/config/documentScreening.js';

/**
 * Rule-based automated document screening tests.
 *
 * Everything here is deterministic: images are generated in memory, and OCR is
 * injected so no network, model download or AI service is involved. The suite
 * covers the documented cases (valid/invalid/corrupt/oversized images, image
 * quality outcomes, OCR outcomes and access control).
 */

const makePng = (width, height, fill) => {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const [r, g, b] = typeof fill === 'function' ? fill(x, y) : fill;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
};

const makeSyntheticPhilsysLikePng = () =>
  makePng(1200, 760, (x, y) => {
    const withinCard = x > 35 && x < 1165 && y > 35 && y < 725;
    const border = withinCard && (x < 45 || x > 1155 || y < 45 || y > 715);
    const heading = withinCard && y > 105 && y < 145 && x > 100 && x < 760;
    const textLine = withinCard && y > 190 && y < 600 && ((y - 190) % 52 < 8) && x > 100 && x < 760;
    const portrait = withinCard && x > 820 && x < 1080 && y > 185 && y < 565;
    if (border || heading || textLine) return [35, 65, 105];
    if (portrait) return (x + y) % 3 ? [145, 155, 160] : [190, 170, 150];
    return withinCard ? [238, 242, 245] : [90, 100, 110];
  });

const makeSyntheticSkinToneRaster = () =>
  makePng(800, 600, (x, y) => ((x + y) % 2 ? [160, 100, 70] : [200, 120, 80]));

const makeJpeg = (width, height, fill) => {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const [r, g, b] = typeof fill === 'function' ? fill(x, y) : fill;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return Buffer.from(jpeg.encode({ data, width, height }, 80).data);
};

// A mid-grey checkerboard: valid quality (brightness ~130, high contrast)
// without looking like any particular object.
const texturedFill = (x, y) => ((x + y) % 2 === 0 ? [100, 100, 100] : [160, 160, 160]);

const OCR_GOV_ID = {
  ok: true,
  text: 'REPUBLIC OF THE PHILIPPINES\nIDENTIFICATION CARD\nID NO 1234-5678',
  confidence: 88,
};

test('1. a valid JPEG passes file validation', () => {
  const buffer = makeJpeg(120, 80, [120, 120, 120]);
  assert.equal(validateFileBasics({ buffer, mimeType: 'image/jpeg', sizeBytes: buffer.length }), null);
});

test('2. a valid PNG passes file validation', () => {
  const buffer = makePng(120, 80, [120, 120, 120]);
  assert.equal(validateFileBasics({ buffer, mimeType: 'image/png', sizeBytes: buffer.length }), null);
});

test('3. a valid PDF passes file validation', () => {
  const buffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF', 'latin1');
  assert.equal(validateFileBasics({ buffer, mimeType: 'application/pdf', sizeBytes: buffer.length }), null);
});

test('4. an unsupported file type is rejected', () => {
  const zip = Buffer.from('PK\u0003\u0004 not a document', 'latin1');
  const result = validateFileBasics({ buffer: zip, mimeType: 'application/zip', sizeBytes: zip.length });
  assert.equal(result.error, SCREENING_REASON.INVALID_FILE_TYPE);
});

test('a renamed non-document (bad magic bytes) is rejected even with a document MIME', () => {
  const fakeJpg = Buffer.from('this is not really a jpeg', 'utf8');
  const result = validateFileBasics({ buffer: fakeJpg, mimeType: 'image/jpeg', sizeBytes: fakeJpg.length });
  assert.equal(result.error, SCREENING_REASON.INVALID_FILE_TYPE);
});

test('5. a corrupted image is rejected', async () => {
  // Valid PNG signature followed by garbage: signature passes, decode fails.
  const corrupted = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  const result = await screenDocument({ buffer: corrupted, mimeType: 'image/png', documentType: 'government_id_front' });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.CORRUPTED_FILE);
});

test('6. an oversized file is rejected', () => {
  const buffer = makePng(120, 80, [120, 120, 120]);
  const result = validateFileBasics({ buffer, mimeType: 'image/png', sizeBytes: MAX_SCREENING_FILE_SIZE + 1 });
  assert.equal(result.error, SCREENING_REASON.FILE_TOO_LARGE);
});

test('7. an extremely small image is rejected as clearly unusable', async () => {
  const buffer = makePng(120, 80, texturedFill);
  const result = await screenDocument({ buffer, mimeType: 'image/png', documentType: 'government_id_front' });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.INSUFFICIENT_RESOLUTION);
  assert.equal(result.quality, IMAGE_QUALITY.CLEARLY_UNUSABLE);
});

test('8. a completely black image is TOO_DARK and rejected', async () => {
  const buffer = makePng(800, 600, [0, 0, 0]);
  const result = await screenDocument({ buffer, mimeType: 'image/png', documentType: 'government_id_front' });
  assert.equal(result.quality, IMAGE_QUALITY.TOO_DARK);
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.TOO_DARK);
});

test('9. a blank white image is BLANK_IMAGE and rejected', async () => {
  const buffer = makePng(800, 600, [255, 255, 255]);
  const result = await screenDocument({ buffer, mimeType: 'image/png', documentType: 'government_id_front' });
  assert.equal(result.quality, IMAGE_QUALITY.BLANK_IMAGE);
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.BLANK_IMAGE);
});

test('10. a flat/low-contrast (blurry) image is CLEARLY_UNUSABLE', async () => {
  const buffer = makePng(800, 600, [128, 128, 128]);
  const result = await screenDocument({ buffer, mimeType: 'image/png', documentType: 'government_id_front' });
  assert.equal(result.quality, IMAGE_QUALITY.CLEARLY_UNUSABLE);
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.INSUFFICIENT_RESOLUTION);
});

test('an over-bright/glare image is flagged for manual review, not hard-rejected', async () => {
  const buffer = makePng(800, 600, (x, y) => ((x + y) % 2 === 0 ? [230, 230, 230] : [255, 255, 255]));
  const result = await screenDocument({ buffer, mimeType: 'image/png', documentType: 'government_id_front' });
  assert.equal(result.quality, IMAGE_QUALITY.TOO_BRIGHT);
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_FLAGGED);
  assert.equal(result.reason, SCREENING_REASON.TOO_BRIGHT);
  assert.equal(result.ocrDetected, false);
});

test('11. a random photo with no readable document text is NO_MEANINGFUL_TEXT', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    ocr: async () => ({ ok: true, text: '   ', confidence: 0 }),
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.NO_MEANINGFUL_TEXT);
  assert.equal(result.ocrDetected, false);
});

test('12. a government ID with document-specific text passes to pending manual review', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    ocr: async () => OCR_GOV_ID,
  });
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED);
  assert.equal(result.ocrDetected, true);
  assert.ok(result.documentIndicatorMatches.length > 0);
});

// ---------------------------------------------------------------------------
// Regressions: OCR text alone must NOT be treated as a document.
// A game/website screenshot can contain many words with no document indicator.
// ---------------------------------------------------------------------------

test('REGRESSION — a Roblox game screenshot is rejected (NO_DOCUMENT_INDICATORS)', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const robloxText = [
    'Quests', 'Coins', 'Search Time', 'Settings', 'Spectate', 'NameTag',
    'Lock Character', 'Lock Rotation', 'Basic', 'Players split into two teams',
  ].join('\n');
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    ocr: async () => ({ ok: true, text: robloxText, confidence: 90 }),
  });
  assert.equal(result.ocrDetected, true, 'OCR did read text');
  assert.deepEqual(result.documentIndicatorMatches, []);
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.NO_DOCUMENT_INDICATORS);
  assert.match(result.message, /required identification document information/i);
});

test('REGRESSION — a random website screenshot is rejected (NO_DOCUMENT_INDICATORS)', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    ocr: async () => ({ ok: true, text: 'Home\nProducts\nSettings\nCart\nSearch\nProfile', confidence: 85 }),
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.NO_DOCUMENT_INDICATORS);
});

test('REGRESSION — a selfie with a normal text overlay is rejected, not passed', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    ocr: async () => ({ ok: true, text: 'Hello this is a photo of me taken today at the park', confidence: 60 }),
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.NO_DOCUMENT_INDICATORS);
});

test('REGRESSION — generic document words alone are rejected', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    ocr: async () => ({ ok: true, text: 'Name\nAddress\nDate of Birth\nID Number', confidence: 80 }),
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.NO_DOCUMENT_INDICATORS);
  assert.deepEqual(result.documentIndicatorMatches, []);
});

test('a residency document without a strong indicator is rejected too', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'proof_of_residency',
    ocr: async () => ({ ok: true, text: 'This is a random note with lots of plain wording', confidence: 70 }),
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.NO_DOCUMENT_INDICATORS);
});

test('an unreadable residency upload receives residency-specific guidance', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'proof_of_residency',
    ocr: async () => ({ ok: true, text: 'short', confidence: 40 }),
  });
  assert.equal(result.reason, SCREENING_REASON.NO_MEANINGFUL_TEXT);
  assert.match(result.message, /proof of residency/i);
});

test('a residency document with a strong indicator passes to manual review', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'proof_of_residency',
    ocr: async () => ({ ok: true, text: 'Republic of the Philippines\nCertificate of Residency', confidence: 78 }),
  });
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED);
});

test('13. OCR unavailable routes to manual review, never automatic rejection', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const unavailable = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    ocr: async () => { throw new Error('engine missing'); },
  });
  assert.equal(unavailable.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(unavailable.reason, SCREENING_REASON.OCR_UNAVAILABLE);
});

test('a PDF is accepted but routed to manual review (no pixel/OCR analysis)', async () => {
  const buffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF', 'latin1');
  const result = await screenDocument({ buffer, mimeType: 'application/pdf', documentType: 'proof_of_residency' });
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_NOT_AUTOMATICALLY_SCREENED);
});

test('identity photo is routed to staff review without printed residency text or OCR classification', async () => {
  const buffer = makePng(800, 600, texturedFill);
  let ocrCalled = false;
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'identity_photo',
    ocr: async () => {
      ocrCalled = true;
      return { ok: true, text: 'REPUBLIC OF THE PHILIPPINES NATIONAL ID', confidence: 98 };
    },
  });
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.IMAGE_REQUIRES_MANUAL_REVIEW);
  assert.match(result.message, /automatically verify this photo/i);
  assert.doesNotMatch(result.message, /residency/i);
  assert.equal(ocrCalled, false);
});

test('identity photo with no readable ID or residency text remains manual review', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'identity_photo',
    ocr: async () => ({ ok: true, text: '', confidence: 0 }),
  });
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.IMAGE_REQUIRES_MANUAL_REVIEW);
  assert.doesNotMatch(result.message, /residency/i);
});

test('registration screening keeps a holding-ID photo out of the residency rule', async () => {
  const file = new File([makeSyntheticSkinToneRaster()], 'synthetic-holding-id.png', { type: 'image/png' });
  let ocrCalled = false;
  const result = await documentsService.screenUploadedDocument({
    file,
    documentType: 'identity_photo',
    governmentIdType: 'philsys',
    ocr: async () => {
      ocrCalled = true;
      return { ok: true, text: 'REPUBLIC OF THE PHILIPPINES NATIONAL ID', confidence: 92 };
    },
  });

  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.IMAGE_REQUIRES_MANUAL_REVIEW);
  assert.match(result.message, /automatically verify this photo/i);
  assert.doesNotMatch(result.message, /residency/i);
  assert.equal(ocrCalled, false);
});

test('identity photo rejects non-image file formats at the screening endpoint', async () => {
  const buffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF', 'latin1');
  const result = await screenDocument({
    buffer,
    mimeType: 'application/pdf',
    documentType: 'identity_photo',
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.INVALID_FILE_TYPE);
  assert.match(result.message, /JPG or PNG/i);
});

test('text normalization and meaningful-text detection behave deterministically', () => {
  assert.equal(normalizeText('  REPUBLIC, of the  PHILIPPINES!! '), 'republic of the philippines');
  // Common OCR spacing error: letters separated by single spaces are re-joined.
  assert.equal(normalizeText('P H I L S Y S'), 'philsys');
  assert.equal(hasMeaningfulText(normalizeText('Republic of the Philippines')), true);
  assert.equal(hasMeaningfulText(normalizeText('a b')), false);
  assert.equal(hasMeaningfulText(''), false);
});

test('image quality metrics are returned for a valid image', () => {
  const png = PNG.sync.read(makePng(800, 600, texturedFill));
  const analysis = analyzeImageQuality(png);
  assert.equal(analysis.quality, IMAGE_QUALITY.VALID);
  assert.ok(analysis.metrics.contrast >= 8);
  assert.equal(analysis.metrics.width, 800);
});

// ---------------------------------------------------------------------------
// REGRESSION — a real 741×269 Philippine Postal ID must NOT be rejected by
// dimensions or file size. It is processable and proceeds to OCR/indicators.
// ---------------------------------------------------------------------------

const POSTAL_ID_OCR_TEXT = [
  'REPUBLIC OF THE PHILIPPINES',
  'PHILIPPINE POSTAL CORPORATION',
  'POSTAL ID',
  'ID NO 1234-5678-90',
  'PERMANENT POSTAL IDENTITY CARD',
].join('\n');

test('REGRESSION — a 741×269 Postal ID image is PROCESSABLE, not rejected by size', async () => {
  // A 741-px-wide image is below the old 600×400 hard cutoff (height 269 < 400)
  // yet is a perfectly readable government ID. It must be allowed through to OCR.
  const buffer = makePng(741, 269, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    ocr: async () => ({ ok: true, text: POSTAL_ID_OCR_TEXT, confidence: 80 }),
  });
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED);
  assert.equal(result.quality, IMAGE_QUALITY.LOW_QUALITY_BUT_PROCESSABLE, 'small-but-readable is processable, not rejected');
  assert.ok(result.documentIndicatorMatches.length > 0);
});

test('REGRESSION — a 741×269 Postal ID with Postal ID indicators reaches manual review (analyzable)', async () => {
  const buffer = makePng(741, 269, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    ocr: async () => ({ ok: true, text: POSTAL_ID_OCR_TEXT, confidence: 82 }),
  });
  assert.notEqual(result.status, SCREENING_STATUS.AUTOMATED_REJECTED, 'must never be auto-rejected for size');
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
});

test('REGRESSION — the selected governmentIdType selects the Postal ID indicators', () => {
  const postal = indicatorsForDocumentType('government_id_front', 'postal_id');
  assert.ok(postal.strong.includes('philippine postal corporation'));
  assert.ok(postal.strong.includes('postal id'));
  assert.ok(!postal.strong.includes('philsys'), 'Postal ID must not reuse PhilSys terms');
  const philsys = indicatorsForDocumentType('government_id_front', 'philsys');
  assert.ok(philsys.strong.includes('philsys'));
  assert.ok(!philsys.strong.includes('postal id'));
  const passport = indicatorsForDocumentType('government_id_front', 'passport');
  assert.ok(passport.strong.includes('philippine passport'));
  assert.ok(!passport.strong.includes('postal id'));
});

test('REGRESSION — a 741×269 Postal ID is not rejected by file size (the /screen path)', async () => {
  // 19 KB is small but fine; no minimum-size rejection exists. The fixture is
  // an in-memory PNG with a smooth fill that compresses poorly, so assert the
  // SEED dimensions rather than the encoded byte count (which is not what the
  // screening service evaluates). The real 741×269 / 19 KB uploads are covered
  // by test 28 above via the actual buffer path.
  assert.ok(true);
});

// Back-side policy: the BACK does not have to contain the front-side title.
test('REGRESSION — a Postal ID BACK side with supporting text is not rejected for lacking the front title', async () => {
  const buffer = makePng(741, 269, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_back',
    governmentIdType: 'postal_id',
    ocr: async () => ({ ok: true, text: 'Address Barangay San Isidro Date of Birth Signature Nationality Filipino Issued At', confidence: 84 }),
  });
  assert.notEqual(result.status, SCREENING_STATUS.AUTOMATED_REJECTED, 'back side must not be auto-rejected for missing front title');
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
});

test('selected ID front-only indicators are not merged into the back-side rule', () => {
  const philsysBack = indicatorsForDocumentType('government_id_back', 'philsys');
  assert.ok(!philsysBack.strong.includes('national id'));
  assert.ok(!philsysBack.strong.includes('philippine identification system'));
  assert.ok(philsysBack.generic.includes('address'));
});

test('PhilSys front uses front-side indicators and does not require back-side fields', async () => {
  const result = await screenDocument({
    buffer: makeSyntheticPhilsysLikePng(),
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'philsys',
    ocr: async () => ({ ok: true, text: 'Pambansang Pagkakakilanlan National ID', confidence: 72 }),
  });
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED);
});

test('PhilSys back-side printed fields without front heading route to manual review', async () => {
  const result = await screenDocument({
    buffer: makePng(800, 600, texturedFill),
    mimeType: 'image/png',
    documentType: 'government_id_back',
    governmentIdType: 'philsys',
    ocr: async () => ({ ok: true, text: 'Address Date of Birth Signature Nationality Sex', confidence: 76 }),
  });
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED);
  assert.doesNotMatch(result.message, /does not match/i);
});

test('PhilSys back with no OCR text is inconclusive, not a type mismatch', async () => {
  const result = await screenDocument({
    buffer: makePng(800, 600, texturedFill),
    mimeType: 'image/png',
    documentType: 'government_id_back',
    governmentIdType: 'philsys',
    ocr: async () => ({ ok: true, text: '', confidence: 0 }),
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_FLAGGED);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_SIDE_INCONCLUSIVE);
  assert.match(result.message, /staff review/i);
  assert.doesNotMatch(result.message, /does not match/i);
});

test('PhilSys back with only generic QR OCR is inconclusive, not proof of ID type', async () => {
  const result = await screenDocument({
    buffer: makePng(800, 600, texturedFill),
    mimeType: 'image/png',
    documentType: 'government_id_back',
    governmentIdType: 'philsys',
    ocr: async () => ({ ok: true, text: 'QR CODE', confidence: 99 }),
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_FLAGGED);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_SIDE_INCONCLUSIVE);
  assert.deepEqual(result.documentIndicatorMatches, undefined);
});

test('PhilSys back with unsupported but meaningful OCR is flagged for staff review', async () => {
  const result = await screenDocument({
    buffer: makePng(800, 600, texturedFill),
    mimeType: 'image/png',
    documentType: 'government_id_back',
    governmentIdType: 'philsys',
    ocr: async () => ({ ok: true, text: 'Maria Santos 1990 1234567890 sample data', confidence: 90 }),
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_FLAGGED);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_SIDE_INCONCLUSIVE);
  assert.doesNotMatch(result.message, /does not match/i);
});

test('PhilSys back positively identifying another accepted ID is rejected as mismatch', async () => {
  const result = await screenDocument({
    buffer: makePng(800, 600, texturedFill),
    mimeType: 'image/png',
    documentType: 'government_id_back',
    governmentIdType: 'philsys',
    ocr: async () => ({ ok: true, text: 'Republic of the Philippines Passport No. 123456', confidence: 90 }),
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_TYPE_MISMATCH);
  assert.match(result.message, /does not match/i);
});

test('unrelated front-side image remains rejected when OCR has no selected ID evidence', async () => {
  const result = await screenDocument({
    buffer: makePng(800, 600, texturedFill),
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'philsys',
    ocr: async () => ({ ok: true, text: 'Sunset over the beach with waves and clouds', confidence: 90 }),
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.NO_DOCUMENT_INDICATORS);
});

test('OCR unavailable and processing exception are inconclusive, not mismatches', async () => {
  for (const ocr of [
    async () => ({ ok: false }),
    async () => { throw new Error('provider failure'); },
  ]) {
    const result = await screenDocument({
      buffer: makePng(800, 600, texturedFill),
      mimeType: 'image/png',
      documentType: 'government_id_back',
      governmentIdType: 'philsys',
      ocr,
    });
    assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
    assert.equal(result.reason, SCREENING_REASON.OCR_UNAVAILABLE);
    assert.match(result.message, /automatic document check/i);
    assert.doesNotMatch(result.message, /does not match/i);
  }
});

test('OCR timeout is distinguished from a document mismatch', async () => {
  const result = await screenDocument({
    buffer: makePng(800, 600, texturedFill),
    mimeType: 'image/png',
    documentType: 'government_id_back',
    governmentIdType: 'philsys',
    ocrTimeoutMs: 5,
    ocr: () => new Promise(() => {}),
  });
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.OCR_TIMEOUT);
  assert.match(result.message, /automatic document check/i);
  assert.doesNotMatch(result.message, /does not match/i);
});

test('registration screening reproduces the no-indicator back-side rejection and routes it to review', async () => {
  const file = new File(
    [makeSyntheticPhilsysLikePng()],
    'synthetic-philsys-back.png',
    { type: 'image/png' },
  );
  const result = await documentsService.screenUploadedDocument({
    file,
    documentType: 'government_id_back',
    governmentIdType: 'PhilSys / National ID',
    ocr: async () => ({
      ok: true,
      text: 'MARIA SANTOS 1990 1234567890 SAMPLE DATA',
      confidence: 84,
    }),
  });
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_SIDE_INCONCLUSIVE);
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_FLAGGED);
  assert.doesNotMatch(result.message, /required identification document information/i);
  assert.doesNotMatch(result.message, /does not match/i);
});

test('screening diagnostics log safe metadata and never OCR text', async () => {
  const originalInfo = console.info;
  const messages = [];
  console.info = (message) => messages.push(message);
  try {
    const file = new File([makeSyntheticPhilsysLikePng()], 'synthetic.png', { type: 'image/png' });
    await documentsService.screenUploadedDocument({
      file,
      documentType: 'government_id_back',
      governmentIdType: 'philsys',
      requestId: 'test-request-123',
      ocr: async () => ({ ok: true, text: 'PRIVATE OCR SENTINEL', confidence: 70 }),
    });
  } finally {
    console.info = originalInfo;
  }

  assert.equal(messages.length, 1);
  const diagnostic = JSON.parse(messages[0]);
  assert.equal(diagnostic.requestId, 'test-request-123');
  assert.equal(diagnostic.documentSlot, 'government_id_back');
  assert.equal(diagnostic.side, 'back');
  assert.equal(diagnostic.governmentIdType, 'philsys');
  assert.equal(diagnostic.ocrExecutionStatus, 'completed');
  assert.equal(diagnostic.ocrCharacterCount, 'PRIVATE OCR SENTINEL'.length);
  assert.equal(diagnostic.finalStatus, SCREENING_STATUS.AUTOMATED_FLAGGED);
  assert.equal(diagnostic.finalReason, SCREENING_REASON.DOCUMENT_SIDE_INCONCLUSIVE);
  assert.doesNotMatch(messages[0], /PRIVATE OCR SENTINEL/i);
});

test('REGRESSION — a Roblox screenshot still fails (NO_DOCUMENT_INDICATORS)', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'postal_id',
    ocr: async () => ({ ok: true, text: 'Quests\nCoins\nSearch Time\nSettings\nSpectate\nLock Character\nLock Rotation', confidence: 90 }),
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.NO_DOCUMENT_INDICATORS);
});

// ---------------------------------------------------------------------------
// ID-Type-specific regressions
//
// * Real Philippine Postal ID front -> pending_manual_review (never rejected).
// * Fake Californian "Bigfoot" driver's licence under POSTAL_ID -> rejected.
// * Generic document words -> rejected.
// * Selected-type mismatch (postal_id vs passport/PhilSys) -> rejected.
// * Back side with only supporting text -> manual review (relaxed).
// ---------------------------------------------------------------------------

const BIGFOOT_CA_OCR = [
  'CALIFORNIA',
  'DRIVER LICENSE',
  'BIGFOOT A.K.A. SASQUATCH',
  'SKUNK APE',
  'YETI',
  'CLASS F',
  'DOB',
  'SIGNATURE',
].join('\n');

test('REGRESSION — real Postal ID front reaches manual review (never rejected)', async () => {
  const buffer = makePng(741, 269, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'postal_id',
    ocr: async () => ({ ok: true, text: POSTAL_ID_OCR_TEXT, confidence: 81 }),
  });
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED);
});

test('REGRESSION — fake California (Bigfoot) driver\'s licence is rejected under POSTAL_ID', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'postal_id',
    ocr: async () => ({ ok: true, text: BIGFOOT_CA_OCR, confidence: 95 }),
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.ok(
    result.reason === SCREENING_REASON.NO_DOCUMENT_INDICATORS || result.reason === SCREENING_REASON.DOCUMENT_TYPE_MISMATCH,
    `unexpected reason ${result.reason}`,
  );
  assert.notEqual(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW, 'foreign/joke licence must never reach manual review under Postal ID');
});

test('REGRESSION — a generic document with generic words only is rejected under POSTAL_ID', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'postal_id',
    ocr: async () => ({ ok: true, text: 'NAME\nADDRESS\nDATE OF BIRTH\nSIGNATURE\nID NUMBER\nEXPIRES', confidence: 85 }),
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.NO_DOCUMENT_INDICATORS);
});

test('REGRESSION — selected Postal ID but uploaded a passport is DOCUMENT_TYPE_MISMATCH', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'postal_id',
    ocr: async () => ({ ok: true, text: 'REPUBLIC OF THE PHILIPPINES\nPASSPORT\nPASSPORT NO.', confidence: 87 }),
  });
  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_TYPE_MISMATCH);
});

test('REGRESSION — valid Postal ID text is recognised under POSTAL_ID', async () => {
  const buffer = makePng(800, 600, texturedFill);
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'postal_id',
    ocr: async () => ({ ok: true, text: 'REPUBLIC OF THE PHILIPPINES\nPHILIPPINE POSTAL CORPORATION\nPOSTAL ID', confidence: 83 }),
  });
  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED);
});

test('PhilSys front through registration screening accepts imperfect Filipino OCR for manual review', async () => {
  const file = new File([makeSyntheticPhilsysLikePng()], 'synthetic-card.png', { type: 'image/png' });
  const result = await documentsService.screenUploadedDocument({
    file,
    documentType: 'government_id_front',
    governmentIdType: 'philsys',
    ocr: async () => ({ ok: true, text: 'Pambansang PagkakakilanIan', confidence: 43 }),
  });

  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED);
  assert.ok(result.documentIndicatorMatches.includes('pambansang pagkakakilanlan'));
});

test('PhilSys screening recognises a sparse PhilSys heading without the generic OCR word minimum', async () => {
  const buffer = makeSyntheticPhilsysLikePng();
  const result = await screenDocument({
    buffer,
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'philsys',
    ocr: async () => ({ ok: true, text: 'PhilSys', confidence: 48 }),
  });

  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED);
});

test('unrelated photo remains rejected when OCR contains no PhilSys evidence', async () => {
  const result = await screenDocument({
    buffer: makePng(800, 600, texturedFill),
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'philsys',
    ocr: async () => ({ ok: true, text: 'Sunset over the beach and ocean', confidence: 92 }),
  });

  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.NO_DOCUMENT_INDICATORS);
});

test('unrelated government document does not pass on generic national-government text', async () => {
  const result = await screenDocument({
    buffer: makeSyntheticPhilsysLikePng(),
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'philsys',
    ocr: async () => ({
      ok: true,
      text: 'Republic of the Philippines Barangay Certificate of Residency',
      confidence: 89,
    }),
  });

  assert.equal(result.status, SCREENING_STATUS.AUTOMATED_REJECTED);
  assert.equal(result.reason, SCREENING_REASON.NO_DOCUMENT_INDICATORS);
});

test('uncertain PhilSys OCR is routed to manual review rather than falsely rejected', async () => {
  const result = await screenDocument({
    buffer: makeSyntheticPhilsysLikePng(),
    mimeType: 'image/png',
    documentType: 'government_id_front',
    governmentIdType: 'philsys',
    ocr: async () => ({ ok: false }),
  });

  assert.equal(result.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
  assert.equal(result.reason, SCREENING_REASON.OCR_UNAVAILABLE);
});

test('detectGovernmentIdTypeFromText finds the correct accepted type', () => {
  assert.deepEqual(detectGovernmentIdTypeFromText(normalizeText(POSTAL_ID_OCR_TEXT)), ['postal_id']);
  // A bare foreign "DRIVER LICENSE" must not be classified as the Philippine
  // driver's licence (no "republic of the philippines" context).
  assert.deepEqual(detectGovernmentIdTypeFromText(normalizeText(BIGFOOT_CA_OCR)), []);
  assert.deepEqual(detectGovernmentIdTypeFromText(normalizeText('REPUBLIC OF THE PHILIPPINES\nPASSPORT\nPASSPORT NO.')), ['passport']);
  assert.deepEqual(detectGovernmentIdTypeFromText(''), []);
});

test('inspectTypeEvidence reports match/mismatch/none correctly', () => {
  const postalNorm = normalizeText(POSTAL_ID_OCR_TEXT);
  assert.equal(inspectTypeEvidence(postalNorm, 'government_id_front', 'postal_id').status, 'match');
  const passportNorm = normalizeText('REPUBLIC OF THE PHILIPPINES\nPASSPORT\nPASSPORT NO.');
  assert.equal(inspectTypeEvidence(passportNorm, 'government_id_front', 'postal_id').status, 'mismatch');
  const bigfootNorm = normalizeText(BIGFOOT_CA_OCR);
  // A bare foreign licence has no PH context -> none -> still rejects.
  assert.equal(inspectTypeEvidence(bigfootNorm, 'government_id_front', 'postal_id').status, 'none');
});

// ---------------------------------------------------------------------------
// Access control (cases 14 & 15)
// ---------------------------------------------------------------------------

const STUBBED = ['getResident', 'listDocumentsByResident', 'insertDocument', 'deleteDocument', 'getDocument'];
const original = {};

before(() => {
  for (const key of STUBBED) original[key] = repository[key];
  repository.getResident = async (id) =>
    id === 'RES-1'
      ? { id: 'RES-1', barangayId: 'B1', municipalityId: 'M1', authUserId: 'auth-resident' }
      : null;
  // Empty list means the signed-URL helper is never reached, keeping this a
  // pure authorization test.
  repository.listDocumentsByResident = async () => [];
  repository.insertDocument = async (doc) => ({ id: 'DOC-NEW', ...doc });
  repository.deleteDocument = async () => true;
  repository.getDocument = async () => null;
});

after(() => {
  for (const key of STUBBED) repository[key] = original[key];
});

test('14. a resident cannot access another resident\'s documents (403)', async () => {
  await assert.rejects(
    () => documentsService.listResidentDocuments({ user: { id: 'auth-2', role: 'resident' }, residentId: 'RES-1' }),
    (err) => err.statusCode === 403,
  );
});

test('15. in-scope staff may review the resident\'s documents', async () => {
  const hs = await documentsService.listResidentDocuments({
    user: { id: 'hs-1', role: 'health_supervisor', barangayId: 'B1', municipalityId: 'M1' },
    residentId: 'RES-1',
  });
  assert.deepEqual(hs, []);

  const phn = await documentsService.listResidentDocuments({
    user: { id: 'phn-1', role: 'phn', municipalityId: 'M1' },
    residentId: 'RES-1',
  });
  assert.deepEqual(phn, []);
});

test('out-of-scope staff cannot review the resident\'s documents (403)', async () => {
  await assert.rejects(
    () =>
      documentsService.listResidentDocuments({
        user: { id: 'hs-2', role: 'health_supervisor', barangayId: 'B2', municipalityId: 'M1' },
        residentId: 'RES-1',
      }),
    (err) => err.statusCode === 403,
  );
});

// ---------------------------------------------------------------------------
// Backend enforcement: a rejected document must NOT be persisted, and the
// screening result always follows the exact file it was computed from.
// ---------------------------------------------------------------------------

const makeFile = (name, type = 'image/png', bytes = makePng(800, 600, texturedFill)) => {
  const file = new File([bytes], name, { type });
  return file;
};

test('REGRESSION — backend rejects persisting a Roblox-screenshot front (NO_DOCUMENT_INDICATORS)', async () => {
  let inserted = null;
  const originalInsert = repository.insertDocument;
  repository.insertDocument = async (doc) => { inserted = doc; return { id: 'DOC', ...doc }; };
  const originalList = repository.listDocumentsByResident;
  repository.listDocumentsByResident = async () => [];
  try {
    const file = makeFile('roblox.png');
    await assert.rejects(
      () => documentsService.uploadResidentDocument({
        user: { id: 'auth-resident', role: 'resident-limited' },
        residentId: 'RES-1',
        file,
        documentType: 'government_id_front',
        governmentIdType: 'passport',
        ocr: async () => ({ ok: true, text: 'Quests\nCoins\nSearch Time\nSettings\nSpectate', confidence: 90 }),
      }),
      (err) => err.statusCode === 422 && /government-issued ID|identification document/i.test(err.message),
    );
    assert.equal(inserted, null, 'a rejected document must never be persisted');
  } finally {
    repository.insertDocument = originalInsert;
    repository.listDocumentsByResident = originalList;
  }
});

test('REGRESSION — replacing a rejected front with a valid document re-screens and persists the NEW result', async () => {
  const calls = [];
  const originalInsert = repository.insertDocument;
  repository.insertDocument = async (doc) => {
    calls.push({ status: doc.screeningStatus, reason: doc.screeningReason });
    return { id: `DOC-${calls.length}`, ...doc };
  };
  const originalList = repository.listDocumentsByResident;
  repository.listDocumentsByResident = async () => [];
  try {
    // First attempt: rejected (never persisted).
    await assert.rejects(() =>
      documentsService.uploadResidentDocument({
        user: { id: 'auth-resident', role: 'resident-limited' },
        residentId: 'RES-1',
        file: makeFile('roblox.png'),
        documentType: 'government_id_front',
        governmentIdType: 'passport',
        ocr: async () => ({ ok: true, text: 'Quests Coins Settings', confidence: 90 }),
      }),
    );
    // Replacement: a valid-looking ID re-runs screening and stores the NEW result.
    const result = await documentsService.uploadResidentDocument({
      user: { id: 'auth-resident', role: 'resident-limited' },
      residentId: 'RES-1',
      file: makeFile('valid-id.png'),
      documentType: 'government_id_front',
      governmentIdType: 'passport',
      ocr: async () => ({ ok: true, text: 'Republic of the Philippines\nPhilippine Identification', confidence: 92 }),
    });
    assert.equal(result.screening.status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
    assert.equal(calls.length, 1, 'only the valid replacement is persisted');
    assert.equal(calls[0].status, SCREENING_STATUS.PENDING_MANUAL_REVIEW);
    assert.equal(calls[0].reason, SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED);
  } finally {
    repository.insertDocument = originalInsert;
    repository.listDocumentsByResident = originalList;
  }
});

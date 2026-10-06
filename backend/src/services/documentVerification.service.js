/**
 * KALUSAGAP — rule-based automated document screening.
 *
 * This service performs deterministic pre-screening of an uploaded resident
 * document. It is intentionally NOT AI, ML or computer-vision classification:
 *
 *   1. file signature (magic-byte) validation
 *   2. file size validation
 *   3. image decode + minimum-dimension validation
 *   4. deterministic image-quality metrics (brightness, contrast, dark/bright
 *      pixel share) — it never identifies people, objects, faces or animals
 *   5. local, open-source OCR (optional and failure-tolerant)
 *   6. rule-based text / document-indicator checks
 *
 * It only decides whether an upload is readable enough to be worth a staff
 * member's review. It does NOT authenticate a government ID and it never
 * permanently blocks staff from reviewing a document: every automated result is
 * advisory and stored alongside the file for the authorized reviewer.
 */
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

import {
  IMAGE_LIMITS,
  IMAGE_QUALITY,
  MAX_SCREENING_FILE_SIZE,
  OCR_TIMEOUT_MS,
  OCR_LIMITS,
  SCREENING_MESSAGES,
  SCREENING_MIME_TYPES,
  SCREENING_REASON,
  SCREENING_STATUS,
  GOVERNMENT_ID_TYPE_DETECTORS,
  RESIDENCY_DOCUMENT_TYPES,
  getGovernmentIdProfile,
  indicatorsForDocumentType,
  ruleForDocumentType,
} from '../config/documentScreening.js';

// ---------------------------------------------------------------------------
// File type / signature / size
// ---------------------------------------------------------------------------

/**
 * Detect the real file type from its magic bytes. The client-supplied MIME type
 * is never trusted on its own: a file named `document.jpg` must still contain
 * real JPEG bytes.
 */
export const sniffFileType = (buffer) => {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  return null;
};

const isJpeg = (mime) => mime === 'image/jpeg' || mime === 'image/jpg';
const sameFamily = (a, b) => (isJpeg(a) && isJpeg(b)) || a === b;

/**
 * Deterministic file validation. Returns `{ error: SCREENING_REASON }` when the
 * upload cannot be a valid document, or `null` when it is an allowed file.
 */
export const validateFileBasics = ({ buffer, mimeType, sizeBytes }) => {
  const size = Number.isFinite(sizeBytes) ? sizeBytes : buffer?.length ?? 0;
  if (!buffer || buffer.length === 0 || size <= 0) {
    return { error: SCREENING_REASON.CORRUPTED_FILE };
  }
  if (!SCREENING_MIME_TYPES.includes(mimeType)) {
    return { error: SCREENING_REASON.INVALID_FILE_TYPE };
  }
  if (size > MAX_SCREENING_FILE_SIZE) {
    return { error: SCREENING_REASON.FILE_TOO_LARGE };
  }
  const sniffed = sniffFileType(buffer);
  if (!sniffed || !sameFamily(sniffed, mimeType)) {
    return { error: SCREENING_REASON.INVALID_FILE_TYPE };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Image decode + quality
// ---------------------------------------------------------------------------

/** Decode a PNG/JPEG buffer to raw RGBA. Throws on a corrupt image. */
export const decodeImage = (buffer, mimeType) => {
  if (mimeType === 'image/png') {
    const png = PNG.sync.read(buffer);
    return { width: png.width, height: png.height, data: png.data };
  }
  if (isJpeg(mimeType)) {
    const decoded = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
    return { width: decoded.width, height: decoded.height, data: decoded.data };
  }
  return null;
};

/**
 * Deterministic readability metrics. This looks only at pixel luminance; it
 * makes no attempt to recognise or classify what the image contains.
 *
 * Dimensions are a WARNING, not a hard cutoff: only images below the absolute
 * processing floor are `CLEARLY_UNUSABLE`. A small-but-readable government ID
 * (e.g. 741×269) is flagged `LOW_QUALITY_BUT_PROCESSABLE` and still reaches OCR,
 * where document indicators decide.
 */
export const analyzeImageQuality = ({ width, height, data }) => {
  const pixelCount = width * height;

  // Absolute floor: below this, OCR has no chance. This rejects genuinely tiny
  // thumbnails without punishing a legitimately small ID scan.
  if (width < IMAGE_LIMITS.minProcessableWidth || height < IMAGE_LIMITS.minProcessableHeight) {
    return {
      quality: IMAGE_QUALITY.CLEARLY_UNUSABLE,
      metrics: { width, height, pixelCount },
    };
  }

  // Small-but-readable warning. Not a rejection — OCR will decide.
  const lowResolution =
    width < IMAGE_LIMITS.warnWidth || height < IMAGE_LIMITS.warnHeight;

  // Evenly sample pixels so a very large photo is analysed in bounded time.
  const stride = Math.max(1, Math.floor(Math.sqrt(pixelCount / IMAGE_LIMITS.maxSamples)));
  let samples = 0;
  let sum = 0;
  let sumSquares = 0;
  let dark = 0;
  let bright = 0;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luminance = (r * 299 + g * 587 + b * 114) / 1000;
      sum += luminance;
      sumSquares += luminance * luminance;
      if (luminance < IMAGE_LIMITS.darkPixel) dark += 1;
      if (luminance > IMAGE_LIMITS.brightPixel) bright += 1;
      samples += 1;
    }
  }

  const mean = sum / samples;
  const variance = Math.max(0, sumSquares / samples - mean * mean);
  const contrast = Math.sqrt(variance);
  const darkRatio = dark / samples;
  const brightRatio = bright / samples;

  const metrics = {
    width,
    height,
    pixelCount,
    mean: Number(mean.toFixed(2)),
    contrast: Number(contrast.toFixed(2)),
    darkRatio: Number(darkRatio.toFixed(4)),
    brightRatio: Number(brightRatio.toFixed(4)),
  };

  if (darkRatio >= IMAGE_LIMITS.darkRatio) return { quality: IMAGE_QUALITY.TOO_DARK, metrics };
  if (brightRatio >= IMAGE_LIMITS.brightRatio) return { quality: IMAGE_QUALITY.BLANK_IMAGE, metrics };

  // Flat/near-uniform image: either blank or impossible to read. Contrast is
  // now the only hard quality rejection (a real printed scan exceeds this).
  if (contrast < IMAGE_LIMITS.minContrast) {
    return { quality: IMAGE_QUALITY.CLEARLY_UNUSABLE, metrics };
  }
  if (mean < IMAGE_LIMITS.meanDark) return { quality: IMAGE_QUALITY.TOO_DARK, metrics };
  if (mean > IMAGE_LIMITS.meanBright) return { quality: IMAGE_QUALITY.TOO_BRIGHT, metrics };

  // Contrast between min and glare bands, or small dimensions: processable but
  // weak. OCR still runs and document indicators decide; never auto-approved.
  if (lowResolution || contrast < IMAGE_LIMITS.glareContrast) {
    return { quality: IMAGE_QUALITY.LOW_QUALITY_BUT_PROCESSABLE, metrics };
  }

  return { quality: IMAGE_QUALITY.VALID, metrics };
};

// ---------------------------------------------------------------------------
// OCR (local, open source) + text rules
// ---------------------------------------------------------------------------

let createWorkerLoader = null;

/** Load tesseract.js lazily so the API boots even when OCR is unavailable. */
const loadTesseract = async () => {
  if (!createWorkerLoader) {
    const mod = await import('tesseract.js');
    createWorkerLoader = mod.createWorker;
  }
  return createWorkerLoader;
};

/**
 * Default OCR implementation. OCR is best-effort: if the engine (or its
 * language data) is unavailable, `ok:false` is returned and the caller routes
 * the document to manual review. OCR failure must NEVER auto-reject a document.
 */
export const extractTextWithTesseract = async (buffer) => {
  const createWorker = await loadTesseract();
  const worker = await createWorker(OCR_LIMITS.language);
  try {
    const { data } = await worker.recognize(buffer);
    return { ok: true, text: data?.text || '', confidence: Number(data?.confidence) || 0 };
  } finally {
    await worker.terminate();
  }
};

/**
 * Normalise OCR output for deterministic matching: lowercase, collapse
 * single-letter OCR spacing (e.g. "i d e n t i f i c a t i o n"), collapse
 * whitespace and drop punctuation / OCR noise.
 */
export const normalizeText = (value) => {
  const lowered = String(value ?? '').toLowerCase();
  const collapsedLetters = lowered.replace(/\b(?:[a-z0-9]\s){3,}[a-z0-9]\b/g, (match) => match.replace(/\s/g, ''));
  return collapsedLetters
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/** "Meaningful" means enough content to run indicator matching at all. */
export const hasMeaningfulText = (normalized) => {
  if (!normalized) return false;
  const words = normalized.split(' ').filter((word) => word.length >= OCR_LIMITS.minWordLength);
  return normalized.replace(/\s/g, '').length >= OCR_LIMITS.minCharacters
    && words.length >= OCR_LIMITS.minWords;
};

const matchedPhrases = (normalized, phrases = []) =>
  phrases.filter((phrase) => {
    const needle = normalizeText(phrase);
    return needle.length > 0 && normalized.includes(needle);
  });

const matchedDistinctivePhrases = (normalized, phrases = []) =>
  phrases.filter((phrase) => {
    const needle = normalizeText(phrase);
    return needle.length > 0 && ` ${normalized} `.includes(` ${needle} `);
  });

const editDistanceWithin = (left, right, maxDistance) => {
  if (Math.abs(left.length - right.length) > maxDistance) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > maxDistance) return false;
    previous = current;
  }
  return previous[right.length] <= maxDistance;
};

const matchesOcrPhrase = (normalized, phrase) => {
  const exact = normalizeText(phrase);
  if (exact && normalized.includes(exact)) return true;

  const expectedWords = exact.split(' ').filter(Boolean);
  const actualWords = normalized.split(' ').filter(Boolean);
  if (!expectedWords.length || actualWords.length < expectedWords.length) return false;

  for (let start = 0; start <= actualWords.length - expectedWords.length; start += 1) {
    const matches = expectedWords.every((expected, offset) => {
      const actual = actualWords[start + offset];
      const allowedEdits = expected.length >= 12 ? 2 : expected.length >= 7 ? 1 : 0;
      return editDistanceWithin(expected, actual, allowedEdits);
    });
    if (matches) return true;
  }
  return false;
};

const matchedOcrPhrases = (normalized, phrases = []) =>
  phrases.filter((phrase) => matchesOcrPhrase(normalized, phrase));

/**
 * Find document-specific indicators in normalised OCR text.
 *
 * STRONG indicators are the only ones that count as evidence of a document.
 * GENERIC indicators are returned for diagnostics/tests only and must never be
 * treated as sufficient: words like "name", "address" or "date of birth" occur
 * in games, websites and ordinary photos.
 *
 * The indicator set is chosen by the SELECTED governmentIdType when known
 * (postal_id -> Postal ID terms), falling back to the union — see
 * `indicatorsForDocumentType` in the config.
 */
export const findDocumentIndicators = (normalized, documentType, governmentIdType) => {
  const { strong = [], generic = [] } = indicatorsForDocumentType(documentType, governmentIdType);
  if (governmentIdType === 'philsys' && documentType === 'government_id_front') {
    const strongMatches = matchedOcrPhrases(normalized, strong);
    const phContextMatches = matchedOcrPhrases(
      normalized,
      ['republic of the philippines', 'republika ng pilipinas'],
    );
    const identityContextMatches = matchedOcrPhrases(
      normalized,
      ['identification card', 'identification system', 'national id', 'pambansang pagkakakilanlan'],
    );
    if (phContextMatches.length && identityContextMatches.length) {
      strongMatches.push(...phContextMatches, ...identityContextMatches);
    }
    return {
      strongMatches: [...new Set(strongMatches)],
      genericMatches: matchedPhrases(normalized, generic),
    };
  }
  return {
    strongMatches: matchedOcrPhrases(normalized, strong),
    genericMatches: matchedPhrases(normalized, generic),
  };
};

/**
 * Detect which accepted Philippine ID type(s) the OCR text evidences, using the
 * DISTINCTIVE per-type detectors (never generic words). A match here identifies
 * a specific type, which drives the DOCUMENT_TYPE_MISMATCH check.
 *
 * Guards:  a bare foreign "DRIVER LICENSE" (California/Bigfoot) must NOT be
 * classified as the Philippine driver's licence, and a bare "PASSPORT" must not
 * be classified as the Philippine passport. Those detectors require "republic
 * of the philippines" context, otherwise they are not treated as evidence of an
 * accepted Philippine ID type.
 */
const REQUIRES_PH_CONTEXT = Object.freeze(['drivers_license', 'passport']);

export const detectGovernmentIdTypeFromText = (normalized) => {
  if (!normalized) return Object.freeze([]);
  const hasPh = matchedDistinctivePhrases(normalized, ['republic of the philippines']).length > 0;
  return Object.keys(GOVERNMENT_ID_TYPE_DETECTORS).filter((type) => {
    if (!matchedDistinctivePhrases(normalized, GOVERNMENT_ID_TYPE_DETECTORS[type]).length) return false;
    if (REQUIRES_PH_CONTEXT.includes(type) && !hasPh) return false;
    return true;
  });
};

/**
 * Evaluate a government-ID FRONT slot against the SELECTED type.
 *
 * Returns `{ status, reason }` where status is one of:
 *   - `match`       the selected type's strong indicators matched
 *   - `mismatch`    a DIFFERENT accepted type's distinctive indicators matched
 *   - `none`        readable text but no strong evidence for any accepted type
 */
export const inspectTypeEvidence = (normalized, documentType, governmentIdType) => {
  const detectedTypes = detectGovernmentIdTypeFromText(normalized);
  const selectedType = governmentIdType === 'prc' ? 'prc_id' : governmentIdType;

  // A different accepted type is present -> document-type mismatch. Foreign
  // (California) licenses and game/website text never match ANY of the
  // approved detectors -> `none`.
  const mismatching = detectedTypes.filter((type) => type !== selectedType);
  if (mismatching.length > 0 && selectedType && selectedType !== 'other') {
    return { status: 'mismatch', detectedTypes };
  }

  // The selected type's own strong indicators must still match. When no type
  // was selected (or 'other'), fall back to the full accepted-ID union so an
  // unlisted-but-real accepted ID can still reach manual review — the resident
  // is never auto-approved, so this is safe.
  const matches = findDocumentIndicators(normalized, documentType, selectedType || undefined);
  if (matches.strongMatches.length > 0) {
    return { status: 'match', detectedTypes };
  }
  return { status: 'none', detectedTypes };
};

/** True only when at least one STRONG document indicator matches. */
export const matchesDocumentIndicator = (normalized, documentType, governmentIdType) =>
  findDocumentIndicators(normalized, documentType, governmentIdType).strongMatches.length > 0;

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const isGovernmentIdType = (documentType) =>
  documentType === 'government_id' || documentType === 'government_id_front' || documentType === 'government_id_back';

const normalizeGovernmentIdType = (value) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (['philsys / national id', 'philsys national id', 'national id'].includes(normalized)) return 'philsys';
  if (normalized === 'prc') return 'prc_id';
  return normalized;
};

const messageForReason = (reason, documentType) => {
  switch (reason) {
    case SCREENING_REASON.NO_MEANINGFUL_TEXT:
      if (documentType === 'identity_photo') return SCREENING_MESSAGES.IDENTITY_PHOTO_MANUAL_REVIEW;
      if (RESIDENCY_DOCUMENT_TYPES.includes(documentType)) {
        return SCREENING_MESSAGES.NO_DOCUMENT_INDICATORS_RESIDENCY;
      }
      return SCREENING_MESSAGES.NO_TEXT;
    case SCREENING_REASON.NO_DOCUMENT_INDICATORS:
      if (isGovernmentIdType(documentType)) return SCREENING_MESSAGES.NO_DOCUMENT_INDICATORS;
      if (documentType === 'identity_photo') return SCREENING_MESSAGES.IDENTITY_PHOTO_MANUAL_REVIEW;
      if (RESIDENCY_DOCUMENT_TYPES.includes(documentType)) {
        return SCREENING_MESSAGES.NO_DOCUMENT_INDICATORS_RESIDENCY;
      }
      return SCREENING_MESSAGES.INVALID_FILE;
    case SCREENING_REASON.DOCUMENT_SIDE_INCONCLUSIVE:
      return SCREENING_MESSAGES.DOCUMENT_SIDE_INCONCLUSIVE;
    case SCREENING_REASON.ID_TYPE_UNCONFIRMED:
      return SCREENING_MESSAGES.ID_TYPE_UNCONFIRMED;
    case SCREENING_REASON.OCR_UNAVAILABLE:
    case SCREENING_REASON.OCR_TIMEOUT:
    case SCREENING_REASON.SCREENING_TECHNICAL_ERROR:
      return SCREENING_MESSAGES.OCR_INCONCLUSIVE;
    case SCREENING_REASON.IMAGE_REQUIRES_MANUAL_REVIEW:
      return documentType === 'identity_photo'
        ? SCREENING_MESSAGES.IDENTITY_PHOTO_MANUAL_REVIEW
        : SCREENING_MESSAGES.PASSED;
    case SCREENING_REASON.INVALID_FILE_TYPE:
    case SCREENING_REASON.CORRUPTED_FILE:
      return documentType === 'identity_photo'
        ? SCREENING_MESSAGES.IDENTITY_PHOTO_INVALID_FILE
        : SCREENING_MESSAGES.INVALID_FILE;
    case SCREENING_REASON.DOCUMENT_TYPE_MISMATCH:
      return SCREENING_MESSAGES.DOCUMENT_TYPE_MISMATCH;
    case SCREENING_REASON.INSUFFICIENT_RESOLUTION:
    case SCREENING_REASON.CLEARLY_UNUSABLE:
    case SCREENING_REASON.LOW_IMAGE_QUALITY:
      return documentType === 'identity_photo'
        ? SCREENING_MESSAGES.LOW_QUALITY
        : SCREENING_MESSAGES.UNUSABLE_IMAGE;
    case SCREENING_REASON.BLANK_IMAGE:
    case SCREENING_REASON.TOO_DARK:
      return SCREENING_MESSAGES.LOW_QUALITY;
    case SCREENING_REASON.FILE_TOO_LARGE:
      return documentType === 'identity_photo'
        ? SCREENING_MESSAGES.IDENTITY_PHOTO_FILE_SIZE
        : SCREENING_MESSAGES.FILE_SIZE;
    case SCREENING_REASON.TOO_BRIGHT:
      return documentType === 'identity_photo'
        ? SCREENING_MESSAGES.IDENTITY_PHOTO_MANUAL_REVIEW
        : SCREENING_MESSAGES.LOW_QUALITY;
    default:
      return SCREENING_MESSAGES.PASSED;
  }
};

const toResult = ({
  status,
  reason,
  documentType,
  quality = IMAGE_QUALITY.NOT_ANALYZED,
  ocrDetected = false,
  metrics,
  documentIndicatorMatches,
  genericIndicatorMatches,
}) => ({
  status,
  reason,
  quality,
  ocrDetected: Boolean(ocrDetected),
  message: messageForReason(reason, documentType),
  ...(metrics ? { metrics } : {}),
  // Debug/diagnostic fields for server logs and tests. These are NOT attached
  // to the resident-facing screening object (see documents.service.js).
  ...(documentIndicatorMatches ? { documentIndicatorMatches } : {}),
  ...(genericIndicatorMatches ? { genericIndicatorMatches } : {}),
});

const reject = (
  reason,
  documentType,
  quality = IMAGE_QUALITY.NOT_ANALYZED,
  metrics,
  documentIndicatorMatches = [],
  genericIndicatorMatches = [],
  ocrDetected = false,
) => toResult({
  status: SCREENING_STATUS.AUTOMATED_REJECTED,
  reason,
  documentType,
  quality,
  metrics,
  ocrDetected,
  documentIndicatorMatches,
  genericIndicatorMatches,
});

const flagged = (reason, documentType, quality, metrics, ocrDetected = true) =>
  toResult({ status: SCREENING_STATUS.AUTOMATED_FLAGGED, reason, documentType, quality, ocrDetected, metrics });

const manualReview = (reason, documentType, quality, ocrDetected = false, metrics, indicatorMatches) =>
  toResult({
    status: SCREENING_STATUS.PENDING_MANUAL_REVIEW,
    reason,
    documentType,
    quality,
    ocrDetected,
    metrics,
    documentIndicatorMatches: indicatorMatches?.strongMatches,
    genericIndicatorMatches: indicatorMatches?.genericMatches,
  });

/**
 * Screen one uploaded document buffer.
 *
 * @param {object} input
 * @param {Buffer} input.buffer          raw uploaded bytes (never a URL)
 * @param {string} input.mimeType        client-declared MIME (re-verified)
 * @param {string} [input.documentType]  KALUSAGAP document type
 * @param {string} [input.governmentIdType]
 * @param {number} [input.sizeBytes]
 * @param {Function} [input.ocr]         injectable OCR for tests / offline use
 * @returns {Promise<object>} structured, non-sensitive screening result
 */
const screenDocumentCore = async ({
  buffer,
  mimeType,
  documentType = 'proof_of_residency',
  governmentIdType,
  sizeBytes,
  ocr,
  ocrTimeoutMs = OCR_TIMEOUT_MS,
  onDiagnostic,
  onOcrText,
} = {}) => {
  const diagnostic = (fields) => onDiagnostic?.(fields);
  diagnostic({ stage: 'file_validation' });
  governmentIdType = normalizeGovernmentIdType(governmentIdType);
  const size = Number.isFinite(sizeBytes) ? sizeBytes : buffer?.length ?? 0;
  const rule = ruleForDocumentType(documentType);

  // 1–2. Deterministic file checks (re-run here as defence in depth: the upload
  // middleware also enforces these before the buffer reaches the service).
  const basicError = validateFileBasics({ buffer, mimeType, sizeBytes: size });
  if (basicError) return reject(basicError.error, documentType);

  // A holding-ID identity photo is an image, never a PDF. The normal upload
  // validator enforces this too; the screening endpoint must enforce it alone.
  if (documentType === 'identity_photo' && !['image/png', 'image/jpeg', 'image/jpg'].includes(mimeType)) {
    return reject(SCREENING_REASON.INVALID_FILE_TYPE, documentType);
  }

  // A PDF cannot be pixel-analysed or OCR'd without a renderer. It is a valid
  // document format, so it goes to staff rather than being auto-rejected.
  if (mimeType === 'application/pdf') {
    return manualReview(SCREENING_REASON.DOCUMENT_NOT_AUTOMATICALLY_SCREENED, documentType, IMAGE_QUALITY.NOT_ANALYZED);
  }

  // 3–5. Decode + dimensions + image quality.
  let quality = IMAGE_QUALITY.NOT_ANALYZED;
  let metrics;
  let decoded = null;
  if (rule.analyzeImage) {
    diagnostic({ stage: 'image_decode' });
    try {
      decoded = decodeImage(buffer, mimeType);
    } catch {
      return reject(SCREENING_REASON.CORRUPTED_FILE, documentType);
    }
    if (!decoded || !decoded.width || !decoded.height) {
      return reject(SCREENING_REASON.CORRUPTED_FILE, documentType);
    }
    const analysis = analyzeImageQuality(decoded);
    quality = analysis.quality;
    metrics = analysis.metrics;
    diagnostic({ stage: 'image_quality' });

    // Only CLEARLY_UNUSABLE is a hard quality rejection. LOW_QUALITY_BUT_
    // PROCESSABLE and TOO_BRIGHT are warnings: OCR still runs and the document
    // indicators decide. A small-but-readable ID (e.g. 741×269) is processable.
    if (quality === IMAGE_QUALITY.CLEARLY_UNUSABLE) {
      return reject(SCREENING_REASON.INSUFFICIENT_RESOLUTION, documentType, quality, metrics);
    }
    if (quality === IMAGE_QUALITY.TOO_DARK) return reject(SCREENING_REASON.TOO_DARK, documentType, quality, metrics);
    if (quality === IMAGE_QUALITY.BLANK_IMAGE) return reject(SCREENING_REASON.BLANK_IMAGE, documentType, quality, metrics);
    // Heavy glare/over-bright: readable but hard to read — flag for a human
    // instead of auto-rejecting (existing conservative policy).
    if (quality === IMAGE_QUALITY.TOO_BRIGHT) return flagged(SCREENING_REASON.TOO_BRIGHT, documentType, quality, metrics, false);
    // LOW_QUALITY_BUT_PROCESSABLE continues to OCR below.
  }

  // This service has no reliable face/document detector or same-ID comparison.
  // After file and image-quality checks, retain identity photos for staff review
  // rather than treating OCR text as proof of a person holding an ID.
  if (documentType === 'identity_photo') {
    return manualReview(
      SCREENING_REASON.IMAGE_REQUIRES_MANUAL_REVIEW,
      documentType,
      quality,
      false,
      metrics,
    );
  }

  // Other non-text document types are retained for staff review.
  if (!rule.requireMeaningfulText) {
    return manualReview(SCREENING_REASON.IMAGE_REQUIRES_MANUAL_REVIEW, documentType, quality, false, metrics);
  }

  // 6. OCR. A missing/failed engine is NOT evidence against the document.
  let ocrResult;
  let timeoutHandle;
  diagnostic({
    stage: 'ocr',
    ocrProvider: ocr ? 'injected' : 'tesseract.js',
    ocrProviderAvailability: ocr ? 'available' : 'unknown',
    ocrExecutionStatus: 'started',
  });
  try {
    const runOcr = ocr || extractTextWithTesseract;
    const timeout = new Promise((_, rejectPromise) => {
      timeoutHandle = setTimeout(() => {
        const error = new Error('OCR timed out');
        error.code = 'OCR_TIMEOUT';
        rejectPromise(error);
      }, ocrTimeoutMs);
    });
    ocrResult = await Promise.race([runOcr(buffer, mimeType), timeout]);
    diagnostic({
      stage: 'ocr',
      ocrProviderAvailability: ocrResult?.ok === false ? 'unavailable' : 'available',
      ocrExecutionStatus: ocrResult?.ok === false ? 'unavailable' : 'completed',
      ocrCharacterCount: String(ocrResult?.text ?? '').length,
    });
  } catch (error) {
    const timedOut = error?.code === 'OCR_TIMEOUT';
    diagnostic({
      stage: 'ocr',
      ocrProviderAvailability: timedOut ? 'unknown' : 'unavailable',
      ocrExecutionStatus: timedOut ? 'timeout' : 'error',
      ocrCharacterCount: 0,
    });
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return manualReview(
      timedOut ? SCREENING_REASON.OCR_TIMEOUT : SCREENING_REASON.OCR_UNAVAILABLE,
      documentType,
      quality,
      false,
      metrics,
    );
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
  if (!ocrResult || ocrResult.ok === false) {
    return manualReview(
      SCREENING_REASON.OCR_UNAVAILABLE,
      documentType,
      quality,
      false,
      metrics,
    );
  }

  // 7. Document-specific indicator check on the normalised text.
  //
  // OCR text alone is not proof of a document. Front-side documents require
  // strong type indicators; back-side ambiguity routes to staff review instead
  // of a front-title-based rejection.
  onOcrText?.(String(ocrResult.text ?? ''));
  const normalized = normalizeText(ocrResult.text);
  const hasStrongDocumentEvidence = matchesDocumentIndicator(normalized, documentType, governmentIdType)
    || detectGovernmentIdTypeFromText(normalized).length > 0;
  diagnostic({ stage: 'classification', ocrCharacterCount: normalized.length });
  if (!hasMeaningfulText(normalized) && !hasStrongDocumentEvidence) {
    if (documentType === 'government_id_back') {
      return flagged(
        SCREENING_REASON.DOCUMENT_SIDE_INCONCLUSIVE,
        documentType,
        quality,
        metrics,
        false,
      );
    }
    return reject(SCREENING_REASON.NO_MEANINGFUL_TEXT, documentType, quality, metrics, [], [], Boolean(normalized.trim()));
  }

  // 8. Type-specific evidence.
  //
  // A clearly detected different supported type is a defensible front-side
  // mismatch. Missing front indicators and back-side layout differences remain
  // inconclusive and are routed to staff instead of being treated as invalid.
  const isBackSide = documentType === 'government_id_back';
  const evidence = inspectTypeEvidence(normalized, documentType, governmentIdType);
  const indicatorMatches = findDocumentIndicators(normalized, documentType, governmentIdType);
  const profile = getGovernmentIdProfile(documentType, governmentIdType);

  if (documentType === 'government_id_front' || documentType === 'government_id') {
    if (evidence.status === 'mismatch') {
      // Selected Postal ID but OCR shows a passport / PhilSys / etc.
      return toResult({
        status: SCREENING_STATUS.AUTOMATED_REJECTED,
        reason: SCREENING_REASON.DOCUMENT_TYPE_MISMATCH,
        documentType,
        quality,
        metrics,
        ocrDetected: true,
        documentIndicatorMatches: indicatorMatches.strongMatches,
        genericIndicatorMatches: indicatorMatches.genericMatches,
      });
    }
    if (evidence.status === 'none') {
      // Government-ID front images must include explicit document indicators.
      // Generic OCR words (name, address, date of birth, etc.) are not enough,
      // and a wordy non-document screenshot must be rejected rather than passed
      // to staff as if it were a plausible ID.
      return reject(
        SCREENING_REASON.NO_DOCUMENT_INDICATORS,
        documentType,
        quality,
        metrics,
        indicatorMatches.strongMatches,
        indicatorMatches.genericMatches,
        true,
      );
    }
    // evidence.status === 'match' -> manual review below.
  } else if (isBackSide && governmentIdType !== 'other') {
    // A different accepted ID type on the back is a real mismatch, even when the
    // selected ID type itself has no front-side heading text on this side.
    if (evidence.status === 'mismatch') {
      return toResult({
        status: SCREENING_STATUS.AUTOMATED_REJECTED,
        reason: SCREENING_REASON.DOCUMENT_TYPE_MISMATCH,
        documentType,
        quality,
        metrics,
        ocrDetected: true,
        documentIndicatorMatches: indicatorMatches.strongMatches,
        genericIndicatorMatches: indicatorMatches.genericMatches,
      });
    }
    // Only positive evidence of a different supported ID type proves a
    // mismatch on the back; missing front-only headings/portrait evidence does
    // not. Back-side fields and recognized indicators route to staff review.
    const strongMatches = indicatorMatches.strongMatches;
    if (strongMatches.length === 0) {
      // Back sides may contain printed fields or side-specific supporting text
      // rather than the selected ID's front heading.
      const supporting = profile?.supporting || [];
      const supportingMatches = governmentIdType === 'philsys'
        ? matchedOcrPhrases(normalized, supporting)
        : matchedPhrases(normalized, supporting);
      if (supportingMatches.length > 0) {
        return toResult({
          status: SCREENING_STATUS.PENDING_MANUAL_REVIEW,
          reason: SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED,
          documentType,
          quality,
          metrics,
          ocrDetected: true,
          documentIndicatorMatches: supportingMatches,
          genericIndicatorMatches: indicatorMatches.genericMatches,
        });
      }
      if (indicatorMatches.genericMatches.length > 0) {
        return manualReview(
          SCREENING_REASON.DOCUMENT_SIDE_INCONCLUSIVE,
          documentType,
          quality,
          true,
          metrics,
          indicatorMatches,
        );
      }
      return flagged(
        SCREENING_REASON.DOCUMENT_SIDE_INCONCLUSIVE,
        documentType,
        quality,
        metrics,
        true,
      );
    }
  } else if (isBackSide) {
    // Without a selected subtype the back still cannot be compared to front
    // indicators. Ambiguous side evidence goes to staff, never a type mismatch.
    if (indicatorMatches.strongMatches.length === 0) {
      return flagged(
        SCREENING_REASON.DOCUMENT_SIDE_INCONCLUSIVE,
        documentType,
        quality,
        metrics,
        true,
      );
    }
  } else {
    // proof_of_residency, barangay_*, transfer_*: general strong indicators.
    if (indicatorMatches.strongMatches.length === 0) {
      return reject(SCREENING_REASON.NO_DOCUMENT_INDICATORS, documentType, quality, metrics);
    }
  }

  return manualReview(
    SCREENING_REASON.DOCUMENT_INDICATORS_DETECTED,
    documentType,
    quality,
    true,
    metrics,
    indicatorMatches,
  );
};

const SAFE_DOCUMENT_TYPES = new Set([
  'government_id',
  'government_id_front',
  'government_id_back',
  'identity_photo',
  'proof_of_residency',
  'barangay_certificate',
  'barangay_clearance',
  'transfer_proof_of_address',
  'transfer_previous_health_record',
  'other',
]);

const SAFE_GOVERNMENT_ID_TYPES = new Set([
  'philsys',
  'drivers_license',
  'passport',
  'umid',
  'prc_id',
  'postal_id',
  'other',
]);

const screeningSide = (documentType) => {
  if (documentType === 'government_id_front') return 'front';
  if (documentType === 'government_id_back') return 'back';
  return 'single';
};

/** Screen one document and log only safe correlation/rule metadata. */
export const screenDocument = async (input = {}) => {
  const normalizedDocumentType = String(input.documentType || 'proof_of_residency').trim().toLowerCase();
  const documentType = SAFE_DOCUMENT_TYPES.has(normalizedDocumentType) ? normalizedDocumentType : 'other';
  const normalizedIdType = normalizeGovernmentIdType(input.governmentIdType);
  const governmentIdType = SAFE_GOVERNMENT_ID_TYPES.has(normalizedIdType) ? normalizedIdType : 'other';
  const trace = {
    stage: 'received',
    ocrProvider: input.ocr ? 'injected' : 'tesseract.js',
    ocrProviderAvailability: input.ocr ? 'available' : 'unknown',
    ocrExecutionStatus: 'not_started',
    ocrCharacterCount: 0,
  };
  let result;
  try {
    result = await screenDocumentCore({
      ...input,
      documentType,
      governmentIdType,
      onDiagnostic: (fields) => Object.assign(trace, fields),
      onOcrText: input.onOcrText,
    });
  } catch (error) {
    if (input.requestId) {
      console.info(JSON.stringify({
        event: 'document_screening',
        requestId: input.requestId,
        documentSlot: documentType,
        side: screeningSide(documentType),
        governmentIdType,
        ...trace,
        failedRule: 'SCREENING_EXCEPTION',
        finalStatus: 'technical_error',
        finalReason: 'SCREENING_TECHNICAL_ERROR',
      }));
    }
    throw error;
  }

  if (input.requestId) {
    console.info(JSON.stringify({
      event: 'document_screening',
      requestId: input.requestId,
      documentSlot: documentType,
      side: screeningSide(documentType),
      governmentIdType,
      ...trace,
      failedRule: result.status === SCREENING_STATUS.AUTOMATED_REJECTED ? result.reason : null,
      finalStatus: result.status,
      finalReason: result.reason,
    }));
  }
  return result;
};

const normalizeComparableValue = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[|]/g, '1')
    .replace(/[^a-z0-9]/g, '');

const normalizeComparableName = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[|]/g, 'i')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const valueAfterLabel = (text, labels) => {
  const lines = String(text || '').split(/\r?\n/);
  const labelPattern = new RegExp(`^\\s*(?:${labels})\\s*[:#.-]?\\s*$`, 'i');
  const valuePattern = new RegExp(`^\\s*(?:${labels})(?:\\s*[:#.-]\\s*|\\s+)(.{3,})$`, 'i');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = line.replace(/[|]/g, '1').replace(/\s+/g, ' ').trim();
    const match = normalizedLine.match(valuePattern);
    if (match?.[1]) {
      const value = match[1].trim();
      if (/^of\s+(?:father|mother|spouse|parent)\b/i.test(value)) continue;
      return value;
    }
    if (labelPattern.test(normalizedLine)) {
      const nextValue = lines.slice(index + 1).find((next) => next.trim());
      if (
        nextValue
        && !/^\s*(?:name(?:\s+of\s+cardholder)?|full name|cardholder name|surname|last name|family name|given names?|first name|middle name|date of birth|birth date|dob|id number|id no|card number|card no|philsys(?: card)? number|pcn)\b\s*[:#.-]?\s*$/i.test(nextValue)
      ) return nextValue.trim();
    }
  }
  return '';
};

const validIsoDate = (year, month, day) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const normalizeShortYear = (year) =>
  year < 100 ? (year >= 50 ? 1900 + year : 2000 + year) : year;

const parseComparableDate = (value) => {
  const text = String(value || '').replace(/[|]/g, '1').replace(/\s+/g, ' ').trim();
  const monthNames = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
    october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const monthExpression = Object.keys(monthNames).join('|');
  const textual = text.match(new RegExp(
    `\\b(${monthExpression})\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(\\d{2,4})\\b|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthExpression})[,]?\\s+(\\d{2,4})\\b`,
    'i',
  ));
  if (textual) {
    const month = monthNames[(textual[1] || textual[5]).toLowerCase()];
    const day = Number(textual[2] || textual[4]);
    const year = normalizeShortYear(Number(textual[3] || textual[6]));
    const date = validIsoDate(year, month, day);
    return date ? { raw: normalizeComparableValue(textual[0]), candidates: [date] } : null;
  }

  const numeric = text.match(/\b(?:\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b/);
  if (!numeric) return null;
  const parts = numeric[0].split(/[\/.-]/).map(Number);
  const candidates = [];
  if (parts[0] > 31) {
    const date = validIsoDate(parts[0], parts[1], parts[2]);
    if (date) candidates.push(date);
  } else {
    const year = normalizeShortYear(parts[2]);
    const firstOrder = validIsoDate(year, parts[0], parts[1]);
    const secondOrder = validIsoDate(year, parts[1], parts[0]);
    if (firstOrder) candidates.push(firstOrder);
    if (secondOrder && !candidates.includes(secondOrder)) candidates.push(secondOrder);
  }
  return candidates.length
    ? { raw: normalizeComparableValue(numeric[0]), candidates }
    : null;
};

const comparableFieldsFromOcr = (text) => {
  const fields = {};
  const name = valueAfterLabel(
    text,
    'name\\s+of\\s+cardholder|cardholder\\s+name|full\\s+name|name',
  );
  if (name) fields.name = normalizeComparableName(name);

  const nameParts = [
    ['surname', 'surname|last\\s+name|family\\s+name'],
    ['givenName', 'given\\s+names?|first\\s+name'],
    ['middleName', 'middle\\s+name'],
  ];
  for (const [field, labels] of nameParts) {
    const value = valueAfterLabel(text, labels);
    if (value) fields[field] = normalizeComparableValue(value);
  }

  const birthDate = valueAfterLabel(text, 'date\\s+of\\s+birth|birth\\s+date|dob');
  const date = parseComparableDate(birthDate);
  if (date) fields.dateOfBirth = date;

  const labelledNumber = valueAfterLabel(
    text,
    'pcn|philsys\\s+(?:card\\s+)?number|id\\s+(?:number|no)|card\\s+(?:number|no)',
  );
  const numberText = labelledNumber.split(
    /\b(?:address|date of birth|birth date|name|surname|given names?|middle name|nationality|sex|signature)\b/i,
  )[0];
  const numberMatch = numberText.match(/[a-z0-9][a-z0-9 -]{4,24}/i);
  if (numberMatch) {
    const number = normalizeComparableValue(numberMatch[0]);
    if (number.length >= 6 && number.length <= 24) fields.idNumber = number;
  }
  return fields;
};

const editDistanceAtMostOne = (left, right) => {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
    } else {
      edits += 1;
      if (edits > 1) return false;
      if (left.length >= right.length) i += 1;
      if (right.length >= left.length) j += 1;
    }
  }
  return edits + Number(i < left.length || j < right.length) <= 1;
};

const compareNames = (left, right) => {
  const leftParts = left.split(/\s+/).filter(Boolean);
  const rightParts = right.split(/\s+/).filter(Boolean);
  if (leftParts.length < 2 || rightParts.length < 2 || leftParts.length !== rightParts.length) return null;
  let allMatch = true;
  for (let index = 0; index < leftParts.length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === rightPart) continue;
    if (leftPart.length < 4 || rightPart.length < 4) return null;
    if (!editDistanceAtMostOne(leftPart, rightPart)) allMatch = false;
  }
  return allMatch;
};

/**
 * Compare only labelled fields that OCR independently found on both ID sides.
 * Returned metadata intentionally excludes field values and is not proof of
 * authenticity; it is advisory input for authorized staff review.
 */
export const crossVerifyGovernmentIdSides = (frontText, backText) => {
  const front = comparableFieldsFromOcr(frontText);
  const back = comparableFieldsFromOcr(backText);
  const comparedFields = [];
  const conflictingFields = [];

  for (const field of ['name', 'surname', 'givenName', 'middleName', 'dateOfBirth', 'idNumber']) {
    if (!front[field] || !back[field]) continue;
    let matches;
    if (field === 'name') {
      matches = compareNames(front[field], back[field]);
      if (matches === null) continue;
    } else if (field === 'dateOfBirth') {
      if (front[field].raw === back[field].raw) matches = true;
      else if (front[field].candidates.length === 1 && back[field].candidates.length === 1) {
        matches = front[field].candidates[0] === back[field].candidates[0];
      } else continue;
    } else if (field === 'idNumber') {
      if (front[field].length < 6 || back[field].length < 6) continue;
      matches = front[field] === back[field] || editDistanceAtMostOne(front[field], back[field]);
    } else {
      if (front[field] === back[field]) matches = true;
      else if (front[field].length >= 4 && back[field].length >= 4) matches = editDistanceAtMostOne(front[field], back[field]);
      else continue;
    }
    comparedFields.push(field);
    if (!matches) conflictingFields.push(field);
  }

  return {
    status: conflictingFields.length ? 'conflict' : comparedFields.length ? 'consistent' : 'inconclusive',
    comparedFields,
    conflictingFields,
  };
};

/** Apply advisory cross-side evidence without granting verification. */
export const applyGovernmentIdCrossVerification = (front, back, comparison) => {
  const crossVerificationMessage = comparison.status === 'conflict'
    ? SCREENING_MESSAGES.ID_SIDE_FIELDS_CONFLICT
    : comparison.status === 'consistent'
      ? 'Available overlapping details did not conflict. This is not proof of authenticity; staff review is still required.'
      : SCREENING_MESSAGES.ID_SIDE_COMPARISON_INCONCLUSIVE;
  const metadata = {
    status: comparison.status,
    comparedFields: comparison.comparedFields,
    conflictingFields: comparison.conflictingFields,
    message: crossVerificationMessage,
  };

  const applyResult = (screening) => {
    const sideReason = screening.sideReason || screening.reason;
    let status = screening.status;
    let reason = screening.reason;
    if (comparison.status === 'conflict') {
      status = SCREENING_STATUS.AUTOMATED_FLAGGED;
      reason = SCREENING_REASON.ID_SIDE_FIELDS_CONFLICT;
    } else if (comparison.status === 'inconclusive') {
      if (status !== SCREENING_STATUS.AUTOMATED_REJECTED) {
        status = SCREENING_STATUS.AUTOMATED_FLAGGED;
        reason = SCREENING_REASON.ID_SIDE_COMPARISON_INCONCLUSIVE;
      }
    } else if (
      status === SCREENING_STATUS.AUTOMATED_FLAGGED
      && [
        SCREENING_REASON.DOCUMENT_SIDE_INCONCLUSIVE,
        SCREENING_REASON.ID_TYPE_UNCONFIRMED,
        SCREENING_REASON.NO_DOCUMENT_INDICATORS,
      ].includes(reason)
    ) {
      status = SCREENING_STATUS.PENDING_MANUAL_REVIEW;
    }
    return {
      ...screening,
      status,
      reason,
      sideReason,
      crossVerification: metadata,
      crossVerificationMessage,
    };
  };
  return {
    front: applyResult(front),
    back: applyResult(back),
  };
};

export default {
  screenDocument,
  crossVerifyGovernmentIdSides,
  applyGovernmentIdCrossVerification,
  sniffFileType,
  validateFileBasics,
  decodeImage,
  analyzeImageQuality,
  extractTextWithTesseract,
  normalizeText,
  hasMeaningfulText,
  findDocumentIndicators,
  detectGovernmentIdTypeFromText,
  inspectTypeEvidence,
  matchesDocumentIndicator,
};

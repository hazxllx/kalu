/**
 * KALUSAGAP — rule-based automated document screening configuration.
 *
 * IMPORTANT SCOPE
 * ---------------
 * This configuration powers a DETERMINISTIC pre-screening step only. It does
 * NOT authenticate a government ID, does NOT confirm identity, and uses no AI,
 * machine learning or computer vision. It answers one narrow question: is this
 * uploaded file a readable document that is worth an authorized staff member's
 * review time?
 *
 * Final document and identity verification always remains with authorized
 * KALUSAGAP personnel. An automated result never permanently blocks a staff
 * member from viewing or deciding on a document.
 *
 * All thresholds and text indicators here are intentionally configurable: the
 * KALUSAGAP health office can adjust them without touching the screening
 * service.
 */

/** Lifecycle of the automated check, stored on public.documents. */
export const SCREENING_STATUS = Object.freeze({
  PENDING_MANUAL_REVIEW: 'pending_manual_review',
  AUTOMATED_FLAGGED: 'automated_flagged',
  AUTOMATED_REJECTED: 'automated_rejected',
});

/** Machine-readable reason codes (stored, never shown verbatim to residents). */
export const SCREENING_REASON = Object.freeze({
  // OCR found text matching the SELECTED government ID type's indicators.
  // Still only routes to manual review; never auto-approval.
  DOCUMENT_INDICATORS_DETECTED: 'DOCUMENT_INDICATORS_DETECTED',
  // OCR found distinctive text of a DIFFERENT accepted Philippine ID type than
  // the one the resident selected (e.g. selected Postal ID, uploaded passport).
  DOCUMENT_TYPE_MISMATCH: 'DOCUMENT_TYPE_MISMATCH',
  DOCUMENT_SIDE_INCONCLUSIVE: 'DOCUMENT_SIDE_INCONCLUSIVE',
  ID_TYPE_UNCONFIRMED: 'ID_TYPE_UNCONFIRMED',
  ID_SIDE_FIELDS_CONFLICT: 'ID_SIDE_FIELDS_CONFLICT',
  ID_SIDE_FIELDS_CONSISTENT: 'ID_SIDE_FIELDS_CONSISTENT',
  ID_SIDE_COMPARISON_INCONCLUSIVE: 'ID_SIDE_COMPARISON_INCONCLUSIVE',
  OCR_TIMEOUT: 'OCR_TIMEOUT',
  SCREENING_TECHNICAL_ERROR: 'SCREENING_TECHNICAL_ERROR',
  // Retained for non-ID document rules that use an explicit indicator check.
  // Missing government-ID indicators route to ID_TYPE_UNCONFIRMED instead.
  NO_DOCUMENT_INDICATORS: 'NO_DOCUMENT_INDICATORS',
  IMAGE_REQUIRES_MANUAL_REVIEW: 'IMAGE_REQUIRES_MANUAL_REVIEW',
  DOCUMENT_NOT_AUTOMATICALLY_SCREENED: 'DOCUMENT_NOT_AUTOMATICALLY_SCREENED',
  OCR_UNAVAILABLE: 'OCR_UNAVAILABLE',
  NO_MEANINGFUL_TEXT: 'NO_MEANINGFUL_TEXT',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  CORRUPTED_FILE: 'CORRUPTED_FILE',
  INSUFFICIENT_RESOLUTION: 'INSUFFICIENT_RESOLUTION',
  BLANK_IMAGE: 'BLANK_IMAGE',
  TOO_DARK: 'TOO_DARK',
  TOO_BRIGHT: 'TOO_BRIGHT',
  LOW_IMAGE_QUALITY: 'LOW_IMAGE_QUALITY',
});

/** Deterministic image-quality outcomes. */
export const IMAGE_QUALITY = Object.freeze({
  VALID: 'VALID',
  // Readable enough to attempt OCR, but weak (low contrast or small
  // dimensions). This is a WARNING, not a rejection: OCR decides.
  LOW_QUALITY_BUT_PROCESSABLE: 'LOW_QUALITY_BUT_PROCESSABLE',
  // Below the absolute processing floor — genuinely too small/unusable.
  CLEARLY_UNUSABLE: 'CLEARLY_UNUSABLE',
  LOW_QUALITY: 'LOW_QUALITY',
  BLANK_IMAGE: 'BLANK_IMAGE',
  TOO_DARK: 'TOO_DARK',
  TOO_BRIGHT: 'TOO_BRIGHT',
  INSUFFICIENT_RESOLUTION: 'INSUFFICIENT_RESOLUTION',
  UNREADABLE: 'UNREADABLE',
  NOT_ANALYZED: 'NOT_ANALYZED',
});

/**
 * Resident-facing messages. These are deliberately non-technical: a resident
 * must never learn about OCR, file signatures, MIME types or internal reason
 * codes. `PASSED` is also used for documents that need manual review.
 */
export const SCREENING_MESSAGES = Object.freeze({
  PASSED:
    'Document uploaded successfully. Your identification document will be reviewed by authorized staff.',
  INVALID_FILE:
    'Upload rejected. The uploaded file does not meet the document requirements. Please upload a clear copy of your identification document.',
  LOW_QUALITY: 'The uploaded image is difficult to read. Please upload a clearer image.',
  UNUSABLE_IMAGE:
    'The uploaded image is too small or unreadable. Please upload a clear photo or scan of your identification document.',
  NO_TEXT:
    'We could not read enough information from the uploaded document. Please upload a clear photo or scan of your identification document.',
  // Used for non-ID document checks with a defensible indicator requirement. OCR text alone is not enough.
  NO_DOCUMENT_INDICATORS:
    'The uploaded image does not appear to contain the required identification document information. Please upload a clear copy of your accepted government-issued ID.',
  IDENTITY_PHOTO_MANUAL_REVIEW:
    'We could not automatically verify this photo. Staff review is required.',
  IDENTITY_PHOTO_INVALID_FILE:
    'Please upload a valid JPG or PNG photo of yourself holding your government ID.',
  IDENTITY_PHOTO_FILE_SIZE:
    'This identity photo is too large. Please upload a JPG or PNG photo under 10 MB.',
  // The upload looks like a DIFFERENT accepted Philippine ID than the one the
  // resident selected (e.g. selected Postal ID, uploaded passport).
  DOCUMENT_TYPE_MISMATCH:
    'The uploaded document does not match the selected government ID type. Please upload the selected ID.',
  DOCUMENT_SIDE_INCONCLUSIVE:
    'We could not confirm this ID side or the selected ID type automatically. Staff review is required; this result does not mean the ID is invalid.',
  ID_SIDE_FIELDS_CONFLICT:
    'Some readable details on the front and back appear inconsistent. Please check that both images are from the same ID. Staff review is required.',
  ID_SIDE_COMPARISON_INCONCLUSIVE:
    'We could not compare enough information across both sides. Staff review is required.',
  ID_TYPE_UNCONFIRMED:
    'We could not automatically confirm the selected ID type. Staff review is required; unsupported documents may need replacement.',
  OCR_INCONCLUSIVE:
    'We could not complete the automatic document check. Staff review is required.',
  NO_DOCUMENT_INDICATORS_RESIDENCY:
    'The uploaded file does not appear to contain the required residency document information. Please upload a clear copy of your proof of residency.',
  FILE_SIZE:
    'File size is not supported. Please upload a clear copy of your identification document.',
});

/**
 * Image/camera quality thresholds. A file only needs to be readable, not
 * "authentic": the checks below detect unusable uploads (blank, black or
 * genuinely unprocessable images), never the subject of the photo.
 *
 * Dimensions are a WARNING signal, not a hard rejection:
 *   - Below `minProcessableWidth/Height`  -> CLEARLY_UNUSABLE (rejected): the
 *     image is too small for OCR to have a chance (e.g. 100×60).
 *   - Below `warnWidth/Height`            -> LOW_QUALITY_BUT_PROCESSABLE
 *     (warning only): OCR still runs and decides via document indicators.
 * A legitimate 741×269 Postal ID must NOT be rejected for its size.
 */
export const IMAGE_LIMITS = Object.freeze({
  // Absolute processing floor — reject only images genuinely too small.
  minProcessableWidth: 200,
  minProcessableHeight: 120,
  // "Small but readable" warning band.
  warnWidth: 600,
  warnHeight: 400,
  // Pixel luminance bands (0–255).
  darkPixel: 25,
  brightPixel: 235,
  // Share of pixels in a band before the image is considered dominated by it.
  darkRatio: 0.9,
  brightRatio: 0.9,
  // Standard deviation of luminance. Below this the image is too flat to read;
  // a real scanned ID with printed text almost always exceeds it.
  minContrast: 4,
  // Heavy-glare band: readable but flagged to a human instead of rejected.
  glareContrast: 6,
  meanDark: 40,
  meanBright: 235,
  // Cap pixel sampling so a large photo is analysed in bounded time.
  maxSamples: 250000,
});

/** Thresholds that decide whether OCR produced "meaningful" document text. */
export const OCR_LIMITS = Object.freeze({
  language: 'eng',
  minCharacters: 15,
  minWords: 3,
  minWordLength: 3,
});

/**
 * Document indicators.
 *
 * Matching is evidence-based with bounded OCR tolerance. `strong` phrases are distinctive,
 * multi-word indicators of an accepted document. `generic` phrases (e.g. "name",
 * "date of birth", "address", "id number") commonly appear in games, websites
 * and ordinary photos, so they are NEVER sufficient on their own — they are
 * recorded for debugging only.
 *
 * Strong indicators can route an ID to staff review. Missing indicators are
 * inconclusive, not proof that an otherwise plausible ID is invalid.
 *
 * The indicator set for a government-ID upload is chosen by the SELECTED
 * governmentIdType when it is known (postal_id, passport, philsys, …), falling
 * back to the union for `government_id`. Each accepted Philippine ID has its own
 * layout and terminology — one indicator list must never be applied to all.
 *
 * These lists are configurable by KALUSAGAP and cover only the identification
 * documents KALUSAGAP already accepts (see GOVERNMENT_ID_TYPES): PhilSys,
 * driver's licence, passport, UMID, PRC ID and Postal ID.
 */
const PHILSYS_STRONG = Object.freeze([
  'philippine identification system',
  'philippine identification',
  'philippine identification card',
  'philippine id card',
  'philippine id',
  'national identification system',
  'national id',
  'pambansang pagkakakilanlan',
  'philsys',
  'philsys id',
]);

// Back-side field labels can be useful to route an ambiguous image to staff,
// but generic fields are never proof of ID type and never auto-approve.
const ID_BACK_SUPPORTING = Object.freeze([
  'address',
  'date of birth',
  'birth date',
  'signature',
  'nationality',
  'sex',
  'issued on',
  'issued at',
  'valid until',
  'expiry',
]);

const BACK_SIDE_INDICATORS_BY_TYPE = Object.freeze({
  philsys: Object.freeze([
    'philsys',
    'address', 'date of birth', 'signature', 'nationality', 'sex',
    'issued on', 'issued at',
  ]),
  drivers_license: Object.freeze([
    'land transportation office', 'drivers license', 'driver license',
    'license no', 'license number', 'address', 'date of birth',
    'restrictions', 'conditions',
  ]),
  passport: Object.freeze([
    'philippine passport', 'passport no', 'passport number',
    'nationality', 'signature', 'republic of the philippines',
  ]),
  umid: Object.freeze([
    'unified multi purpose id', 'umid', 'gsis', 'sss',
    'signature', 'address', 'date of birth',
  ]),
  prc_id: Object.freeze([
    'professional regulation commission', 'professional identification card',
    'prc id', 'registration no', 'license no', 'valid until',
  ]),
  postal_id: Object.freeze([
    'philippine postal corporation', 'postal identification card',
    'postal id', 'phlpost', 'address', 'date of birth', 'signature',
  ]),
});

const PHILSYS_SUPPORTING = Object.freeze([
  'republic of the philippines',
  'republika ng pilipinas',
]);

const PHILSYS_GENERIC = Object.freeze([
  'name',
  'address',
  'date of birth',
  'birth date',
  'id number',
  'id no',
  'signature',
  'nationality',
  'sex',
  'card',
  'identity',
]);

const PASSPORT_STRONG = Object.freeze([
  'republic of the philippines',
  'philippine passport',
  'passport no',
  'passport number',
]);

const PASSPORT_GENERIC = Object.freeze([
  'name',
  'surname',
  'given name',
  'date of birth',
  'nationality',
  'sex',
  'passport',
]);

/**
 * Driver's licence profile. A foreign "DRIVER LICENSE" must NOT pass on the
 * word "license" alone. Strong indicators are Philippine-specific; see the
 * PH-context guard for drivers_license in inspectTypeEvidence (a bare foreign
 * licence without "Republic of the Philippines"/"Land Transportation Office"
 * never matches).
 */
const DRIVERS_LICENSE_STRONG = Object.freeze([
  'republic of the philippines',
  'land transportation office',
  'philippine driver s license',
  'philippine drivers license',
  'driver s license',
  'drivers license',
  'driver license',
]);

const DRIVERS_LICENSE_GENERIC = Object.freeze([
  'name',
  'address',
  'date of birth',
  'license',
  'license no',
  'sex',
]);

const UMID_STRONG = Object.freeze([
  'republic of the philippines',
  'unified multi purpose id',
  'umid',
  'gsis',
  'sss',
]);

const UMID_GENERIC = Object.freeze([
  'name',
  'address',
  'date of birth',
  'id number',
  'card',
  'member',
  'signature',
]);

const PRC_STRONG = Object.freeze([
  'republic of the philippines',
  'professional regulation commission',
  'professional identification card',
  'prc',
  'prc id',
]);

const PRC_GENERIC = Object.freeze([
  'name',
  'profession',
  'registration no',
  'license no',
  'valid until',
  'signature',
  'card',
]);

const POSTAL_ID_STRONG = Object.freeze([
  // Distinctive, accepted-Postal-ID-only phrases. "republic of the philippines"
  // is deliberately NOT here: it appears on all accepted IDs and is never proof
  // by itself. PHLPOST/PHL POST are distinctive (appear on the PHLPost layout).
  'philippine postal corporation',
  'philippine postal corp',
  'postal identification card',
  'postal id',
  'permanent postal identity card',
  'postal identity card',
  'phlpost',
  'phl post',
]);

const POSTAL_ID_SUPPORTING = Object.freeze([
  // Supporting evidence for a Postal ID front: "Republic of the Philippines"
  // plus distinctive Postal ID terms route to manual review, never approval.
  'republic of the philippines',
  'postal',
  'identification card',
]);

const POSTAL_ID_GENERIC = Object.freeze([
  'name',
  'address',
  'date of birth',
  'id number',
  'postal',
  'card',
  'signature',
]);

const GOVERNMENT_ID_STRONG = Object.freeze([
  'republic of the philippines',
  'philippine identification system',
  'philippine identification',
  'philippine identification card',
  'philsys',
  'philsys id',
  'unified multi purpose id',
  'professional regulation commission',
  'land transportation office',
  'philippine passport',
  'passport no',
  'philippine postal corporation',
  'postal identification card',
  'postal id',
  'permanent postal identity card',
  'postal identity card',
]);

/**
 * Distinctive indicators that prove a SPECIFIC accepted Philippine ID type is
 * present (not the generic union). A match on one of these, combined with
 * `governmentIdType`, drives the DOCUMENT_TYPE_MISMATCH check: if the resident
 * selected Postal ID but OCR shows a passport, that is a mismatch.
 *
 * Keys mirror `GOVERNMENT_ID_TYPES` in backend/src/validators/documents.validators.js.
 */
export const GOVERNMENT_ID_TYPE_DETECTORS = Object.freeze({
  philsys: Object.freeze([
    'philippine identification system',
    'philsys',
    'philsys id',
    'philippine identification card',
  ]),
  drivers_license: Object.freeze([
    'land transportation office',
    'driver s license',
    'drivers license',
    'driver license',
    'philippine driver s license',
    'philippine drivers license',
  ]),
  passport: Object.freeze([
    'philippine passport',
    'passport no',
    'passport number',
  ]),
  umid: Object.freeze([
    'unified multi purpose id',
    'umid',
  ]),
  prc_id: Object.freeze([
    'professional regulation commission',
    'professional identification card',
    'prc',
    'prc id',
  ]),
  postal_id: Object.freeze([
    'philippine postal corporation',
    'postal identification card',
    'postal id',
    'permanent postal identity card',
    'postal identity card',
    'phlpost',
    'phl post',
  ]),
});

const GOVERNMENT_ID_GENERIC = Object.freeze([
  'name',
  'address',
  'date of birth',
  'birth date',
  'id number',
  'id no',
  'signature',
  'nationality',
  'sex',
  'license',
  'card',
]);

const RESIDENCY_STRONG = Object.freeze([
  'certificate of residency',
  'certificate of residence',
  'proof of residency',
  'proof of address',
  'barangay certificate',
  'barangay clearance',
  'barangay residency',
  'republic of the philippines',
]);

const RESIDENCY_GENERIC = Object.freeze([
  'barangay',
  'certificate',
  'clearance',
  'residency',
  'residence',
  'address',
  'issued on',
  'issued at',
]);

/**
 * Government-ID-type -> indicator set. Keys are the values sent by the
 * registration form (GOVT_ID_TYPES in the frontend, which mirror
 * `GOVERNMENT_ID_TYPES` in the validators): philsys, drivers_license, passport,
 * umid, prc_id, postal_id, other. `other` uses the union so an unlisted
 * accepted ID still has a chance to reach manual review.
 */
const GOVERNMENT_ID_TYPE_INDICATORS = Object.freeze({
  philsys: { strong: PHILSYS_STRONG, generic: PHILSYS_GENERIC },
  passport: { strong: PASSPORT_STRONG, generic: PASSPORT_GENERIC },
  drivers_license: { strong: DRIVERS_LICENSE_STRONG, generic: DRIVERS_LICENSE_GENERIC },
  driver_license: { strong: DRIVERS_LICENSE_STRONG, generic: DRIVERS_LICENSE_GENERIC },
  umid: { strong: UMID_STRONG, generic: UMID_GENERIC },
  prc_id: { strong: PRC_STRONG, generic: PRC_GENERIC },
  prc: { strong: PRC_STRONG, generic: PRC_GENERIC },
  postal_id: { strong: POSTAL_ID_STRONG, generic: POSTAL_ID_GENERIC },
  other: { strong: GOVERNMENT_ID_STRONG, generic: GOVERNMENT_ID_GENERIC },
});

/** Export the Postal ID profile variant with supporting terms for the front. */
export const getGovernmentIdProfile = (documentType, governmentIdType, side) => {
  if (documentType === 'government_id_back') {
    return {
      ...indicatorsForDocumentType('government_id_back', governmentIdType),
      supporting: ID_BACK_SUPPORTING,
    };
  }
  if (governmentIdType === 'philsys' && documentType === 'government_id_front') {
    return {
      strong: PHILSYS_STRONG,
      supporting: PHILSYS_SUPPORTING,
      generic: PHILSYS_GENERIC,
    };
  }
  if (governmentIdType === 'postal_id' && documentType === 'government_id_front') {
    return {
      strong: POSTAL_ID_STRONG,
      supporting: POSTAL_ID_SUPPORTING,
      generic: POSTAL_ID_GENERIC,
    };
  }
  return indicatorsForDocumentType(documentType, governmentIdType);
};

/**
 * Back-side policy.
 *
 * Some IDs put most identifying/document text on the FRONT and supporting
 * fields on the BACK. Back-side indicators are therefore evaluated separately;
 * missing front-only text is uncertainty, not evidence of a different ID.
 */
const BACK_SIDE_LOOSE_STRONG = Object.freeze([
  'republic of the philippines',
  'philippines',
  'philippine postal corporation',
  'postal id',
  'postal identity card',
  'philsys',
  'philippine identification',
  'passport',
  'license',
  'drivers license',
  'unified multi purpose id',
  'umid',
  'professional regulation commission',
  'address',
  'birth date',
  'date of birth',
  'signature',
  'nationality',
  'issued on',
  'issued at',
  'valid until',
  'expiry',
]);

/**
 * Per-document-type STRONG/GENERIC indicators. A document type with a non-empty
 * `strong` list requires a strong match after OCR; text alone is never enough.
 */
export const DOCUMENT_INDICATORS = Object.freeze({
  government_id: { strong: GOVERNMENT_ID_STRONG, generic: GOVERNMENT_ID_GENERIC },
  government_id_front: { strong: GOVERNMENT_ID_STRONG, generic: GOVERNMENT_ID_GENERIC },
  government_id_back: { strong: BACK_SIDE_LOOSE_STRONG, generic: GOVERNMENT_ID_GENERIC },
  proof_of_residency: { strong: RESIDENCY_STRONG, generic: RESIDENCY_GENERIC },
  barangay_certificate: { strong: RESIDENCY_STRONG, generic: RESIDENCY_GENERIC },
  barangay_clearance: { strong: RESIDENCY_STRONG, generic: RESIDENCY_GENERIC },
  transfer_proof_of_address: { strong: RESIDENCY_STRONG, generic: RESIDENCY_GENERIC },
});

/**
 * Per-document-type screening rules.
 *
 *   analyzeImage            run the deterministic image-quality checks
 *   requireMeaningfulText   run OCR and require document-specific indicators
 *
 * `identity_photo` is a photo of a person holding an ID. Automated screening
 * only checks supported image format and image quality; person/ID presence and
 * same-ID matching remain for authorized staff because no reliable detector is
 * available here.
 */
export const DOCUMENT_SCREENING_RULES = Object.freeze({
  government_id: { analyzeImage: true, requireMeaningfulText: true },
  government_id_front: { analyzeImage: true, requireMeaningfulText: true },
  government_id_back: { analyzeImage: true, requireMeaningfulText: true },
  proof_of_residency: { analyzeImage: true, requireMeaningfulText: true },
  barangay_certificate: { analyzeImage: true, requireMeaningfulText: true },
  barangay_clearance: { analyzeImage: true, requireMeaningfulText: true },
  transfer_proof_of_address: { analyzeImage: true, requireMeaningfulText: true },
  transfer_previous_health_record: { analyzeImage: true, requireMeaningfulText: false },
  identity_photo: { analyzeImage: true, requireMeaningfulText: false },
  other: { analyzeImage: true, requireMeaningfulText: false },
});

/** Document types whose missing indicators should use the residency message. */
export const RESIDENCY_DOCUMENT_TYPES = Object.freeze([
  'proof_of_residency',
  'barangay_certificate',
  'barangay_clearance',
  'transfer_proof_of_address',
]);

/** Rules for a document type that is not explicitly configured. */
export const DEFAULT_SCREENING_RULE = Object.freeze({
  analyzeImage: true,
  requireMeaningfulText: false,
});

export const ruleForDocumentType = (documentType) =>
  DOCUMENT_SCREENING_RULES[documentType] || DEFAULT_SCREENING_RULE;

/**
 * STRONG/GENERIC indicators for a document slot.
 *
 * For a government-ID FRONT slot the SELECTED governmentIdType narrows the set
 * (e.g. postal_id -> Postal ID terms) so each accepted ID is evaluated against
 * its own terminology; other slots use the union.
 *
 * Back-side indicators are independent of the selected ID type's front-side
 * profile; absence of front-side text alone cannot establish a mismatch.
 */
export const indicatorsForDocumentType = (documentType, governmentIdType) => {
  if (documentType === 'government_id_back') {
    return {
      strong: BACK_SIDE_INDICATORS_BY_TYPE[governmentIdType] || BACK_SIDE_LOOSE_STRONG,
      generic: GOVERNMENT_ID_GENERIC,
    };
  }
  if (documentType === 'government_id_front' && governmentIdType && GOVERNMENT_ID_TYPE_INDICATORS[governmentIdType]) {
    return GOVERNMENT_ID_TYPE_INDICATORS[governmentIdType];
  }
  return DOCUMENT_INDICATORS[documentType] || Object.freeze({ strong: [], generic: [] });
};

/** Allowlisted MIME types. Kept in sync with documents.validators.js. */
export const SCREENING_MIME_TYPES = Object.freeze([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
]);

export const MAX_SCREENING_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const OCR_TIMEOUT_MS = 15000;

export default {
  SCREENING_STATUS,
  SCREENING_REASON,
  IMAGE_QUALITY,
  SCREENING_MESSAGES,
  IMAGE_LIMITS,
  OCR_LIMITS,
  DOCUMENT_INDICATORS,
  RESIDENCY_DOCUMENT_TYPES,
  GOVERNMENT_ID_TYPE_INDICATORS,
  DOCUMENT_SCREENING_RULES,
  DEFAULT_SCREENING_RULE,
  ruleForDocumentType,
  indicatorsForDocumentType,
  getGovernmentIdProfile,
  SCREENING_MIME_TYPES,
  MAX_SCREENING_FILE_SIZE,
  OCR_TIMEOUT_MS,
};

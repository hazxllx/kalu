import { invalid, valid } from './common.js';

/**
 * @file Resident verification document upload & staff review validators (server-authoritative).
 *
 * Used by `middleware/validate.js` in the KALUSAGAP request pipeline
 * (`route -> authenticate -> authorize -> upload -> validate -> controller -> service -> Supabase Storage`)
 * to screen identity, proof-of-residency, student ID, and transfer-in health documents
 * before storage persistence, as well as staff document verification decisions.
 */

/** Permitted MIME types across general verification document uploads. */
export const ALLOWED_MIME_TYPES = Object.freeze([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
]);

// A "photo holding your ID" (identity_photo) must be a real photo, never a PDF.
// This applies to registration and resubmission alike so front-end and back-end
// agree on the same rule.
export const IMAGE_ONLY_DOCUMENT_TYPES = Object.freeze(['identity_photo']);
export const IMAGE_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/jpg']);

// Registration identity documents (ID front/back, selfie) are capped higher
// than the legacy proof-of-residency 5 MB rule.
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** Whitelisted document slot identifiers for resident registration, minor verification, and transfers. */
export const ALLOWED_DOCUMENT_TYPES = Object.freeze([
  'proof_of_residency',
  'barangay_certificate',
  'barangay_clearance',
  'government_id',
  'other',
  'government_id_front',
  'government_id_back',
  'identity_photo',
  'student_id',
  'transfer_previous_health_record',
  'transfer_proof_of_address',
]);

/** Accepted Philippine government-issued ID categories when uploading `government_id_front` / `government_id_back`. */
export const GOVERNMENT_ID_TYPES = Object.freeze([
  'philsys',
  'drivers_license',
  'passport',
  'umid',
  'prc_id',
  'postal_id',
  'other',
]);

/** Allowed lifecycle states for an uploaded verification document. */
export const VERIFICATION_STATUSES = Object.freeze([
  'pending',
  'approved',
  'rejected',
  'resubmission_required',
]);

/**
 * Validates multipart/file document upload payloads.
 *
 * Enforces:
 * - Allowed `documentType` (defaults to `'proof_of_residency'`).
 * - Mandatory `governmentIdType` (or custom `governmentIdTypeOther` when `'other'`)
 *   for `'government_id_front'` and `'government_id_back'` uploads.
 * - Valid `File` instance, non-empty size (`>= 1` byte), `<= 10 MB` cap, and allowed MIME type
 *   (restricting `'identity_photo'` holding-ID selfies strictly to JPG/PNG images).
 * - Preserves `residentId` alongside extracted file metadata (`fileName`, `mimeType`, `sizeBytes`)
 *   so downstream controllers can associate the upload with the resident record.
 *
 * @param {Object} [input] - Parsed upload payload containing `file` and metadata fields.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const validateDocumentUpload = (input = {}) => {
  const errors = {};

  const customGovernmentIdType = typeof input.governmentIdTypeOther === 'string'
    ? input.governmentIdTypeOther.trim()
    : '';

  const documentType = input.documentType || 'proof_of_residency';
  if (!ALLOWED_DOCUMENT_TYPES.includes(documentType)) {
    errors.documentType = 'Invalid document type.';
  }

  const rawGovernmentIdType = input.governmentIdType
    ? typeof input.governmentIdType === 'string' ? input.governmentIdType.trim().toLowerCase() : null
    : null;
  const governmentIdType = rawGovernmentIdType === 'other' && customGovernmentIdType
    ? customGovernmentIdType
    : rawGovernmentIdType;
  if (documentType === 'government_id_front' || documentType === 'government_id_back') {
    if (rawGovernmentIdType === 'other') {
      if (!customGovernmentIdType) {
        errors.governmentIdType = 'Select your government ID type.';
      }
    } else if (!rawGovernmentIdType || !GOVERNMENT_ID_TYPES.includes(rawGovernmentIdType)) {
      errors.governmentIdType = 'Select your government ID type.';
    }
  } else if (governmentIdType && rawGovernmentIdType !== 'other' && !GOVERNMENT_ID_TYPES.includes(governmentIdType.toLowerCase())) {
    errors.governmentIdType = 'Invalid government ID type.';
  }

  if (!input.file || !(input.file instanceof File)) {
    errors.file = 'Please upload a valid document.';
    return invalid(errors);
  }

  const file = input.file;

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    errors.file = 'Only PDF, JPG, and PNG files are allowed.';
  }

  // The identity photo (holding-ID selfie) must be an image, not a PDF.
  if (IMAGE_ONLY_DOCUMENT_TYPES.includes(documentType) && !IMAGE_MIME_TYPES.includes(file.type)) {
    errors.file = 'The photo holding your ID must be an image (JPG or PNG).';
  }

  if (file.size > MAX_FILE_SIZE) {
    errors.file = documentType === 'identity_photo'
      ? 'Identity photo must not exceed 10 MB.'
      : 'File size is not supported. Please upload a clear copy of your identification document.';
  }

  if (file.size < 1) {
    errors.file = 'Please upload a valid document.';
  }

  if (Object.keys(errors).length > 0) {
    return invalid(errors);
  }

  // `residentId` is preserved so the `validate` middleware (which REPLACES
  // req.body with this value) does not strip the field the controller needs to
  // link the upload to the signed-in resident's record. Without this the
  // controller always saw an undefined residentId and returned HTTP 400.
  const residentId = typeof input.residentId === 'string'
    ? input.residentId.trim()
    : (input.residentId ?? '');

  return valid({
    ...(residentId ? { residentId } : {}),
    documentType,
    governmentIdType: governmentIdType || null,
    ...(customGovernmentIdType ? { governmentIdTypeOther: customGovernmentIdType } : {}),
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
};

/**
 * Validates health staff review decisions on an uploaded resident document.
 * Requires a non-empty `rejectionReason` whenever `verificationStatus` is
 * `'rejected'` or `'resubmission_required'`.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value: { verificationStatus, rejectionReason } }` or `{ error }`.
 */
export const validateDocumentReview = (input = {}) => {
  const errors = {};

  const verificationStatus = input.verificationStatus;
  if (!VERIFICATION_STATUSES.includes(verificationStatus)) {
    errors.verificationStatus = 'Invalid verification status.';
  }

  if (
    (verificationStatus === 'rejected' || verificationStatus === 'resubmission_required')
    && !input.rejectionReason?.trim()
  ) {
    errors.rejectionReason = 'Please provide a reason for this decision.';
  }

  if (Object.keys(errors).length > 0) {
    return invalid(errors);
  }

  return valid({
    verificationStatus,
    rejectionReason: input.rejectionReason?.trim() || '',
  });
};

export default {
  validateDocumentUpload,
  validateDocumentReview,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  ALLOWED_DOCUMENT_TYPES,
  GOVERNMENT_ID_TYPES,
  VERIFICATION_STATUSES,
};

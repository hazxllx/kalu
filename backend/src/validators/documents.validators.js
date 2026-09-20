import { invalid, valid } from './common.js';

export const ALLOWED_MIME_TYPES = Object.freeze([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
]);

// Registration identity documents (ID front/back, selfie) are capped higher
// than the legacy proof-of-residency 5 MB rule.
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_DOCUMENT_TYPES = Object.freeze([
  'proof_of_residency',
  'barangay_certificate',
  'barangay_clearance',
  'government_id',
  'other',
  'government_id_front',
  'government_id_back',
  'identity_photo',
]);

export const GOVERNMENT_ID_TYPES = Object.freeze([
  'philsys',
  'drivers_license',
  'passport',
  'umid',
  'prc_id',
  'postal_id',
  'other',
]);

export const VERIFICATION_STATUSES = Object.freeze([
  'pending',
  'approved',
  'rejected',
  'resubmission_required',
]);

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

  if (file.size > MAX_FILE_SIZE) {
    errors.file = 'File size must not exceed 10 MB.';
  }

  if (file.size < 1) {
    errors.file = 'Please upload a valid document.';
  }

  if (Object.keys(errors).length > 0) {
    return invalid(errors);
  }

  return valid({
    documentType,
    governmentIdType: governmentIdType || null,
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
};

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

import { invalid, valid } from './common.js';

export const ALLOWED_MIME_TYPES = Object.freeze([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
]);

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export const ALLOWED_DOCUMENT_TYPES = Object.freeze([
  'proof_of_residency',
  'barangay_certificate',
  'barangay_clearance',
  'government_id',
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

  const documentType = input.documentType || 'proof_of_residency';
  if (!ALLOWED_DOCUMENT_TYPES.includes(documentType)) {
    errors.documentType = 'Invalid document type.';
  }

  if (!input.file || !(input.file instanceof File)) {
    errors.file = 'Please upload a valid proof of residency document.';
    return invalid(errors);
  }

  const file = input.file;

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    errors.file = 'Only PDF, JPG, and PNG files are allowed.';
  }

  if (file.size > MAX_FILE_SIZE) {
    errors.file = 'File size must not exceed 5 MB.';
  }

  if (file.size < 1) {
    errors.file = 'Please upload a valid proof of residency document.';
  }

  if (Object.keys(errors).length > 0) {
    return invalid(errors);
  }

  return valid({
    documentType,
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
  VERIFICATION_STATUSES,
};

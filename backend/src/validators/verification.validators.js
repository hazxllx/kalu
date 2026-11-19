import { TEXT_LIMITS, invalid, rejectionReasonError, text, valid } from './common.js';

/**
 * @file Manual resident identity & residency verification validators (server-authoritative).
 *
 * Executed by `middleware/validate.js` in the KALUSAGAP request pipeline
 * (`route -> authenticate -> authorize -> barangayScope -> validate -> controller -> service -> Supabase`).
 *
 * Reviewer identity (`verifiedBy`) and barangay/municipality scope come strictly
 * from `req.user` in the verification service. Only `reason`, `remarks`, and explicit
 * decision enums are whitelisted here so clients cannot inject `status`, `verifiedBy`,
 * or mismatched `residentId` values into the request body.
 */

/** Safe identifier pattern (`1..64` chars) matching both UUIDs and human-readable resident codes. */
const SAFE_REF = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validates `:id` route parameters for resident verification endpoints.
 *
 * @param {Object} [params] - Route params object.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const verificationIdParamValidator = (params = {}) => {
  const id = text(params.id);
  if (!id) return invalid({ id: 'A resident reference is required.' });
  if (!SAFE_REF.test(id)) return invalid({ id: 'The resident reference is not valid.' });
  return valid({ ...params, id });
};

/**
 * Validates `:ref` route parameters for legacy/reference-based verification endpoints.
 *
 * @param {Object} [params] - Route params object.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const verificationRefParamValidator = (params = {}) => {
  const ref = text(params.ref);
  if (!ref) return invalid({ ref: 'A resident reference is required.' });
  if (!SAFE_REF.test(ref)) return invalid({ ref: 'The resident reference is not valid.' });
  return valid({ ...params, ref });
};

/** Trims optional reviewer `remarks` and enforces `TEXT_LIMITS.notes` max length. */
const remarksField = (value, errors) => {
  const remarks = text(value);
  if (remarks.length > TEXT_LIMITS.notes) {
    errors.remarks = `Remarks are too long (max ${TEXT_LIMITS.notes} characters).`;
  }
  return remarks;
};

/**
 * Validates resident verification approval payloads (optional `remarks` only).
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value: { remarks } }` or `{ error }`.
 */
export const approveValidator = (input = {}) => {
  const errors = {};
  const remarks = remarksField(input?.remarks, errors);
  if (Object.keys(errors).length) return invalid(errors);
  // Verification status is set only by the authenticated reviewer decision route.
  return valid({ remarks });
};

/**
 * Shared validator for rejection payloads: requires `reason` (`>= 5` chars) and
 * additionally requires free-text `remarks` when `reason === 'Other'`.
 */
const reasonValidator = (input = {}) => {
  const errors = {};
  const reason = text(input?.reason);
  const remarks = remarksField(input?.remarks, errors);

  const reasonError = rejectionReasonError(reason, {
    requiredMessage: 'Please provide a reason for rejection.',
    minMessage: 'Please provide a more specific reason (at least 5 characters).',
  });
  if (reasonError) errors.reason = reasonError;
  if (reason === 'Other' && !remarks) errors.remarks = 'Please provide remarks when choosing "Other".';

  if (Object.keys(errors).length) return invalid(errors);
  return valid({ reason, remarks });
};

/**
 * Validates resident verification rejection payloads (`reason` + conditional `remarks`).
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value: { reason, remarks } }` or `{ error }`.
 */
export const rejectValidator = (input = {}) => reasonValidator(input);

/**
 * Validates document/profile resubmission requests (`reason >= 5` chars, plus mandatory
 * `remarks` when `reason === 'Other'`).
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value: { reason, remarks } }` or `{ error }`.
 */
export const requestResubmissionValidator = (input = {}) => {
  const errors = {};
  const reason = text(input?.reason);
  const remarks = remarksField(input?.remarks, errors);

  if (!reason) errors.reason = 'Please provide a reason for requesting resubmission.';
  else if (reason.length < 5) errors.reason = 'Please provide a more specific reason (at least 5 characters).';
  if (reason === 'Other' && !remarks) errors.remarks = 'Please provide remarks when choosing "Other".';

  if (Object.keys(errors).length) return invalid(errors);
  return valid({ reason, remarks });
};

/**
 * Validates staff review decisions (`approved` or `rejected`) for under-18 applicants
 * who requested staff-approved alternative identity verification (`staff_alternative`),
 * requiring at least 5 characters in `reason` when rejecting.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value: { decision, reason } }` or `{ error }`.
 */
export const minorAlternativeReviewValidator = (input = {}) => {
  const errors = {};
  const decision = text(input?.decision);
  const reason = text(input?.reason);
  if (!['approved', 'rejected'].includes(decision)) {
    errors.decision = 'Decision must be approved or rejected.';
  }
  if (reason.length > TEXT_LIMITS.notes) errors.reason = `Reason is too long (max ${TEXT_LIMITS.notes} characters).`;
  if (decision === 'rejected' && reason.length < 5) {
    errors.reason = 'A rejection reason of at least 5 characters is required.';
  }
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ decision, reason });
};

/**
 * Validates legacy combined decision payloads (`POST /:ref/decision`), dispatching
 * to `approveValidator` or `rejectValidator` based on `decision` (`'approved'` | `'rejected'`).
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value }` or `{ error }`.
 */
export const decisionValidator = (input = {}) => {
  const decision = text(input?.decision).toLowerCase();
  if (decision !== 'approved' && decision !== 'rejected') {
    return invalid({ decision: 'Decision must be "approved" or "rejected".' });
  }
  if (decision === 'approved') {
    const result = approveValidator(input);
    return result.error ? result : valid({ decision, ...result.value });
  }
  const result = rejectValidator(input);
  return result.error ? result : valid({ decision, ...result.value });
};

export default {
  verificationIdParamValidator,
  verificationRefParamValidator,
  approveValidator,
  rejectValidator,
  requestResubmissionValidator,
  minorAlternativeReviewValidator,
  decisionValidator,
};

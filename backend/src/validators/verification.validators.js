import { TEXT_LIMITS, invalid, rejectionReasonError, text, valid } from './common.js';

/**
 * Manual resident verification validation.
 *
 * The reviewer identity and the target scope are never accepted from the
 * client — they come from the authenticated session in the service. This module
 * only validates the request shape and the reviewer's input.
 *
 * `reason`/`remarks` are the only accepted body fields, so a client cannot slip
 * a `status`, `verifiedBy`, or `residentId` into the request.
 */

const SAFE_REF = /^[A-Za-z0-9_-]{1,64}$/;

export const verificationIdParamValidator = (params = {}) => {
  const id = text(params.id);
  if (!id) return invalid({ id: 'A resident reference is required.' });
  if (!SAFE_REF.test(id)) return invalid({ id: 'The resident reference is not valid.' });
  return valid({ ...params, id });
};

export const verificationRefParamValidator = (params = {}) => {
  const ref = text(params.ref);
  if (!ref) return invalid({ ref: 'A resident reference is required.' });
  if (!SAFE_REF.test(ref)) return invalid({ ref: 'The resident reference is not valid.' });
  return valid({ ...params, ref });
};

const remarksField = (value, errors) => {
  const remarks = text(value);
  if (remarks.length > TEXT_LIMITS.notes) {
    errors.remarks = `Remarks are too long (max ${TEXT_LIMITS.notes} characters).`;
  }
  return remarks;
};

export const approveValidator = (input = {}) => {
  const errors = {};
  const remarks = remarksField(input?.remarks, errors);
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ remarks });
};

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

export const rejectValidator = (input = {}) => reasonValidator(input);

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

/** Legacy `POST /:ref/decision` body: { decision: 'approved'|'rejected', ... }. */
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
  decisionValidator,
};

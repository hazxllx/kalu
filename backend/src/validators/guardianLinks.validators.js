import { TEXT_LIMITS, isStrictMobile, text, valid, invalid } from './common.js';
import { GUARDIAN_RELATIONSHIP_TYPES } from '../config/guardianPolicy.js';
import { isEmail, normalizeEmail } from './common.js';

/**
 * Guardian-link request validation (server-authoritative).
 *
 * Only whitelisted fields are accepted and normalised (no mass assignment).
 * The service additionally enforces: minor-only rule, scope/coverage,
 * self-reference, duplicate-link and name-consistency checks.
 */

const str = (value, max, label, errors, field, { optional = false } = {}) => {
  const out = text(value);
  if (!out) {
    if (!optional) errors[field] = `${label} is required.`;
    return '';
  }
  if (out.length > max) errors[field] = `${label} is too long (max ${max} characters).`;
  return out;
};

export const createGuardianLinkValidator = (input = {}) => {
  const body = input && typeof input.guardianLink === 'object' && input.guardianLink !== null ? input.guardianLink : input || {};
  const errors = {};

  const minorResidentId = str(body.minorResidentId, 40, 'Minor resident', errors, 'minorResidentId');
  const relationshipType = text(body.relationshipType);
  if (!GUARDIAN_RELATIONSHIP_TYPES.includes(relationshipType)) {
    errors.relationshipType = 'Select the relationship to the minor.';
  }
  const guardianLastName = str(body.guardianLastName, TEXT_LIMITS.short, 'Guardian last name', errors, 'guardianLastName');
  const guardianFirstName = str(body.guardianFirstName, TEXT_LIMITS.short, 'Guardian first name', errors, 'guardianFirstName');
  const guardianMiddleName = str(body.guardianMiddleName, TEXT_LIMITS.short, 'Guardian middle name', errors, 'guardianMiddleName', { optional: true });
  const guardianResidentId = str(body.guardianResidentId, 40, 'Guardian resident', errors, 'guardianResidentId', { optional: true });
  const guardianCellphoneNo = str(body.guardianCellphoneNo, 20, 'Guardian mobile number', errors, 'guardianCellphoneNo', { optional: true });
  if (guardianCellphoneNo && !isStrictMobile(guardianCellphoneNo)) {
    errors.guardianCellphoneNo = 'Guardian mobile number must be exactly 11 digits with no spaces or symbols (e.g. 09171234567).';
  }
  const guardianIdentityNo = str(body.guardianIdentityNo, 60, 'Guardian identity number', errors, 'guardianIdentityNo', { optional: true });
  const consentNote = str(body.consentNote, 500, 'Consent note', errors, 'consentNote', { optional: true });

  if (Object.keys(errors).length) return invalid(errors);
  return valid({
    guardianLink: {
      minorResidentId,
      relationshipType,
      guardianLastName,
      guardianFirstName,
      guardianMiddleName,
      ...(guardianResidentId ? { guardianResidentId } : {}),
      ...(guardianCellphoneNo ? { guardianCellphoneNo } : {}),
      ...(guardianIdentityNo ? { guardianIdentityNo } : {}),
      consentRecorded: Boolean(body.consentRecorded),
      consentNote,
    },
  });
};

export const reviewGuardianLinkValidator = (input = {}) => {
  const body = input && typeof input.review === 'object' && input.review !== null ? input.review : input || {};
  const errors = {};
  const decision = text(body.decision);
  if (!['verified', 'rejected'].includes(decision)) {
    errors.decision = 'Decision must be "verified" or "rejected".';
  }
  const note = str(body.note, 500, 'Note', errors, 'note', { optional: true });
  if (decision === 'rejected' && note.length < 5) {
    errors.note = 'A rejection reason of at least 5 characters is required.';
  }
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ review: { decision, note } });
};

export const correctGuardianLinkValidator = (input = {}) => {
  const body = input && typeof input.correction === 'object' && input.correction !== null ? input.correction : input || {};
  const errors = {};
  const out = {};
  if (body.relationshipType !== undefined) {
    const value = text(body.relationshipType);
    if (!GUARDIAN_RELATIONSHIP_TYPES.includes(value)) errors.relationshipType = 'Invalid relationship type.';
    out.relationshipType = value;
  }
  if (body.guardianMiddleName !== undefined) {
    const value = text(body.guardianMiddleName);
    if (value.length > TEXT_LIMITS.short) errors.guardianMiddleName = 'Guardian middle name is too long.';
    out.guardianMiddleName = value;
  }
  if (body.guardianCellphoneNo !== undefined) {
    const value = text(body.guardianCellphoneNo);
    if (value && !isStrictMobile(value)) errors.guardianCellphoneNo = 'Guardian mobile number must be exactly 11 digits with no spaces or symbols (e.g. 09171234567).';
    out.guardianCellphoneNo = value;
  }
  if (body.guardianIdentityNo !== undefined) {
    const value = text(body.guardianIdentityNo);
    if (value.length > 60) errors.guardianIdentityNo = 'Guardian identity number is too long.';
    out.guardianIdentityNo = value;
  }
  if (Object.keys(errors).length) return invalid(errors);
  if (Object.keys(out).length === 0) return invalid({ _root: 'No changes were provided.' });
  return valid({ correction: out });
};

export const ownGuardianRequestValidator = (input = {}) => {
  const body = input?.guardianRequest || input || {};
  const errors = {};
  const email = normalizeEmail(body.email);
  const relationshipType = text(body.relationshipType);
  if (!email || !isEmail(email)) errors.email = 'Enter a valid registered parent or guardian email.';
  if (!GUARDIAN_RELATIONSHIP_TYPES.includes(relationshipType)) {
    errors.relationshipType = 'Select the relationship to the minor.';
  }
  if (Object.keys(errors).length) return invalid(errors);
  return valid({ guardianRequest: { email, relationshipType } });
};

export const guardianResponseValidator = (input = {}) => {
  const decision = text(input?.decision);
  if (!['accepted', 'rejected'].includes(decision)) {
    return invalid({ decision: 'Choose whether to accept or reject this request.' });
  }
  return valid({ decision });
};

export default {
  createGuardianLinkValidator,
  reviewGuardianLinkValidator,
  correctGuardianLinkValidator,
  ownGuardianRequestValidator,
  guardianResponseValidator,
};

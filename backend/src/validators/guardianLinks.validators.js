import { TEXT_LIMITS, isStrictMobile, text, valid, invalid } from './common.js';
import { GUARDIAN_RELATIONSHIP_TYPES } from '../config/guardianPolicy.js';
import { isEmail, normalizeEmail } from './common.js';

/**
 * @file Minor-to-guardian relationship link validators (server-authoritative).
 *
 * Invoked by `middleware/validate.js` in the KALUSAGAP request pipeline
 * (`route -> authenticate -> authorize -> validate -> controller -> service -> Supabase`)
 * across both staff-managed guardian link records (creation, verification review,
 * non-identity metadata correction) and minor self-service email link requests/responses.
 *
 * Only whitelisted fields are accepted and normalized (preventing mass assignment).
 * Downstream guardian-link services enforce the under-18 minor rule, barangay/RHU
 * coverage scope, anti-self-reference, duplicate-link prevention, and profile name consistency.
 */

/** Trims a string field, recording required/max-length validation errors into `errors[field]`. */
const str = (value, max, label, errors, field, { optional = false } = {}) => {
  const out = text(value);
  if (!out) {
    if (!optional) errors[field] = `${label} is required.`;
    return '';
  }
  if (out.length > max) errors[field] = `${label} is too long (max ${max} characters).`;
  return out;
};

/**
 * Validates staff-initiated guardian link creation payloads (accepts `{ guardianLink }` or flat body).
 * Requires `minorResidentId`, a valid `GUARDIAN_RELATIONSHIP_TYPES` value, and guardian first/last
 * names; optionally validates strict 11-digit PH mobile (`09XXXXXXXXX`), existing `guardianResidentId`,
 * `guardianIdentityNo`, and parental `consentRecorded`/`consentNote` fields.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value: { guardianLink } }` or `{ error }`.
 */
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

/**
 * Validates staff verification decisions (`verified` or `rejected`) on a pending guardian link.
 * Enforces a rejection `note` of at least 5 characters when `decision === 'rejected'`.
 *
 * @param {Object} [input] - Raw request body (`{ review }` or flat).
 * @returns {Object} Validation result `{ value: { review } }` or `{ error }`.
 */
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

/**
 * Validates partial corrections to an existing guardian link (`{ correction }` or flat).
 * Permits updating `relationshipType`, `guardianMiddleName`, `guardianCellphoneNo`, and
 * `guardianIdentityNo` while rejecting empty patches (`errors._root`) and preventing
 * changes to core linked resident identities.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value: { correction } }` or `{ error }`.
 */
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

/**
 * Validates a minor resident's self-service guardian link request (`{ guardianRequest }` or flat),
 * normalizing the target parent/guardian `email` and checking `relationshipType`.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value: { guardianRequest } }` or `{ error }`.
 */
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

/**
 * Validates a registered adult resident's response (`accepted` or `rejected`)
 * to a minor's guardian link invitation.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value: { decision } }` or `{ error }`.
 */
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

import {
  CIVIL_STATUSES,
  NAME_SUFFIXES,
  SEX_OPTIONS,
  TEXT_LIMITS,
  ageFromDateOnly,
  hasControlChars,
  isEmail,
  isFutureDateOnly,
  isValidPersonName,
  isStrictMobile,
  normalizeEmail,
  toZone,
  invalid,
  text,
  valid,
} from './common.js';
import { isApprovedBarangayName } from '../config/barangays.js';

/**
 * @file Resident self-registration & profile-claim validators (server-authoritative).
 *
 * Executed by `middleware/validate.js` in the KALUSAGAP request pipeline
 * (`route -> authenticate -> validate -> controller -> service -> repository/Supabase`).
 *
 * Only whitelisted demographic, address, minor-verification, and profile-claim fields
 * are accepted and normalized so unexpected body keys can never reach the repository
 * (preventing mass assignment of verification status or scope). Downstream registration
 * services bind the Supabase Auth user ID from `req.user` and enforce duplicate-identity
 * and existing-resident claim verification (`residentId` + `birthDate`).
 */

/** Trims a string input, recording required/max-length errors under `errors[field]`. */
const str = (value, max, field, label, errors, { optional = false } = {}) => {
  const out = text(value);
  if (!out) {
    if (!optional) errors[field] = `${label} is required.`;
    return '';
  }
  if (out.length > max) errors[field] = `${label} is too long (max ${max} characters).`;
  return out;
};

// Date-only birthdates use the application's Philippine calendar, independent
// of the API host's timezone or UTC day boundary.
export const registrationDateReference = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const datePart = (type) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(datePart('year'), datePart('month') - 1, datePart('day')));
};

// Accept common PH formatting, but persist one canonical 09XXXXXXXXX value.
export const normalizeRegistrationMobile = (value) => {
  const normalized = text(value);
  if (!isStrictMobile(normalized)) return null;
  return normalized;
};

/**
 * Validates resident onboarding payloads (`{ resident }` or flat body).
 *
 * Key rules enforced:
 * - Unicode person-name validation (rejecting control characters) + controlled `NAME_SUFFIXES`.
 * - Strict calendar `birthDate` (`0 <= age <= 120`, non-future in the Philippine timezone).
 * - Age-gated minor (< 18) onboarding choices (`minorVerificationMethod`: `'student_id'` |
 *   `'staff_alternative'`; `guardianLinkChoice`: `'skip'` | `'request'`), disallowed for adults.
 * - PH mobile normalization to 11-digit `09XXXXXXXXX`, approved barangay name, controlled `zone` (`1..8`),
 *   `permanentAddress` defaulting to `currentAddress`, and optional BHW-profile claim `residentId`.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value: { resident } }` or `{ error }`.
 */
export const registerResidentValidator = (input = {}) => {
  const body = input && typeof input.resident === 'object' && input.resident !== null ? input.resident : input || {};
  const errors = {};
  const dateReference = registrationDateReference();

  const firstName = str(body.firstName, TEXT_LIMITS.short, 'firstName', 'First name', errors);
  if (firstName && (hasControlChars(firstName) || !isValidPersonName(firstName))) {
    errors.firstName = 'First name can contain letters, spaces, hyphens, apostrophes, and periods only.';
  }
  const middleName = str(body.middleName, TEXT_LIMITS.short, 'middleName', 'Middle name', errors, { optional: true });
  if (middleName && (hasControlChars(middleName) || !isValidPersonName(middleName))) {
    errors.middleName = 'Middle name can contain letters, spaces, hyphens, apostrophes, and periods only.';
  }
  const lastName = str(body.lastName, TEXT_LIMITS.short, 'lastName', 'Last name', errors);
  if (lastName && (hasControlChars(lastName) || !isValidPersonName(lastName))) {
    errors.lastName = 'Last name can contain letters, spaces, hyphens, apostrophes, and periods only.';
  }
  const suffix = text(body.suffix);
  if (suffix && !NAME_SUFFIXES.includes(suffix)) {
    errors.suffix = 'Suffix must be one of Jr., Sr., II, III, IV, or V.';
  }

  const birthDate = text(body.birthDate);
  if (!birthDate) errors.birthDate = 'Date of birth is required.';
  else if (ageFromDateOnly(birthDate, dateReference) === null) errors.birthDate = 'Date of birth is invalid.';
  else if (isFutureDateOnly(birthDate, dateReference)) errors.birthDate = 'Date of birth cannot be in the future.';
  else {
    const age = ageFromDateOnly(birthDate, dateReference);
    if (age === null || age < 0 || age > 120) errors.birthDate = 'Date of birth is not a valid age.';
  }
  // Applicants under 18 must choose a minor identity path and guardian-linking option; adults may not supply either.
  const applicantAge = ageFromDateOnly(birthDate, dateReference);
  const isMinor = applicantAge !== null && applicantAge < 18;
  const minorVerificationMethod = text(body.minorVerificationMethod);
  const guardianLinkChoice = text(body.guardianLinkChoice);
  if (isMinor && !['student_id', 'staff_alternative'].includes(minorVerificationMethod)) {
    errors.minorVerificationMethod = 'Select a student ID or request staff-approved alternative verification.';
  } else if (!isMinor && minorVerificationMethod) {
    errors.minorVerificationMethod = 'Minor verification options are only available to applicants under 18.';
  }
  if (isMinor && !['skip', 'request'].includes(guardianLinkChoice)) {
    errors.guardianLinkChoice = 'Choose whether to skip or request parent/guardian linking.';
  } else if (!isMinor && guardianLinkChoice) {
    errors.guardianLinkChoice = 'Parent/guardian linking is only available to applicants under 18.';
  }

  const sex = text(body.sex);
  if (!sex) errors.sex = 'Sex is required.';
  else if (!SEX_OPTIONS.includes(sex)) errors.sex = 'Sex must be "Male" or "Female".';

  const civilStatus = text(body.civilStatus);
  if (!civilStatus) errors.civilStatus = 'Civil status is required.';
  else if (!CIVIL_STATUSES.includes(civilStatus)) errors.civilStatus = 'Select a valid civil status.';

  const cellphoneInput = str(body.cellphoneNo, 30, 'cellphoneNo', 'Mobile number', errors);
  const cellphoneNo = normalizeRegistrationMobile(cellphoneInput);
  if (cellphoneInput && !cellphoneNo) {
    errors.cellphoneNo = 'Enter a valid PH mobile number (09XXXXXXXXX).';
  }

  const barangay = str(body.barangay, TEXT_LIMITS.medium, 'barangay', 'Barangay', errors);
  if (barangay && !isApprovedBarangayName(barangay)) {
    errors.barangay = 'Select one of the approved barangays.';
  }

  // Zone is a controlled value 1..8 (was "Sitio / Purok"). Reject anything else
  // server-side; the frontend dropdown is only a convenience.
  const zone = toZone(body.zone);
  if (body.zone === undefined || text(body.zone) === '') {
    errors.zone = 'Zone is required.';
  } else if (zone === null) {
    errors.zone = 'Zone must be a number from 1 to 8.';
  }

  const currentAddress = str(body.currentAddress, TEXT_LIMITS.address, 'currentAddress', 'Address', errors);
  const permanentAddress = str(body.permanentAddress, TEXT_LIMITS.address, 'permanentAddress', 'Permanent address', errors, { optional: true });

  const birthPlace = str(body.birthPlace, TEXT_LIMITS.medium, 'birthPlace', 'Birth place', errors, { optional: true });
  const religion = str(body.religion, TEXT_LIMITS.medium, 'religion', 'Religion', errors, { optional: true });
  const employmentStatus = str(body.employmentStatus, TEXT_LIMITS.medium, 'employmentStatus', 'Employment status', errors, { optional: true });
  const philhealthNo = str(body.philhealthNo, 40, 'philhealthNo', 'PhilHealth number', errors, { optional: true });
  const identityNo = str(body.identityNo, 60, 'identityNo', 'Identity number', errors, { optional: true });

  // Optional claim reference: the Resident ID of an existing profile created by
  // a BHW / Health Personnel. When present, the service links this account to
  // that existing profile (verified by Resident ID + date of birth) instead of
  // creating a duplicate. Whitelisted here so it survives validation.
  const residentId = str(body.residentId, 40, 'residentId', 'Resident ID', errors, { optional: true });

  const sms = body.smsUpdates;
  const resident = {
    firstName,
    middleName,
    lastName,
    suffix,
    birthDate,
    birthPlace,
    sex,
    civilStatus,
    religion,
    employmentStatus,
    is4PsMember: Boolean(body.is4PsMember),
    philhealthNo,
    identityNo,
    currentAddress,
    permanentAddress: permanentAddress || currentAddress,
    cellphoneNo,
    barangay,
    ...(zone === null ? {} : { zone }),
    ...(residentId ? { residentId } : {}),
    ...(isMinor ? { minorVerificationMethod } : {}),
    ...(isMinor ? { guardianLinkChoice } : {}),
    ...(sms === undefined ? {} : { smsUpdates: Boolean(sms) }),
  };

  if (Object.keys(errors).length) return invalid(errors);
  return valid({ resident });
};

/**
 * Validates an email field and returns a human-readable error message (`''` when valid),
 * shared across registration and auth flows so email formatting rules do not drift.
 *
 * @param {*} value - Raw email input.
 * @param {string} [field='email'] - Field identifier.
 * @param {string} [label='Email'] - Display label used in the required error message.
 * @returns {string} Validation error string, or `''` when valid.
 */
export const emailValidator = (value, field = 'email', label = 'Email') => {
  const out = normalizeEmail(value);
  if (!out) return `${label} is required.`;
  if (!isEmail(out)) return 'Please enter a valid email address.';
  return '';
};

export default { registerResidentValidator, emailValidator };

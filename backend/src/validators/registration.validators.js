import {
  CIVIL_STATUSES,
  NAME_SUFFIXES,
  SEX_OPTIONS,
  TEXT_LIMITS,
  ageFromDateOnly,
  isEmail,
  isFutureDateOnly,
  isStrictMobile,
  normalizeEmail,
  toZone,
  invalid,
  text,
  valid,
} from './common.js';

/**
 * Resident self-registration validation (server-authoritative).
 *
 * Only whitelisted fields are accepted and normalised, so an unexpected key in
 * the request body can never reach the repository (no mass assignment). The
 * service still enforces ownership (the auth user id comes from the session)
 * and duplicate-identity rules.
 */

const str = (value, max, field, label, errors, { optional = false } = {}) => {
  const out = text(value);
  if (!out) {
    if (!optional) errors[field] = `${label} is required.`;
    return '';
  }
  if (out.length > max) errors[field] = `${label} is too long (max ${max} characters).`;
  return out;
};

export const registerResidentValidator = (input = {}) => {
  const body = input && typeof input.resident === 'object' && input.resident !== null ? input.resident : input || {};
  const errors = {};

  const firstName = str(body.firstName, TEXT_LIMITS.short, 'firstName', 'First name', errors);
  const middleName = str(body.middleName, TEXT_LIMITS.short, 'middleName', 'Middle name', errors, { optional: true });
  const lastName = str(body.lastName, TEXT_LIMITS.short, 'lastName', 'Last name', errors);
  const suffix = text(body.suffix);
  if (suffix && !NAME_SUFFIXES.includes(suffix)) {
    errors.suffix = 'Suffix must be one of Jr., Sr., II, III, IV, or V.';
  }

  const birthDate = text(body.birthDate);
  if (!birthDate) errors.birthDate = 'Date of birth is required.';
  else if (ageFromDateOnly(birthDate) === null) errors.birthDate = 'Date of birth is invalid.';
  else if (isFutureDateOnly(birthDate)) errors.birthDate = 'Date of birth cannot be in the future.';
  else {
    const age = ageFromDateOnly(birthDate);
    if (age === null || age < 0 || age > 120) errors.birthDate = 'Date of birth is not a valid age.';
  }
  const isMinor = ageFromDateOnly(birthDate) !== null && ageFromDateOnly(birthDate) < 18;
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

  const cellphoneNo = str(body.cellphoneNo, 20, 'cellphoneNo', 'Mobile number', errors);
  if (cellphoneNo && !isStrictMobile(cellphoneNo)) {
    errors.cellphoneNo = 'Mobile number must be exactly 11 digits with no spaces or symbols (e.g. 09381829120).';
  }

  const barangay = str(body.barangay, TEXT_LIMITS.medium, 'barangay', 'Barangay', errors);

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
 * Login-shaped helper reused by any endpoint that accepts an email + password
 * (kept here so registration and auth rules cannot drift).
 */
export const emailValidator = (value, field = 'email', label = 'Email') => {
  const out = normalizeEmail(value);
  if (!out) return `${label} is required.`;
  if (!isEmail(out)) return 'Please enter a valid email address.';
  return '';
};

export default { registerResidentValidator, emailValidator };

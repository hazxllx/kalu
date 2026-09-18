import {
  CIVIL_STATUSES,
  NAME_SUFFIXES,
  SEX_OPTIONS,
  TEXT_LIMITS,
  ageFromDate,
  isEmail,
  isFutureDate,
  isPhonePH,
  invalid,
  parseDate,
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
  else if (!parseDate(birthDate)) errors.birthDate = 'Date of birth is invalid.';
  else if (isFutureDate(birthDate)) errors.birthDate = 'Date of birth cannot be in the future.';
  else {
    const age = ageFromDate(birthDate);
    if (age === null || age < 0 || age > 120) errors.birthDate = 'Date of birth is not a valid age.';
  }

  const sex = text(body.sex);
  if (!sex) errors.sex = 'Sex is required.';
  else if (!SEX_OPTIONS.includes(sex)) errors.sex = 'Sex must be "Male" or "Female".';

  const civilStatus = text(body.civilStatus);
  if (!civilStatus) errors.civilStatus = 'Civil status is required.';
  else if (!CIVIL_STATUSES.includes(civilStatus)) errors.civilStatus = 'Select a valid civil status.';

  const cellphoneNo = str(body.cellphoneNo, 20, 'cellphoneNo', 'Contact number', errors);
  if (cellphoneNo && !isPhonePH(cellphoneNo)) {
    errors.cellphoneNo = 'Contact number must be a valid PH mobile number (e.g. 0917 123 4567).';
  }

  const barangay = str(body.barangay, TEXT_LIMITS.medium, 'barangay', 'Barangay', errors);
  const currentAddress = str(body.currentAddress, TEXT_LIMITS.address, 'currentAddress', 'Address', errors);
  const permanentAddress = str(body.permanentAddress, TEXT_LIMITS.address, 'permanentAddress', 'Permanent address', errors, { optional: true });

  const birthPlace = str(body.birthPlace, TEXT_LIMITS.medium, 'birthPlace', 'Birth place', errors, { optional: true });
  const religion = str(body.religion, TEXT_LIMITS.medium, 'religion', 'Religion', errors, { optional: true });
  const employmentStatus = str(body.employmentStatus, TEXT_LIMITS.medium, 'employmentStatus', 'Employment status', errors, { optional: true });
  const philhealthNo = str(body.philhealthNo, 40, 'philhealthNo', 'PhilHealth number', errors, { optional: true });
  const identityNo = str(body.identityNo, 60, 'identityNo', 'Identity number', errors, { optional: true });

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
  const out = text(value);
  if (!out) return `${label} is required.`;
  if (!isEmail(out)) return 'Please enter a valid email address.';
  return '';
};

export default { registerResidentValidator, emailValidator };

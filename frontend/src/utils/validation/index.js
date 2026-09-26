/**
 * Shared validation helpers for KALUSAGAP forms.
 *
 * These mirror the backend rules in `backend/src/validators/common.js` so the
 * messages a user sees while typing match what the server enforces. The backend
 * is still authoritative — the frontend only avoids an unnecessary round trip.
 *
 * Keep this module pure and free of React so it can be unit-tested and reused
 * by any form.
 */

export const TEXT_LIMITS = Object.freeze({
  short: 80,
  medium: 120,
  long: 200,
  address: 300,
  notes: 2000,
});

export const NAME_SUFFIXES = Object.freeze(['Jr.', 'Sr.', 'II', 'III', 'IV', 'V']);
export const SEX_OPTIONS = Object.freeze(['Male', 'Female']);
export const CIVIL_STATUSES = Object.freeze(['Single', 'Married', 'Widowed', 'Separated']);
export const MIN_REJECTION_REASON = 5;

const PH_MOBILE = /^(?:\+63|0)9\d{9}$/;
const PH_MOBILE_STRICT = /^09\d{9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Controlled Zone values for a resident/household address. */
export const ZONE_VALUES = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);

export const asString = (value) => (value === null || value === undefined ? '' : String(value));
export const text = (value) => asString(value).trim();
export const isBlank = (value) => text(value) === '';

export const hasMaxLength = (value, max) => asString(value).length <= max;
export const normalizePhone = (value) => asString(value).replace(/[\s()\-.]/g, '');
export const isPhonePH = (value) => PH_MOBILE.test(normalizePhone(value));
/**
 * Strict registration mobile: EXACTLY 11 digits, starting 09, no separators or
 * letters. Mirrors backend `isStrictMobile`. Kept separate from `isPhonePH` so
 * other forms (e.g. household member contact) keep their tolerant rule.
 */
export const isStrictMobile = (value) => PH_MOBILE_STRICT.test(asString(value));
export const isEmail = (value) => EMAIL.test(text(value));

/** Keep only digits (used to enforce numeric-only mobile input). */
export const digitsOnly = (value) => asString(value).replace(/\D/g, '');

export const parseDate = (value) => {
  const raw = text(value);
  if (!raw) return null;
  const d = raw.length === 10 ? new Date(`${raw}T00:00:00`) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const isFutureDate = (value, now = new Date()) => {
  const d = parseDate(value);
  if (!d) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d.getTime() > today.getTime();
};

export const ageFromDate = (value, now = new Date()) => {
  const d = parseDate(value);
  if (!d) return null;
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
};

export const inEnum = (value, options) => options.includes(asString(value));
export const isFiniteNumber = (value) =>
  value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));

/** Required field. */
export const required = (value, label) => (isBlank(value) ? `${label} is required.` : '');

/** Email format (empty allowed unless `isRequired`). */
export const email = (value, { label = 'Email', isRequired = true } = {}) => {
  if (isBlank(value)) return isRequired ? `${label} is required.` : '';
  if (!isEmail(value)) return 'Please enter a valid email address.';
  return '';
};

/** PH mobile number (empty allowed unless `isRequired`). */
export const phone = (value, { label = 'Contact number', isRequired = true } = {}) => {
  if (isBlank(value)) return isRequired ? `${label} is required.` : '';
  if (!isPhonePH(value)) return 'Contact number must be a valid PH mobile number (e.g. 0917 123 4567).';
  return '';
};

/**
 * Strict registration mobile: exactly 11 numeric digits (e.g. 09381829120).
 * No spaces, dashes, letters or +63 prefix.
 */
export const strictMobile = (value, { label = 'Mobile number', isRequired = true } = {}) => {
  if (isBlank(value)) return isRequired ? `${label} is required.` : '';
  if (!isStrictMobile(value)) {
    return 'Mobile number must be exactly 11 digits with no spaces or symbols (e.g. 09381829120).';
  }
  return '';
};

/** Controlled Zone (1..8). */
export const zone = (value, { label = 'Zone', isRequired = true } = {}) => {
  if (isBlank(value)) return isRequired ? `${label} is required.` : '';
  const n = Number(String(value).replace(/^zone\s*/i, ''));
  if (!Number.isInteger(n) || !ZONE_VALUES.includes(n)) return 'Select a zone from 1 to 8.';
  return '';
};

/** Date of birth: required, not in the future, plausible age (empty allowed unless required). */
export const dateOfBirth = (value, { isRequired = true, maxAge = 120, label = 'Date of birth' } = {}) => {
  if (isBlank(value)) return isRequired ? `${label} is required.` : '';
  if (!parseDate(value)) return `${label} is invalid.`;
  if (isFutureDate(value)) return 'Date of birth cannot be in the future.';
  const age = ageFromDate(value);
  if (age === null || age < 0 || age > maxAge) return `${label} is not a valid age.`;
  return '';
};

/** Enum membership. */
export const enumValue = (value, options, { label = 'Value', isRequired = true } = {}) => {
  if (isBlank(value)) return isRequired ? `${label} is required.` : '';
  if (!inEnum(value, options)) return `Select a valid ${label.toLowerCase()}.`;
  return '';
};

/** Non-negative / bounded number. */
export const numeric = (value, { label = 'Value', min = 0, max = null, isRequired = false, integer = false } = {}) => {
  if (value === '' || value === null || value === undefined) return isRequired ? `${label} is required.` : '';
  if (!isFiniteNumber(value)) return `${label} must be a number.`;
  if (integer && !Number.isInteger(Number(value))) return `${label} must be a whole number.`;
  if (Number(value) < min) return min === 0 ? `${label} cannot be negative.` : `${label} must be at least ${min}.`;
  if (max !== null && Number(value) > max) return `${label} must be at most ${max}.`;
  return '';
};

export const maxLength = (value, max, label = 'Value') =>
  !hasMaxLength(value, max) ? `${label} is too long (max ${max} characters).` : '';

/** Rejection / resubmission reason. */
export const rejectionReason = (value, { label = 'reason', min = MIN_REJECTION_REASON } = {}) => {
  const v = text(value);
  if (!v) return `Please provide a reason for rejection.`;
  if (v.length < min) return 'Please provide a more specific reason (at least 5 characters).';
  return '';
};

/**
 * Run a rule map against a values object and return a field -> message map.
 * Rules receive `(value, values)` and return a message or ''.
 *
 *   const errors = validateFields(form, {
 *     firstName: (v) => required(v, 'First name'),
 *     email: (v) => email(v),
 *   });
 */
export const validateFields = (values = {}, rules = {}) => {
  const errors = {};
  for (const [field, rule] of Object.entries(rules)) {
    const message = rule(values[field], values);
    if (message) errors[field] = message;
  }
  return errors;
};

/** First field with an error, for focusing/scroll behaviour. */
export const firstErrorField = (errors = {}) => Object.keys(errors)[0] || null;

/** True when the errors object has any entries. */
export const hasErrors = (errors = {}) => Object.keys(errors).length > 0;

export default {
  TEXT_LIMITS,
  NAME_SUFFIXES,
  SEX_OPTIONS,
  CIVIL_STATUSES,
  MIN_REJECTION_REASON,
  isBlank,
  isEmail,
  isPhonePH,
  isStrictMobile,
  digitsOnly,
  normalizePhone,
  ZONE_VALUES,
  parseDate,
  isFutureDate,
  ageFromDate,
  inEnum,
  isFiniteNumber,
  required,
  email,
  phone,
  strictMobile,
  zone,
  dateOfBirth,
  enumValue,
  numeric,
  maxLength,
  rejectionReason,
  validateFields,
  firstErrorField,
  hasErrors,
};

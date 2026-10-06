/**
 * Shared validation primitives (server-authoritative).
 *
 * These are the single source of truth for input rules on the backend. The
 * matching frontend helpers live in `frontend/src/utils/validation`, but the
 * frontend is only a convenience: every request is re-validated here before it
 * reaches a service, and services still enforce authorization and ownership.
 *
 * Convention with `middleware/validate.js`:
 *   validator(input, req) -> { value }            // accepted, replaces req[part]
 *                         -> { error: { field } } // rejected with 400 + details
 */

export const TEXT_LIMITS = Object.freeze({
  short: 80,
  medium: 120,
  long: 200,
  address: 300,
  notes: 2000,
});

export const NAME_SUFFIXES = Object.freeze(['', 'Jr.', 'Sr.', 'II', 'III', 'IV', 'V']);
export const SEX_OPTIONS = Object.freeze(['Male', 'Female']);
export const CIVIL_STATUSES = Object.freeze(['Single', 'Married', 'Widowed', 'Separated']);
export const MIN_REJECTION_REASON = 5;

/** PH mobile number: 09XXXXXXXXX or +639XXXXXXXXX (spaces/dashes tolerated). */
const PH_MOBILE = /^(?:\+63|0)9\d{9}$/;
/**
 * STRICT registration mobile rule: exactly 11 numeric digits, no separators,
 * no country-code prefix, no letters. Must start 09 to be a valid PH mobile.
 * This is intentionally stricter than PH_MOBILE (which tolerates +63 and
 * spaces/dashes) because the resident registration form must store a clean
 * 11-digit string with its leading zero preserved (e.g. 09381829120).
 */
const PH_MOBILE_STRICT = /^09\d{9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Controlled Zone values for a resident/household address. */
export const ZONE_VALUES = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);

export const asString = (value) => (value === null || value === undefined ? '' : String(value));
export const text = (value) => asString(value).trim();
export const isBlank = (value) => text(value) === '';

export const hasMaxLength = (value, max) => asString(value).length <= max;
export const hasMinLength = (value, min) => text(value).length >= min;

export const normalizePhone = (value) => asString(value).replace(/[\s()\-.]/g, '');
export const normalizeEmail = (value) => text(value).toLowerCase();
export const isPhonePH = (value) => PH_MOBILE.test(normalizePhone(value));
/**
 * Strict mobile check for registration: the raw value must be EXACTLY 11
 * numeric digits starting 09 — no spaces, dashes, letters or +63 prefix. The
 * value is NOT normalised first: separators or letters cause rejection.
 */
export const isStrictMobile = (value) => PH_MOBILE_STRICT.test(asString(value));
export const isEmail = (value) => EMAIL.test(normalizeEmail(value));
export const isUuid = (value) => UUID.test(text(value));

/** Coerce a Zone input to an integer 1..8, or null when out of range/blank. */
export const toZone = (value) => {
  const raw = text(value).replace(/^zone\s*/i, '');
  if (raw === '') return null;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return ZONE_VALUES.includes(n) ? n : null;
};
export const isZone = (value) => toZone(value) !== null;

/** Parse "YYYY-MM-DD" (or ISO) into a date at local midnight, or null. */
export const parseDate = (value) => {
  const raw = text(value);
  if (!raw) return null;
  const d = raw.length === 10 ? new Date(`${raw}T00:00:00`) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Parse a date-only value as a UTC calendar date, rejecting rollover dates. */
export const parseDateOnly = (value) => {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return date;
};

/** Age in whole calendar years using UTC dates on both client and server. */
export const ageFromDateOnly = (value, now = new Date()) => {
  const date = parseDateOnly(value);
  if (!date) return null;
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - date.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < date.getUTCDate())) age -= 1;
  return age;
};

export const isFutureDateOnly = (value, now = new Date()) => {
  const date = parseDateOnly(value);
  if (!date) return false;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return date.getTime() > today;
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
export const isFiniteNumber = (value) => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
export const inRange = (value, min, max) => isFiniteNumber(value) && Number(value) >= min && Number(value) <= max;

/**
 * Rejection / resubmission reason rule shared by the API and the UI:
 * required, whitespace-only rejected, minimum length.
 */
export const rejectionReasonError = (reason, { min = MIN_REJECTION_REASON, requiredMessage, minMessage } = {}) => {
  const value = text(reason);
  if (!value) return requiredMessage || 'Please provide a reason.';
  if (value.length < min) return minMessage || `Reason must be at least ${min} characters.`;
  return '';
};

/** Adds a field error only when the message is non-empty. */
export const addError = (errors, field, message) => {
  if (message) errors[field] = message;
  return errors;
};

export const hasErrors = (errors) => Object.keys(errors).length > 0;

/** Public, non-sensitive result of a validator. */
export const invalid = (errors) => ({ error: errors });
export const valid = (value) => ({ value });

export default {
  TEXT_LIMITS,
  NAME_SUFFIXES,
  SEX_OPTIONS,
  CIVIL_STATUSES,
  MIN_REJECTION_REASON,
  ZONE_VALUES,
  asString,
  text,
  isBlank,
  hasMaxLength,
  hasMinLength,
  normalizePhone,
  normalizeEmail,
  isPhonePH,
  isStrictMobile,
  toZone,
  isZone,
  isEmail,
  isUuid,
  parseDate,
  parseDateOnly,
  ageFromDateOnly,
  isFutureDateOnly,
  isFutureDate,
  ageFromDate,
  inEnum,
  isFiniteNumber,
  inRange,
  rejectionReasonError,
  addError,
  hasErrors,
  invalid,
  valid,
};

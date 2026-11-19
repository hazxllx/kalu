/**
 * @file Shared validation primitives and result envelopes (server-authoritative).
 *
 * Single source of truth for foundational input rules across KALUSAGAP's backend
 * validation layer (`route -> authenticate -> authorize -> validate -> controller ->
 * service -> repository/Supabase`). Matching frontend helpers live in
 * `frontend/src/utils/validation` for UX feedback only — every request is
 * re-validated server-side here before reaching controllers/services, while
 * services continue to enforce RBAC, barangay/RHU scope, and record ownership.
 *
 * Convention with `middleware/validate.js`:
 *   validator(input, req) -> { value }            // accepted, replaces req[part]
 *                         -> { error: { field } } // rejected with 400 + details
 */

/** Standard maximum character lengths aligned with KALUSAGAP database column bounds. */
export const TEXT_LIMITS = Object.freeze({
  short: 80,
  medium: 120,
  long: 200,
  address: 300,
  notes: 2000,
});

/** Controlled generational name suffixes accepted on resident profiles. */
export const NAME_SUFFIXES = Object.freeze(['', 'Jr.', 'Sr.', 'II', 'III', 'IV', 'V']);
export const SEX_OPTIONS = Object.freeze(['Male', 'Female']);
export const CIVIL_STATUSES = Object.freeze(['Single', 'Married', 'Widowed', 'Separated']);
/** Minimum non-whitespace character count required for rejection/revision explanations. */
export const MIN_REJECTION_REASON = 5;
/** Baseline password rule: at least 8 characters containing both a letter and a digit. */
const PASSWORD_POLICY = /^(?=.*[A-Za-z])(?=.*[0-9]).{8,}$/;

/** PH mobile number: 09XXXXXXXXX or +639XXXXXXXXX (spaces/dashes tolerated via `normalizePhone`). */
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
/** Unicode person-name pattern allowing letters, combining marks, spaces, hyphens, apostrophes, and initials. */
const PERSON_NAME = /^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+|(?:\.[\p{L}\p{M}]+)*\.?)*$/u;

/** Controlled Zone values (1..8) for a resident/household address. */
export const ZONE_VALUES = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);

/** Safely converts any value to a string, mapping `null` and `undefined` to `''`. */
export const asString = (value) => (value === null || value === undefined ? '' : String(value));
/** Converts a value to a trimmed string (`null`/`undefined` become `''`). */
export const text = (value) => asString(value).trim();
export const isBlank = (value) => text(value) === '';
/** Detects ASCII C0 control characters (`U+0000..U+001F`) and `DEL` (`U+007F`). */
export const hasControlChars = (value) => /[\u0000-\u001F\u007F]/.test(asString(value));
export const isValidPersonName = (value) => PERSON_NAME.test(text(value));

/** Checks raw string length against `max`; `hasMinLength` checks trimmed length against `min`. */
export const hasMaxLength = (value, max) => asString(value).length <= max;
export const hasMinLength = (value, min) => text(value).length >= min;
export const isStrongPassword = (value) => PASSWORD_POLICY.test(asString(value));

/** Strips common phone formatting characters (spaces, parentheses, hyphens, dots). */
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

/**
 * Coerces a Zone input (e.g. `3`, `'3'`, or `'Zone 3'`) to an integer `1..8`,
 * or `null` when blank, non-numeric, or outside `ZONE_VALUES`.
 */
export const toZone = (value) => {
  const raw = text(value).replace(/^zone\s*/i, '');
  if (raw === '') return null;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return ZONE_VALUES.includes(n) ? n : null;
};
export const isZone = (value) => toZone(value) !== null;

/** Parse "YYYY-MM-DD" (at local midnight) or an ISO datetime string into a `Date`, or `null`. */
export const parseDate = (value) => {
  const raw = text(value);
  if (!raw) return null;
  const d = raw.length === 10 ? new Date(`${raw}T00:00:00`) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Strict YYYY-MM-DD validator: 4-digit year, 01..12 month, valid calendar day. */
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a strict `YYYY-MM-DD` string as a UTC midnight `Date`, explicitly
 * rejecting calendar rollover dates (such as `2025-02-30` rolling into March).
 */
export const parseDateOnly = (value) => {
  const raw = text(value);
  if (!DATE_ONLY_PATTERN.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return date;
};

/** Computes completed age in whole calendar years using timezone-independent UTC dates. */
export const ageFromDateOnly = (value, now = new Date()) => {
  const date = parseDateOnly(value);
  if (!date) return null;
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - date.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < date.getUTCDate())) age -= 1;
  return age;
};

/** Returns `true` when a strict `YYYY-MM-DD` date falls after today's UTC calendar date. */
export const isFutureDateOnly = (value, now = new Date()) => {
  const date = parseDateOnly(value);
  if (!date) return false;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return date.getTime() > today;
};

/** Local-timezone date comparison helpers (`parseDate`-based, accepting ISO timestamps). */
export const isFutureDate = (value, now = new Date()) => {
  const d = parseDate(value);
  if (!d) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d.getTime() > today.getTime();
};

/** Computes completed age in whole calendar years using local-timezone `Date` components. */
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
 * Validates a rejection or resubmission reason shared by API validators and UI forms:
 * requires non-whitespace text of at least `min` characters, returning `''` when valid.
 *
 * @param {*} reason - Raw reason input.
 * @param {Object} [options] - Optional minimum length and custom error copy overrides.
 * @returns {string} Error message string, or `''` if valid.
 */
export const rejectionReasonError = (reason, { min = MIN_REJECTION_REASON, requiredMessage, minMessage } = {}) => {
  const value = text(reason);
  if (!value) return requiredMessage || 'Please provide a reason.';
  if (value.length < min) return minMessage || `Reason must be at least ${min} characters.`;
  return '';
};

/** Mutates `errors` to record `field -> message` only when `message` is truthy. */
export const addError = (errors, field, message) => {
  if (message) errors[field] = message;
  return errors;
};

export const hasErrors = (errors) => Object.keys(errors).length > 0;

/** Wraps field errors or normalized values in the `{ error }` / `{ value }` envelope expected by `middleware/validate.js`. */
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
  hasControlChars,
  isStrongPassword,
  invalid,
  valid,
};

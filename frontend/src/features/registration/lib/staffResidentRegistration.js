// frontend/src/features/registration/lib/staffResidentRegistration.js
import {
  CIVIL_STATUSES,
  NAME_SUFFIXES,
  SEX_OPTIONS,
  TEXT_LIMITS,
  email as validateEmail,
  enumValue,
  validateFields,
  maxLength,
} from '../../../utils/validation/index.js';

const normalizeStaffMobile = (value) => {
  const compact = String(value || '').trim().replace(/[\s().-]/g, '');
  if (/^09\d{9}$/.test(compact)) return compact;
  if (/^\+639\d{9}$/.test(compact)) return `0${compact.slice(3)}`;
  return null;
};

const validateStaffName = (value, label, isRequired) => {
  const name = String(value || '').trim();
  if (!name) return isRequired ? `${label} is required.` : '';
  if (name.length > TEXT_LIMITS.short) return `${label} is too long (max ${TEXT_LIMITS.short} characters).`;
  if (!/^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u.test(name)) {
    return `${label} can contain letters, spaces, hyphens, and apostrophes only.`;
  }
  return '';
};

export const todayInManila = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

const validateStaffDateOfBirth = (value) => {
  const date = String(value || '').trim();
  if (!date) return 'Date of birth is required.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Date of birth is invalid.';
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return 'Date of birth is invalid.';
  if (date > todayInManila()) return 'Date of birth cannot be in the future.';
  const age = calcStaffRegistrationAge(date);
  if (!age) return 'Date of birth is not a valid age (maximum 120 years).';
  return '';
};

/**
 * Compute age in completed years from a YYYY-MM-DD birth date string.
 * Returns empty string if blank or invalid.
 */
export function calcStaffRegistrationAge(dob, now = new Date()) {
  if (typeof dob !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return '';
  const [year, month, day] = dob.split('-').map(Number);
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (
    birth.getUTCFullYear() !== year
    || birth.getUTCMonth() !== month - 1
    || birth.getUTCDate() !== day
  ) {
    return '';
  }
  const todayParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const today = (type) => Number(todayParts.find((part) => part.type === type)?.value);
  let age = today('year') - year;
  if (
    today('month') < month
    || (today('month') === month && today('day') < day)
  ) {
    age -= 1;
  }
  return age >= 0 && age <= 120 ? String(age) : '';
}

/**
 * Parse a purok/zone string such as "Purok 5", "Zone 3", or "5" into a bounded
 * integer zone number (1..8) when present, or undefined when non-numeric.
 */
export function parsePurokZone(purok) {
  const raw = String(purok || '').trim();
  if (!raw) return undefined;
  const match = raw.match(/(?:purok|zone)?\s*(\d+)/i);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) return undefined;
  return parsed;
}

/**
 * Compose full residential address including house number, street, purok/zone,
 * and barangay for persistence in currentAddress / permanentAddress.
 */
export function composeStaffResidentAddress(form = {}) {
  const purok = String(form.purok || '').trim();
  const formattedPurok = purok
    ? (/^(?:purok|zone)\s+/i.test(purok) ? purok : `Purok ${purok}`)
    : '';
  return [
    String(form.houseNo || '').trim(),
    String(form.street || '').trim(),
    formattedPurok,
    String(form.barangay || '').trim(),
    'Pili, Camarines Sur',
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Validate staff resident registration fields using shared validation rules.
 */
export function validateStaffResidentForm(form = {}) {
  return validateFields(form, {
    firstName: (v) => validateStaffName(v, 'First name', true),
    middleName: (v) => validateStaffName(v, 'Middle name', false),
    lastName: (v) => validateStaffName(v, 'Last name', true),
    suffix: (v) => enumValue(v || '', NAME_SUFFIXES, { label: 'suffix', isRequired: false }),
    dob: validateStaffDateOfBirth,
    gender: (v) => enumValue(v, SEX_OPTIONS, { label: 'sex' }),
    civilStatus: (v) => enumValue(v, CIVIL_STATUSES, { label: 'civil status' }),
    barangay: (v) => (String(v || '').trim() ? '' : 'Barangay is required.'),
    contact: (v) => {
      if (!String(v || '').trim()) return '';
      return normalizeStaffMobile(v)
        ? ''
        : 'Enter a valid PH mobile number (09XXXXXXXXX or +639XXXXXXXXX).';
    },
    purok: (v) => {
      if (!String(v || '').trim()) return '';
      const raw = String(v).trim();
      if (!/^(?:purok|zone)?\s*\d{1,2}$/i.test(raw)) {
        return 'Purok/Zone must be a zone number from 1 to 8.';
      }
      const parsed = parsePurokZone(raw);
      return parsed === undefined
        ? 'Purok/Zone must be a zone number from 1 to 8.'
        : '';
    },
    street: (v) => maxLength(v, TEXT_LIMITS.address, 'Street / Sitio'),
    houseNo: (v) => {
      if (!String(v || '').trim()) return '';
      const houseNo = String(v).trim();
      if (houseNo.length > TEXT_LIMITS.short) return 'House number is too long (max 80 characters).';
      return /^[A-Za-z0-9][A-Za-z0-9 .#/-]*$/.test(houseNo)
        ? ''
        : 'House number can contain letters, numbers, spaces, periods, hyphens, slashes, and # only.';
    },
    email: (v, values) => {
      if (!values?.createAccount) return '';
      return validateEmail(v, { label: 'Email', isRequired: Boolean(values?.createAccount) });
    },
  });
}

/**
 * Build canonical payload for POST /api/residents (`residentsApi.create`).
 */
export function buildStaffResidentPayload(form = {}) {
  const address = composeStaffResidentAddress(form);
  const zone = parsePurokZone(form.purok);
  const payload = {
    firstName: String(form.firstName || '').trim(),
    middleName: String(form.middleName || '').trim(),
    lastName: String(form.lastName || '').trim(),
    suffix: form.suffix || undefined,
    birthDate: form.dob,
    sex: form.gender,
    civilStatus: form.civilStatus,
    barangay: form.barangay,
    cellphoneNo: form.contact ? normalizeStaffMobile(form.contact) || String(form.contact).trim() : undefined,
    currentAddress: address || undefined,
    permanentAddress: address || undefined,
    createLoginAccount: Boolean(form.createAccount),
    ...(zone !== undefined ? { zone } : {}),
    ...(form.createAccount ? { email: String(form.email || '').trim() } : {}),
  };
  return payload;
}

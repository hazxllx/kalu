import {
  email as validateEmail,
  strictMobile as validateStrictMobile,
  required,
  personName,
  validateFields,
  dateOfBirth,
} from '../../../utils/validation/index.js';

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
    firstName: (v) => personName(v, { label: 'First name', isRequired: true }),
    middleName: (v) => personName(v, { label: 'Middle name', isRequired: false }),
    lastName: (v) => personName(v, { label: 'Last name', isRequired: true }),
    dob: (v) => dateOfBirth(v, { label: 'Date of birth', isRequired: true }),
    gender: (v) => required(v, 'Sex'),
    civilStatus: (v) => required(v, 'Civil status'),
    barangay: (v) => required(v, 'Barangay'),
    contact: (v) => validateStrictMobile(v, { label: 'Contact number', isRequired: false }),
    email: (v, values) => validateEmail(v, {
      label: 'Email',
      isRequired: Boolean(values?.createAccount),
    }),
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
    cellphoneNo: form.contact ? String(form.contact).trim() : undefined,
    currentAddress: address || undefined,
    permanentAddress: address || undefined,
    createLoginAccount: Boolean(form.createAccount),
    ...(zone !== undefined ? { zone } : {}),
    ...(form.createAccount ? { email: String(form.email || '').trim() } : {}),
  };
  return payload;
}

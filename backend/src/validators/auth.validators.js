import { hasControlChars, isEmail, text, invalid, valid } from './common.js';

/**
 * @file Authentication & credential setup validators (server-authoritative).
 *
 * Executed by `middleware/validate.js` in the KALUSAGAP request pipeline
 * (`route -> rateLimit/authenticate -> validate -> controller -> service -> Supabase Auth`)
 * to sanitize login, password-reset, and first-time personnel password setup payloads.
 */

/**
 * Validates credential sign-in requests (`POST /auth/signin` or login endpoints).
 *
 * Only structural shape and length bounds (`email <= 254`, `password <= 200`) are
 * checked here — never whether the email exists or matches password complexity rules.
 * Note that `password` is coerced without trimming so significant leading/trailing
 * characters are preserved, and downstream auth services return a uniform generic
 * error for unknown accounts and wrong passwords to prevent account enumeration.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value: { email, password } }` or `{ error }`.
 */
export const signInValidator = (input = {}) => {
  const errors = {};
  const email = text(input.email);
  const password = input.password === undefined || input.password === null ? '' : String(input.password);

  if (!email) errors.email = 'Email is required.';
  else if (!isEmail(email)) errors.email = 'Please enter a valid email address.';
  else if (email.length > 254) errors.email = 'Email address is too long.';

  if (!password) errors.password = 'Password is required.';
  else if (password.length > 200) errors.password = 'Password is too long.';

  if (Object.keys(errors).length) return invalid(errors);
  return valid({ email, password });
};

/**
 * Validates password-reset initiation payloads.
 * Normalizes `email` to lowercase and strictly rejects any extra body keys
 * (`errors.request`) to prevent mass-assignment or redirect/token parameter injection.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value: { email } }` or `{ error }`.
 */
export const passwordResetRequestValidator = (input = {}) => {
  const errors = {};
  const email = text(input.email).trim().toLowerCase();
  if (!email) errors.email = 'Email is required.';
  else if (!isEmail(email) || email.length > 254) errors.email = 'Please enter a valid email address.';
  if (Object.keys(input || {}).some((key) => key !== 'email')) errors.request = 'Only an email address may be supplied.';
  return Object.keys(errors).length ? invalid(errors) : valid({ email });
};

/**
 * Validates first-time or forced password setup payloads for health personnel accounts.
 * Enforces strict object shape (plus an optional invitation proof for recovery) and a hardened
 * personnel password policy: 8 to 200 characters, no whitespace or ASCII control
 * characters, and at least one uppercase letter, lowercase letter, digit, and special character.
 *
 * @param {Object} [input] - Raw request body.
 * @returns {Object} Validation result `{ value: { password } }` or `{ error }`.
 */
export const personnelPasswordSetupValidator = (input = {}, { allowRecoverySecret = true } = {}) => {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid({ password: 'A password is required.' });
  const password = typeof input.password === 'string' ? input.password : '';
  const allowedKeys = allowRecoverySecret ? ['password', 'recoverySecret'] : ['password'];
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) errors.request = allowRecoverySecret
    ? 'Only the new password and invitation recovery proof may be supplied.'
    : 'Only the new password may be supplied.';
  if (input.recoverySecret !== undefined && (typeof input.recoverySecret !== 'string'
    || input.recoverySecret.length < 16 || input.recoverySecret.length > 2048
    || /[\s\u0000-\u001f]/.test(input.recoverySecret))) {
    errors.recoverySecret = 'The invitation recovery proof is invalid.';
  }
  if (!password || password.length > 200 || /\s/.test(password) || hasControlChars(password)
      || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9\s]).{8,}$/.test(password)) {
    errors.password = 'Use 8 to 200 characters including uppercase, lowercase, a number and a special character.';
  }
  return Object.keys(errors).length ? invalid(errors) : valid({ password, ...(input.recoverySecret === undefined ? {} : { recoverySecret: input.recoverySecret }) });
};

export const temporaryPersonnelPasswordChangeValidator = (input = {}) =>
  personnelPasswordSetupValidator(input, { allowRecoverySecret: false });

export default { signInValidator, passwordResetRequestValidator, personnelPasswordSetupValidator, temporaryPersonnelPasswordChangeValidator };

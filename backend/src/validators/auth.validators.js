import { hasControlChars, isEmail, text, invalid, valid } from './common.js';

/**
 * Sign-in validation.
 *
 * Only shape is validated here — never whether the email exists. The service
 * returns the same generic "Invalid email or password" for a wrong password and
 * an unknown account, so this endpoint cannot be used to enumerate users.
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

export const personnelPasswordSetupValidator = (input = {}) => {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid({ password: 'A password is required.' });
  const password = typeof input.password === 'string' ? input.password : '';
  if (Object.keys(input).some((key) => key !== 'password')) errors.request = 'Only the new password may be supplied.';
  if (!password || password.length > 200 || hasControlChars(password)
      || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9\s]).{8,}$/.test(password)) {
    errors.password = 'Use 8 to 200 characters including uppercase, lowercase, a number and a special character.';
  }
  return Object.keys(errors).length ? invalid(errors) : valid({ password });
};

export default { signInValidator, personnelPasswordSetupValidator };

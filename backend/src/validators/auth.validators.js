import { isEmail, text, invalid, valid } from './common.js';

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

export default { signInValidator };

export const normalizeRegistrationEmail = (value) => String(value ?? '').trim().toLowerCase();

const isDuplicateEmailError = (error) =>
  error?.code === 'user_already_exists'
  || error?.code === 'email_exists'
  || /already registered|already exists|user already/i.test(String(error?.message || ''));

/**
 * Supabase Auth may return an obfuscated user with no identities for an
 * existing email. Missing or malformed responses must never advance OTP state.
 */
export const signupResponseIssue = ({ data, error, email }) => {
  if (error) return isDuplicateEmailError(error) ? 'duplicate_email' : 'signup_failed';

  const user = data?.user;
  if (
    !user
    || typeof user.id !== 'string'
    || !user.id
    || normalizeRegistrationEmail(user.email) !== normalizeRegistrationEmail(email)
    || !Array.isArray(user.identities)
  ) {
    return 'invalid_response';
  }

  if (user.identities.length === 0) return 'duplicate_email';
  return null;
};

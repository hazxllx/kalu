export const normalizeRegistrationEmail = (value) => String(value ?? '').trim().toLowerCase();

/**
 * Supabase Auth is the single authoritative source for whether an
 * authentication account already exists. A matching profile or resident
 * record alone is NOT proof of an Auth account, so those cases are
 * classified separately and never surfaced as "already registered".
 */

const messageOf = (error) => String(error?.message || '');
const codeOf = (error) => String(error?.code || '');

// A genuine Auth-level duplicate: GoTrue reports the email is taken.
const isDuplicateEmailError = (error) =>
  codeOf(error) === 'user_already_exists'
  || codeOf(error) === 'email_exists'
  || /already registered|already exists|user already/i.test(messageOf(error));

// The Auth row was created but a database trigger/constraint (e.g. the
// profiles email-unique mirror) rejected the insert, so Supabase rolls the
// signup back and returns a generic "Database error saving new user". This
// means a PROFILE/record collision — not a confirmed Auth account — and must
// never be reported to the applicant as "already registered".
const isProfileConflictError = (error) =>
  /database error saving new user/i.test(messageOf(error))
  || /duplicate key value|unique constraint|profiles_email/i.test(messageOf(error));

// Too many verification emails in a short window.
const isRateLimitError = (error) =>
  codeOf(error) === 'over_email_send_rate_limit'
  || codeOf(error) === 'over_request_rate_limit'
  || Number(error?.status) === 429
  || /rate limit|too many requests|frequency/i.test(messageOf(error));

const diagnosticTextOf = (error) => [
  error?.message,
  error?.details,
  error?.hint,
  error?.code,
  error?.error_description,
].filter((value) => typeof value === 'string').join(' ');

const isSmtpAuthenticationError = (error) =>
  /\b535\b|5\.7\.8|smtp.{0,80}(?:auth|credential)|(?:auth|credential).{0,80}smtp/i
    .test(diagnosticTextOf(error));

const isEmailDeliveryError = (error) =>
  /error sending (?:confirmation|signup|verification) email|smtp|email delivery/i
    .test(diagnosticTextOf(error));

/**
 * Classify any thrown/returned Supabase Auth error into a stable issue code.
 * Shared by the signUp response path and the catch handler so both stay
 * consistent.
 *
 * @returns {'duplicate_email'|'profile_conflict'|'rate_limited'|'smtp_auth_failed'|'email_delivery_failed'|'signup_failed'}
 */
export const classifySignupError = (error) => {
  if (!error) return 'signup_failed';
  if (isDuplicateEmailError(error)) return 'duplicate_email';
  if (isProfileConflictError(error)) return 'profile_conflict';
  if (isRateLimitError(error)) return 'rate_limited';
  if (isSmtpAuthenticationError(error)) return 'smtp_auth_failed';
  if (isEmailDeliveryError(error)) return 'email_delivery_failed';
  return 'signup_failed';
};

/**
 * Return a safe, actionable message for signup/resend failures. Auth provider
 * diagnostics can contain implementation details, so raw error text is never
 * displayed to the applicant.
 *
 * @param {unknown} error
 * @param {{ isResend?: boolean }} [options]
 * @returns {string}
 */
export const signupErrorMessage = (error, { isResend = false } = {}) => {
  const issue = classifySignupError(error);
  if (issue === 'smtp_auth_failed') {
    return 'The verification email could not be sent because the email provider rejected SMTP authentication. Your email is not verified. Please try again later or contact the RHU.';
  }
  if (issue === 'email_delivery_failed') {
    return 'We could not send your verification email. Your email is not verified. Please try again or contact the RHU.';
  }
  return isResend
    ? 'We could not resend your verification code. Please try again later.'
    : 'We could not send your verification code. Please try again later.';
};

/**
 * Best-effort extraction of the server-mandated retry interval (in seconds)
 * from a Supabase Auth rate-limit error. GoTrue surfaces the remaining time in
 * the message, e.g. "For security purposes, you can only request this after 54
 * seconds." or exposes it on `retry_after`. This lets the UI restore an
 * accurate resend countdown even after a page refresh or a second tab, where
 * the client-side timer was lost but the server still enforces the interval.
 *
 * @param {unknown} error
 * @returns {number} Seconds to wait, or 0 when no value can be determined.
 */
export const rateLimitRetrySeconds = (error) => {
  const err = /** @type {{ retry_after?: unknown }} */ (error) || {};
  const direct = Number(err.retry_after);
  if (Number.isFinite(direct) && direct > 0) return Math.ceil(direct);
  const match = messageOf(error).match(/after\s+(\d+)\s*second/i);
  if (match) {
    const secs = Number(match[1]);
    if (Number.isFinite(secs) && secs > 0) return Math.ceil(secs);
  }
  return 0;
};

/**
 * Inspect a `supabase.auth.signUp` result.
 *
 * Supabase Auth may return an obfuscated user with no identities for an
 * existing email (email-enumeration protection). Missing or malformed
 * responses must never advance OTP state.
 *
 * @returns {'duplicate_email'|'profile_conflict'|'rate_limited'|'smtp_auth_failed'|'email_delivery_failed'|'signup_failed'|'invalid_response'|null}
 *   `null` means the signup is a genuinely new account and the OTP was sent.
 */
export const signupResponseIssue = ({ data, error, email }) => {
  if (error) return classifySignupError(error);

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

  // Empty identities = Supabase's obfuscated response for an email that already
  // has a confirmed Auth account. This is the authoritative duplicate signal.
  if (user.identities.length === 0) return 'duplicate_email';
  return null;
};

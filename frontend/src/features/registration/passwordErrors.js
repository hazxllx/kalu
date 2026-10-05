/**
 * Registration password-error helpers.
 *
 * KALUSAGAP sets the resident's real password during registration via Supabase
 * `auth.updateUser({ password })`. On a retry (the account already exists with
 * the previously chosen password) Supabase rejects setting the SAME password
 * with "New password should be different from the old password." That rule is a
 * password-CHANGE rule and must not surface during NEW registration, where the
 * resident is only re-confirming the password they already own.
 *
 * This helper isolates that specific, harmless error so registration can treat
 * it as success while a genuine password-change flow keeps the rule.
 */

const PASSWORD_REUSE_PATTERNS = [
  /different from the old password/i,
  /must be different.*old password/i,
  /same password as the old/i,
];

/** True when the Supabase error means the new password equals the current one. */
export const isPasswordReuseError = (message) =>
  PASSWORD_REUSE_PATTERNS.some((re) => re.test(String(message || '')));

export default { isPasswordReuseError };

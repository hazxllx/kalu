/**
 * Pure gating logic for the resident registration "Send Verification Code"
 * button. Kept free of React so it can be unit-tested with `node --test` and
 * reused by the Step 2 "Account & Contact" UI.
 *
 * The button must be disabled when:
 *  - a send/verify request is already in flight, or
 *  - the email field is empty or not a valid email address, or
 *  - the registration flow has confirmed this email is already a registered
 *    Auth account (a duplicate), or
 *  - the resend cooldown is still counting down.
 *
 * This prevents repeated requests and stops verification codes from being sent
 * to an address the applicant cannot access / that is already taken.
 */

import { isEmail } from '../../utils/validation/index.js';
import { normalizeRegistrationEmail } from './signupResponse.js';

/**
 * @param {object} s
 * @param {string} s.email            Raw email field value.
 * @param {string} s.emailPhase       "idle" | "sending" | "sent" | "verifying" | "verified".
 * @param {number} s.resendIn         Seconds remaining on the resend cooldown.
 * @param {boolean} s.emailDuplicate  True once a duplicate Auth account was confirmed.
 * @returns {boolean} Whether the Send/Resend button should be disabled.
 */
export const isSendCodeDisabled = ({ email, emailPhase, resendIn = 0, emailDuplicate = false }) => {
  if (emailPhase === 'sending' || emailPhase === 'verifying') return true;
  if (emailDuplicate) return true;
  if (!isEmail(normalizeRegistrationEmail(email))) return true;
  // After a successful send, the button becomes "Send Code Again" and is only
  // re-enabled once the cooldown elapses.
  if (emailPhase === 'sent' && resendIn > 0) return true;
  return false;
};

/**
 * Explains why the button is disabled, for accessibility/debugging. Returns an
 * empty string when the button is enabled.
 */
export const sendCodeDisabledReason = ({ email, emailPhase, resendIn = 0, emailDuplicate = false }) => {
  if (emailPhase === 'sending') return 'A verification code is being sent.';
  if (emailPhase === 'verifying') return 'Verifying the code you entered.';
  if (emailDuplicate) return 'This email is already registered. Log in or reset your password instead.';
  if (!isEmail(normalizeRegistrationEmail(email))) return 'Enter a valid email address first.';
  if (emailPhase === 'sent' && resendIn > 0) return `You can request another code in ${resendIn}s.`;
  return '';
};

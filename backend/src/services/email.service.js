// backend/src/services/email.service.js
import nodemailer from 'nodemailer';
import { readFile } from 'node:fs/promises';
import env from '../config/env.js';

/**
 * KALUSAGAP — Transactional SMTP Email Service (`email.service.js`).
 *
 * Architectural layer:
 *   `route -> controller -> auth / residencyTransfer / personnel service -> email.service -> SMTP server`
 *
 * Responsibilities:
 *   - Lazily initializes and caches a TLS-enforced Nodemailer SMTP transporter
 *     configured from environment settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
 *     `SMTP_PASSWORD`, `SMTP_FROM`) with traffic/debug logging disabled.
 *   - Sends transactional security emails managed directly by the backend:
 *       1. Transfer of Residency 4-digit OTP codes (`sendTransferOtp`)
 *       2. One-time password reset links (`sendPasswordResetEmail`)
 *       3. One-time personnel/account password setup links (`sendPasswordSetupEmail`)
 *     (Initial resident registration email verification is handled separately by
 *     Supabase Auth's Confirm Signup flow.)
 *   - Protects credentials, recipient addresses, OTPs, and one-time URLs by
 *     monitoring stream consumption (`beforeData`) and stripping raw SMTP server
 *     messages before rethrowing sanitized error metadata.
 */

let transporter;
const trackedTransports = new WeakSet();
const loopbackSmtpHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const SMTP_ERROR_CODES = new Set([
  'EAUTH', 'ENOAUTH', 'EOAUTH2', 'EDNS', 'ETLS', 'EREQUIRETLS', 'ECONNECTION',
  'ESOCKET', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN',
  'EPIPE', 'EENVELOPE', 'EMESSAGE', 'ESTREAM', 'EPROTOCOL', 'ECONFIG', 'EPROXY',
]);
const SMTP_PHASES = new Set(['auth', 'handshake', 'starttls', 'mail_from', 'rcpt_to', 'data', 'after_send', 'connect', 'unknown']);
const SMTP_CONNECTION_CODES = new Set(['EDNS', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE']);

export const emailSender = (address) => ({ name: 'Kalusagap', address });

export const getSmtpFailureDetails = (error) => {
  const smtpCode = SMTP_ERROR_CODES.has(error?.originalCode) ? error.originalCode
    : SMTP_ERROR_CODES.has(error?.code) ? error.code : null;
  const smtpPhase = SMTP_PHASES.has(error?.smtpPhase) ? error.smtpPhase : 'unknown';
  const responseCode = Number.isInteger(error?.responseCode)
    && error.responseCode >= 100 && error.responseCode <= 599 ? error.responseCode : null;

  let failureClass = 'unknown';
  let code = 'SMTP_OUTCOME_UNKNOWN';
  if (error?.code === 'SMTP_NOT_CONFIGURED') {
    failureClass = 'configuration_failure';
    code = 'SMTP_NOT_CONFIGURED';
  } else if (error?.code === 'SMTP_RECIPIENT_REJECTED') {
    failureClass = 'recipient_rejection';
    code = 'SMTP_RECIPIENT_REJECTED';
  } else if (['EAUTH', 'ENOAUTH', 'EOAUTH2'].includes(smtpCode)) {
    failureClass = 'authentication_failure';
    code = responseCode === 535 ? 'SMTP_AUTH_CREDENTIALS_REJECTED' : 'SMTP_AUTHENTICATION_FAILED';
  } else if (smtpPhase === 'mail_from' && [550, 553].includes(responseCode)) {
    failureClass = 'sender_rejection';
    code = 'SMTP_SENDER_REJECTED';
  } else if (['ETLS', 'EREQUIRETLS'].includes(smtpCode) || smtpPhase === 'starttls') {
    failureClass = 'tls_failure';
    code = 'SMTP_TLS_FAILURE';
  } else if (smtpCode === 'ETIMEDOUT' || error?.originalCode === 'ETIMEDOUT') {
    failureClass = 'connection_timeout';
    code = 'SMTP_CONNECTION_TIMEOUT';
  } else if (responseCode >= 400 && responseCode <= 599) {
    failureClass = 'provider_rejection';
    code = 'SMTP_PROVIDER_REJECTED';
  } else if (SMTP_CONNECTION_CODES.has(smtpCode)) {
    failureClass = 'connection_failure';
    code = 'SMTP_CONNECTION_FAILED';
  } else if (smtpCode) {
    code = `SMTP_${smtpCode}`;
  }

  return { code, failureClass, smtpCode, smtpPhase, responseCode };
};

const responseCodeFromInfo = (info) => {
  const finalReply = String(info?.response || '').trim().split(/\r?\n/).at(-1);
  const responseCode = Number(finalReply.match(/^(\d{3})(?:\s|$)/)?.[1]);
  return Number.isInteger(responseCode) && responseCode >= 100 && responseCode <= 599 ? responseCode : null;
};

const assertRecipientAccepted = (info, email, message) => {
  const includesRecipient = (list) => Array.isArray(list)
    && list.some((recipient) => String(recipient?.address || recipient).trim().toLowerCase() === String(email).trim().toLowerCase());
  if (!includesRecipient(info?.accepted) || includesRecipient(info?.rejected)) {
    throw Object.assign(new Error(message), {
      code: 'SMTP_RECIPIENT_REJECTED',
      smtpPhase: 'rcpt_to',
      responseCode: responseCodeFromInfo(info),
    });
  }
};

/**
 * Return the singleton Nodemailer SMTP transporter, creating it on first use.
 *
 * Enforces implicit TLS on port `465` and `STARTTLS` (`requireTLS: true`) on all
 * other ports, disables Nodemailer debug/protocol logging, and throws an error
 * with `code: 'SMTP_NOT_CONFIGURED'` if any required SMTP environment variable is missing.
 *
 * @returns {Object} Configured Nodemailer transporter instance.
 */
export const getEmailTransporter = () => {
  const requireAuthentication = env.isProduction
    || (env.isHostedSupabaseDevelopment && !loopbackSmtpHosts.has(env.smtpHost));
  if (!env.smtpHost || !env.smtpFrom
    || (requireAuthentication && (!env.smtpUser || !env.smtpPassword))) {
    throw Object.assign(new Error('Email delivery is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM.'), {
      code: 'SMTP_NOT_CONFIGURED',
    });
  }
  transporter ||= nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    requireTLS: requireAuthentication && env.smtpPort !== 465,
    ignoreTLS: !requireAuthentication,
    ...(requireAuthentication ? { auth: { user: env.smtpUser, pass: env.smtpPassword } } : {}),
    logger: false,
    debug: false,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  });
  return transporter;
};

/**
 * Send an email through Nodemailer while tracking whether the `DATA` body stream
 * began transmitting (`beforeData`) without enabling SMTP traffic logging.
 *
 * On failure, strips raw server error text (which may echo recipient emails,
 * credentials, or secret links) and attaches structured retry diagnostics
 * (`code`, `smtpPhase`, `responseCode`, `beforeData`).
 *
 * @param {Object} message - Nodemailer message options (`from`, `to`, `subject`, `text`, `html`).
 * @param {Object} [options] - Optional transport override (`transport`) for testing.
 * @returns {Promise<Object>} Nodemailer delivery result (`accepted`, `rejected`, `messageId`, etc.).
 */
export const sendSmtpMail = async (message, { transport = getEmailTransporter() } = {}) => {
  const progress = { monitored: false, bodyStarted: false };
  try {
    if (typeof transport.use === 'function' && !trackedTransports.has(transport)) {
      transport.use('stream', (mail, next) => {
        const tracking = mail.data.personnelSmtpProgress;
        if (tracking && typeof mail.message?.createReadStream === 'function') {
          tracking.monitored = true;
          const createReadStream = mail.message.createReadStream;
          mail.message.createReadStream = function (...args) {
            const stream = createReadStream.apply(this, args);
            // A CONN error can occur during DATA too. Resuming this stream is
            // the conservative boundary after which a disconnect is ambiguous.
            if (stream.readableFlowing || stream.readableDidRead) tracking.bodyStarted = true;
            stream.once('resume', () => { tracking.bodyStarted = true; });
            return stream;
          };
        }
        next();
      });
      trackedTransports.add(transport);
    }
    return await transport.sendMail({ ...message, personnelSmtpProgress: progress });
  } catch (error) {
    const command = String(error?.command || '').trim().toUpperCase();
    const smtpPhase = /^MAIL FROM\b/.test(command) ? 'mail_from'
      : /^RCPT TO\b/.test(command) ? 'rcpt_to'
        : /^AUTH\b/.test(command) ? 'auth'
          : /^STARTTLS\b/.test(command) ? 'starttls'
            : /^(EHLO|HELO|LHLO)\b/.test(command) ? 'handshake'
              : command === 'DATA' ? 'data'
                : /^(QUIT|RSET)\b/.test(command) ? 'after_send'
                  : /^(CONN|CONNECT|CONNECTION)$/.test(command) ? 'connect'
                    : 'unknown';
    const responseCode = Number(error?.responseCode);
    const safeOriginalCode = [error?.originalCode, error?.cause?.code, error?.errno]
      .find((candidate) => SMTP_ERROR_CODES.has(candidate)) || null;
    // Never propagate SMTP error messages/responses: they can contain recipient
    // addresses, credentials or the generated invitation link.
    throw Object.assign(new Error('SMTP send failed.'), {
      code: SMTP_ERROR_CODES.has(error?.code) ? error.code : 'SMTP_ERROR',
      // Keep only allow-listed system error identifiers for operational logs.
      // The raw SMTP message/response can contain credentials or message data.
      originalCode: safeOriginalCode,
      smtpPhase,
      responseCode: Number.isInteger(responseCode) && responseCode >= 100 && responseCode <= 599 ? responseCode : null,
      beforeData: progress.monitored && !progress.bodyStarted,
    });
  }
};

/**
 * Transfer of Residency verification email.
 *
 * This template is DISTINCT from the New Resident Registration email. Resident
 * registration email verification is handled entirely by Supabase Auth's
 * "Confirm Signup" template ("Verify your email address" / "Thank you for
 * registering with KALUSAGAP…") and is never sent from here. This message must
 * never use registration wording, because the recipient is an EXISTING resident
 * account authenticating a Transfer of Residency request — not a new signup.
 *
 * The `otp` is always the plaintext 4-digit string (leading zeros preserved).
 * It is never logged and never returned through any API response.
 */
export const sendTransferOtp = async ({ email, otp }) => {
  const text = [
    'Hello,',
    '',
    'Use the verification code below to continue your Transfer of Residency request in KALUSAGAP.',
    '',
    `Verification code: ${otp}`,
    '',
    'This code expires in 5 minutes.',
    'Do not share this code with anyone.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#0f172a;">
      <h1 style="font-size:18px;font-weight:700;margin:0 0 16px;">Verify your Transfer of Residency request</h1>
      <p style="font-size:14px;line-height:1.6;margin:0 0 16px;">Hello,</p>
      <p style="font-size:14px;line-height:1.6;margin:0 0 20px;">
        Use the verification code below to continue your Transfer of Residency request in KALUSAGAP.
      </p>
      <p style="font-size:12px;font-weight:700;letter-spacing:0.12em;color:#64748b;margin:0 0 8px;text-transform:uppercase;">
        Verification code
      </p>
      <p style="font-size:32px;font-weight:800;letter-spacing:0.4em;margin:0 0 20px;color:#1d4ed8;">${otp}</p>
      <p style="font-size:13px;line-height:1.6;margin:0 0 4px;">This code expires in 5 minutes.</p>
      <p style="font-size:13px;line-height:1.6;margin:0;">Do not share this code with anyone.</p>
    </div>
  `;

  const result = await sendSmtpMail({
    from: emailSender(env.smtpFrom),
    to: email,
    subject: 'KALUSAGAP Transfer of Residency Verification Code',
    text,
    html,
  });
  assertRecipientAccepted(result, email, 'Transfer verification email was not accepted.');
};

/**
 * Send a one-time password reset email with HTML-escaped link markup and verify
 * that the SMTP server explicitly accepted the target recipient address.
 *
 * @param {Object} params - Email parameters (`email`, `resetUrl`).
 * @returns {Promise<void>}
 */
export const sendPasswordResetEmail = async ({ email, resetUrl }) => {
  const safeUrl = String(resetUrl || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const message = {
    from: emailSender(env.smtpFrom),
    to: { address: email },
    subject: 'KALUSAGAP Password Reset',
    text: [
      'Hello,',
      '',
      'Use the link below to reset your KALUSAGAP password.',
      '',
      resetUrl,
      '',
      'This is a one-time link. If you did not request a password reset, you can ignore this email.',
    ].join('\n'),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a;">
      <h1 style="font-size:18px;">Reset your KALUSAGAP password</h1>
      <p>Use the button below to choose a new password. This is a one-time link.</p>
      <p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;background:#174f86;color:#fff;text-decoration:none;border-radius:6px;">Reset Password</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    </div>`,
  };
  const result = await sendSmtpMail(message);
  assertRecipientAccepted(result, email, 'Password reset email was not accepted.');
};

/**
 * Send a one-time account password setup invitation email (used when provisioning
 * staff/personnel accounts) with HTML-escaped link markup, verifying SMTP recipient
 * acceptance (`code: 'SMTP_RECIPIENT_REJECTED'` on rejection).
 *
 * @param {Object} params - Email parameters (`email`, `setupUrl`).
 * @returns {Promise<void>}
 */
export const sendPasswordSetupEmail = async ({ email, setupUrl }) => {
  const safeUrl = String(setupUrl || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const message = {
    from: emailSender(env.smtpFrom),
    to: { address: email },
    subject: 'KALUSAGAP Password Setup',
    text: [
      'Hello,',
      '',
      'Use the link below to set up your KALUSAGAP account password.',
      '',
      setupUrl,
      '',
      'This is a one-time setup link. If it has expired or was already used, request a new link from Forgot Password.',
    ].join('\n'),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a;">
      <h1 style="font-size:18px;">Set up your KALUSAGAP password</h1>
      <p>Use the button below to finish setting up your account. This is a one-time link.</p>
      <p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;background:#174f86;color:#fff;text-decoration:none;border-radius:6px;">Set Up Password</a></p>
      <p>If you did not expect this email, you can ignore it.</p>
    </div>`,
  };
  const result = await sendSmtpMail(message);
  assertRecipientAccepted(result, email, 'Password setup email was not accepted.');
};

/**
 * Resend a resident invitation using a token generated by Supabase Auth and
 * the same branded HTML configured for Auth's native invite template.
 */
export const sendResidentInvitationEmail = async ({ email, invitationUrl }) => {
  const safeUrl = String(invitationUrl || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const template = await readFile(new URL('../../../supabase/templates/invite.html', import.meta.url), 'utf8');
  if (!template.includes('{{ .ConfirmationURL }}')) {
    throw Object.assign(new Error('Resident invitation template is missing its Auth confirmation URL.'), { code: 'INVITATION_TEMPLATE_INVALID' });
  }
  const message = {
    from: emailSender(env.smtpFrom),
    to: { address: email },
    subject: 'Welcome to KALUSAGAP',
    text: [
      'KALUSAGAP',
      'COMMUNITY HEALTH SYSTEM',
      '',
      'Welcome to KALUSAGAP',
      '',
      'Your resident portal account has been created. You are invited to activate your account and access the KALUSAGAP Resident Portal.',
      '',
      `Accept Invitation: ${invitationUrl}`,
      '',
      'Click the button above to complete your account setup. Once your account is activated, you can securely access your resident portal.',
      '',
      'For your security, this invitation link is intended only for the recipient. If you did not expect this invitation, please disregard this email.',
      '',
      'KALUSAGAP – Community Health Risk Monitoring System',
      'Municipality of Pili, Camarines Sur',
    ].join('\n'),
    html: template.replaceAll('{{ .ConfirmationURL }}', safeUrl),
  };
  const result = await sendSmtpMail(message);
  assertRecipientAccepted(result, email, 'Resident invitation email was not accepted.');
};

export default {
  sendTransferOtp, sendPasswordResetEmail, sendPasswordSetupEmail, sendResidentInvitationEmail,
  getEmailTransporter, sendSmtpMail, getSmtpFailureDetails, emailSender,
};

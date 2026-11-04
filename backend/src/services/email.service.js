import nodemailer from 'nodemailer';
import env from '../config/env.js';

let transporter;
const trackedTransports = new WeakSet();
const SMTP_ERROR_CODES = new Set([
  'EAUTH', 'ENOAUTH', 'EOAUTH2', 'EDNS', 'ETLS', 'EREQUIRETLS', 'ECONNECTION',
  'ESOCKET', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN',
  'EPIPE', 'EENVELOPE', 'EMESSAGE', 'ESTREAM', 'EPROTOCOL', 'ECONFIG', 'EPROXY',
]);

export const getEmailTransporter = () => {
  if (!env.smtpHost || !env.smtpUser || !env.smtpPassword || !env.smtpFrom) {
    throw Object.assign(new Error('Email delivery is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM.'), {
      code: 'SMTP_NOT_CONFIGURED',
    });
  }
  transporter ||= nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    requireTLS: env.smtpPort !== 465,
    auth: { user: env.smtpUser, pass: env.smtpPassword },
    logger: false,
    debug: false,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  });
  return transporter;
};

/** Track body consumption without enabling SMTP traffic/body logging. */
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
    const smtpPhase = /^(MAIL FROM|RCPT TO)\b/.test(command) ? 'envelope'
      : /^(AUTH|EHLO|HELO|LHLO|STARTTLS)\b/.test(command) ? 'handshake'
        : command === 'DATA' ? 'data'
          : /^(QUIT|RSET)\b/.test(command) ? 'after_send'
            : 'unknown';
    const responseCode = Number(error?.responseCode);
    // Never propagate SMTP error messages/responses: they can contain recipient
    // addresses, credentials or the generated invitation link.
    throw Object.assign(new Error('SMTP send failed.'), {
      code: SMTP_ERROR_CODES.has(error?.code) ? error.code : 'SMTP_ERROR',
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

  await getEmailTransporter().sendMail({
    from: env.smtpFrom,
    to: email,
    subject: 'KALUSAGAP Transfer of Residency Verification Code',
    text,
    html,
  });
};

export default { sendTransferOtp, getEmailTransporter, sendSmtpMail };

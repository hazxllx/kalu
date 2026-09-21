import nodemailer from 'nodemailer';
import env from '../config/env.js';

let transporter;

const getTransporter = () => {
  if (!env.smtpHost || !env.smtpUser || !env.smtpPassword || !env.smtpFrom) {
    throw new Error('Transfer OTP email delivery is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM.');
  }
  transporter ||= nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: { user: env.smtpUser, pass: env.smtpPassword },
  });
  return transporter;
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

  await getTransporter().sendMail({
    from: env.smtpFrom,
    to: email,
    subject: 'KALUSAGAP Transfer of Residency Verification Code',
    text,
    html,
  });
};

export default { sendTransferOtp };
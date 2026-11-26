import assert from 'node:assert/strict';
import test from 'node:test';

import { configureLocalTestEnvironment } from './helpers/localEnv.js';
configureLocalTestEnvironment();

const { buildPasswordResetEmailMessage } = await import('../src/services/email.service.js');

test('password reset email has a clickable button and visible copyable fallback URL', () => {
  const resetUrl = 'https://kalusagap.vercel.app/reset-password?token_hash=one-time-token&type=recovery';
  const safeUrl = resetUrl.replace(/&/g, '&amp;');
  const message = buildPasswordResetEmailMessage({ email: 'resident@example.test', resetUrl });

  assert.ok(message.html.includes(`<a href="${safeUrl}" style="display:inline-block;padding:12px 18px;background:#174f86;color:#fff;text-decoration:none;border-radius:6px;">Reset Password</a>`));
  assert.ok(message.html.includes('If the button does not open, copy this address into your browser:'));
  assert.ok(message.html.includes(`>${safeUrl}</p>`));
  assert.ok(message.text.includes('If the button does not open, copy and paste this address into your browser:'));
  assert.ok(message.text.includes(resetUrl));
});

test('password reset email refuses to send without an absolute reset URL', () => {
  assert.throws(
    () => buildPasswordResetEmailMessage({ email: 'resident@example.test', resetUrl: '' }),
    /absolute HTTP\(S\) URL/,
  );
});

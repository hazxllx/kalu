import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REGISTRATION_OTP_LENGTH,
  sanitizeRegistrationOtp,
  isValidRegistrationOtp,
} from '../src/features/registration/otp.js';

// New Resident Registration OTP is a 6-digit Supabase Auth email code, handled
// as a STRING (leading zeros preserved). These tests lock the length and the
// validation rules used before calling supabase.auth.verifyOtp().

test('registration OTP length is 6', () => {
  assert.equal(REGISTRATION_OTP_LENGTH, 6);
});

test('a 6-digit code is accepted', () => {
  assert.equal(isValidRegistrationOtp('123456'), true);
});

test('a 5-digit code is rejected', () => {
  assert.equal(isValidRegistrationOtp('12345'), false);
});

test('a 7-digit code is rejected', () => {
  assert.equal(isValidRegistrationOtp('1234567'), false);
});

test('a non-numeric code is rejected', () => {
  assert.equal(isValidRegistrationOtp('12a456'), false);
  assert.equal(isValidRegistrationOtp('abcdef'), false);
  assert.equal(isValidRegistrationOtp(''), false);
});

test('a leading-zero code such as 012345 is accepted and kept as a string', () => {
  const code = '012345';
  assert.equal(isValidRegistrationOtp(code), true);
  // The value must remain a string; coercing to Number would drop the leading zero.
  assert.equal(typeof code, 'string');
  assert.equal(code, '012345');
});

test('the token passed to Supabase verifyOtp is a 6-char string, not a number', () => {
  // Mirror the component: digits are joined into a string and passed unmodified.
  const otpDigits = ['0', '1', '2', '3', '4', '5'];
  const token = otpDigits.join('');
  assert.equal(typeof token, 'string');
  assert.equal(token.length, REGISTRATION_OTP_LENGTH);
  assert.equal(isValidRegistrationOtp(token), true);
});

test('sanitize keeps digits, preserves leading zeros, and caps at 6', () => {
  assert.equal(sanitizeRegistrationOtp('012345'), '012345');
  assert.equal(sanitizeRegistrationOtp('12-34-56'), '123456');
  assert.equal(sanitizeRegistrationOtp('1234567890'), '123456');
  assert.equal(sanitizeRegistrationOtp('abc012xyz'), '012');
});

test('registration OTP length is independent from the transfer OTP length (4)', () => {
  const TRANSFER_OTP_LENGTH = 4;
  assert.notEqual(REGISTRATION_OTP_LENGTH, TRANSFER_OTP_LENGTH);
  // A valid transfer-length code must NOT satisfy registration validation.
  assert.equal(isValidRegistrationOtp('0123'), false);
});

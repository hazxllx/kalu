import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptTemporaryPassword,
  encryptTemporaryPassword,
  generateTemporaryPassword,
} from '../src/utils/temporaryPassword.js';

const SECRET = 'temporary-password-test-key';

test('generated temporary passwords are exactly nine characters and meet the policy', () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const password = generateTemporaryPassword();
    assert.equal(password.length, 9);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[a-z]/);
    assert.match(password, /\d/);
    assert.match(password, /[^A-Za-z0-9\s]/);
    assert.doesNotMatch(password, /[O0Il1]/);
  }
});

test('temporary passwords can be encrypted for the email outbox and authenticated against tampering', () => {
  const password = generateTemporaryPassword();
  const encrypted = encryptTemporaryPassword(password, SECRET);
  assert.notEqual(encrypted, password);
  assert.equal(decryptTemporaryPassword(encrypted, SECRET), password);
  assert.throws(() => decryptTemporaryPassword(encrypted, 'a-different-test-key'));
  const parts = encrypted.split('.');
  parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`;
  assert.throws(() => decryptTemporaryPassword(parts.join('.'), SECRET));
});

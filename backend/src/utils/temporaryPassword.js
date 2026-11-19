import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt } from 'node:crypto';
import env from '../config/env.js';
import { personnelPasswordSetupValidator } from '../validators/auth.validators.js';

/**
 * @module utils/temporaryPassword
 * @description Cryptographic generation and authenticated encryption/decryption of
 * one-time temporary passwords for newly provisioned KALUSAGAP personnel accounts.
 *
 * Architectural layer:
 *   `route -> authenticate -> authorize -> controller -> service (personnel provisioning) -> repository/Supabase`
 *
 * Security design:
 *   - Generates 9-character random passwords using `node:crypto` CSPRNG (`randomInt`)
 *     across four character classes while omitting visually ambiguous glyphs (`I`, `O`, `l`, `0`, `1`).
 *   - Verifies every generated credential against `personnelPasswordSetupValidator` so
 *     initial credentials always satisfy the same complexity policy enforced at setup.
 *   - Encrypts temporary passwords at rest with AES-256-GCM (`v1.<iv>.<authTag>.<ciphertext>`)
 *     using a 256-bit key derived via domain-separated HMAC-SHA256 from `env.supabaseServiceRoleKey`
 *     (server-only secret, never accessible through client/RLS tokens).
 */

/**
 * Character classes (uppercase, lowercase, digits, symbols) excluding look-alike
 * characters (`I`, `O`, `l`, `0`, `1`) to prevent manual transcription mistakes.
 */
const GROUPS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%^&*()-_=+[]{}:,.?',
];
const ALPHABET = GROUPS.join('');
const CIPHER = 'aes-256-gcm';
const TEMPORARY_PASSWORD_LENGTH = 9;

/**
 * Derives a 32-byte AES-256 key from the configured server secret using
 * domain-separated HMAC-SHA256 (`'kalusagap:temporary-password:v1'`).
 *
 * @param {string} [secret=env.supabaseServiceRoleKey] - Master secret (minimum 16 chars).
 * @returns {Buffer} 32-byte derived symmetric encryption key.
 */
const encryptionKey = (secret = env.supabaseServiceRoleKey) => {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('Temporary credential encryption is not configured.');
  }
  return createHmac('sha256', secret).update('kalusagap:temporary-password:v1').digest();
};

/**
 * Generates a cryptographically random 9-character temporary password guaranteed
 * to contain at least one character from each required class and validated against
 * `personnelPasswordSetupValidator`.
 *
 * @returns {string} Policy-compliant plaintext temporary password.
 */
export const generateTemporaryPassword = () => {
  // Guarantee at least one character from each required class (upper, lower, digit, symbol).
  const characters = GROUPS.map((group) => group[randomInt(group.length)]);
  while (characters.length < TEMPORARY_PASSWORD_LENGTH) characters.push(ALPHABET[randomInt(ALPHABET.length)]);
  // Unbiased Fisher-Yates shuffle so the guaranteed class characters do not sit in fixed positions.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  const password = characters.join('');
  if (password.length !== TEMPORARY_PASSWORD_LENGTH || personnelPasswordSetupValidator({ password }).error) {
    throw new Error('Generated temporary password does not meet the password policy.');
  }
  return password;
};

/**
 * Encrypts a plaintext temporary password with AES-256-GCM and a fresh 96-bit (12-byte)
 * random IV, returning a versioned `base64url` envelope (`v1.<iv>.<authTag>.<ciphertext>`).
 *
 * @param {string} password - Plaintext temporary password (`8..200` characters).
 * @param {string} [secret] - Optional secret override for key derivation (defaults to `env.supabaseServiceRoleKey`).
 * @returns {string} Versioned `v1` AES-256-GCM encrypted token.
 */
export const encryptTemporaryPassword = (password, secret) => {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw new TypeError('A valid temporary password is required.');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
};

/**
 * Decrypts and authenticates a `v1.<iv>.<authTag>.<ciphertext>` temporary password
 * token using AES-256-GCM. Throws if the envelope structure is malformed or if GCM
 * authentication tag verification fails.
 *
 * @param {string} encrypted - Versioned `v1` encrypted temporary password token.
 * @param {string} [secret] - Optional secret override for key derivation (defaults to `env.supabaseServiceRoleKey`).
 * @returns {string} Decrypted UTF-8 temporary password.
 */
export const decryptTemporaryPassword = (encrypted, secret) => {
  if (typeof encrypted !== 'string') throw new TypeError('Encrypted temporary password is required.');
  const [version, ivText, tagText, dataText, ...extra] = encrypted.split('.');
  if (version !== 'v1' || !ivText || !tagText || !dataText || extra.length
      || !/^[A-Za-z0-9_-]+$/.test(ivText) || !/^[A-Za-z0-9_-]+$/.test(tagText)
      || !/^[A-Za-z0-9_-]+$/.test(dataText)) {
    throw new TypeError('Encrypted temporary password is invalid.');
  }
  const decipher = createDecipheriv(CIPHER, encryptionKey(secret), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};

export default { generateTemporaryPassword, encryptTemporaryPassword, decryptTemporaryPassword };

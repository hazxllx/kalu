import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt } from 'node:crypto';
import env from '../config/env.js';
import { personnelPasswordSetupValidator } from '../validators/auth.validators.js';

const GROUPS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%^&*()-_=+[]{}:,.?',
];
const ALPHABET = GROUPS.join('');
const CIPHER = 'aes-256-gcm';
const TEMPORARY_PASSWORD_LENGTH = 9;

const encryptionKey = (secret = env.supabaseServiceRoleKey) => {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('Temporary credential encryption is not configured.');
  }
  return createHmac('sha256', secret).update('kalusagap:temporary-password:v1').digest();
};

export const generateTemporaryPassword = () => {
  const characters = GROUPS.map((group) => group[randomInt(group.length)]);
  while (characters.length < TEMPORARY_PASSWORD_LENGTH) characters.push(ALPHABET[randomInt(ALPHABET.length)]);
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

export const encryptTemporaryPassword = (password, secret) => {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw new TypeError('A valid temporary password is required.');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
};

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

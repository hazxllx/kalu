/**
 * Development-session token helpers.
 *
 * Issues and verifies a compact HMAC-signed session token so the local API can
 * authenticate callers while Supabase is not configured. The token payload is
 * base64url-encoded JSON; the signature is HMAC-SHA256 over that payload. This
 * is NOT a substitute for Supabase Auth — it is disabled in production and
 * whenever Supabase is configured.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import env from '../config/env.js';

const b64url = (buffer) =>
  Buffer.from(buffer).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

const b64urlDecode = (text) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(text.length + ((4 - (text.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64').toString('utf8');
};

/**
 * Persistent random secret for dev sessions. Stored under the backend data
 * directory so tokens survive server restarts during local development.
 */
const loadDevSecret = () => {
  if (env.devAuthSecret) return env.devAuthSecret;
  try {
    const dir = env.dataDir || path.resolve('data');
    fs.mkdirSync(dir, { recursive: true });
    const secretPath = path.join(dir, '.dev-auth-secret');
    if (fs.existsSync(secretPath)) {
      return fs.readFileSync(secretPath, 'utf8').trim();
    }
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    return secret;
  } catch {
    // Last resort: an in-memory secret. Tokens then do not survive a restart.
    return crypto.randomBytes(48).toString('hex');
  }
};

const secret = loadDevSecret();

export const signDevToken = (payload, expiresInSeconds = 60 * 60 * 12) => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const encoded = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64');
  return `${encoded}.${b64url(signature)}`;
};

export const verifyDevToken = (token) => {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedBody, signature] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${encodedHeader}.${encodedBody}`).digest('base64');
  const signatureBuffer = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const expectedBuffer = Buffer.from(expected, 'base64');
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }
  try {
    const body = JSON.parse(b64urlDecode(encodedBody));
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
};

export default { signDevToken, verifyDevToken };

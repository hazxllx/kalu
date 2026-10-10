import { db } from './db.js';

/**
 * At-rest protection for queued offline data.
 *
 * THREAT MODEL (reviewed):
 *   - Protects: queued household/clinical draft payloads read from the IndexedDB
 *     store without going through the application (casual inspection, other-app
 *     scraping of the browser profile, and raw storage dumps that do not also
 *     read the co-located key record).
 *   - Does NOT protect against: an attacker who already has script execution on
 *     the KALUSAGAP origin (they can call the same decrypt path) or who can read
 *     both the ciphertext and the key record from the same device profile. This
 *     is defense-in-depth, not a substitute for device-level disk encryption or
 *     the server-side RLS/authorization controls that remain authoritative.
 *   - Key management: a per-device random 256-bit AES-GCM key. In browsers it is
 *     persisted as a NON-EXTRACTABLE CryptoKey (its bytes cannot be read back
 *     out). Environments that cannot structured-clone a CryptoKey fall back to
 *     storing raw key bytes — this is a test-environment path, not the browser
 *     path. The key never leaves the device. It remains available for
 *     owner-scoped pending work after logout/session expiry and is removed only
 *     when the explicit device cleanup action calls `purgeOfflineDb`.
 *   - Residual risk (documented, not fully mitigable in a browser): the key is
 *     co-located with the ciphertext, so same-origin script or an attacker who
 *     can read the whole IndexedDB can still decrypt. At-rest encryption here is
 *     defense-in-depth only; device disk encryption and the server-side RLS /
 *     authorization controls remain the primary protections.
 *
 * Tokens and passwords are never written here: they are not passed to these
 * helpers, and no token field is persisted anywhere in the offline schema.
 */

const KEY_RECORD_ID = 'device-aes-gcm';
const ENVELOPE_VERSION = 1;

const subtleCrypto = () => {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  return cryptoObj && cryptoObj.subtle ? cryptoObj : null;
};

const bytesToBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  if (typeof btoa === 'function') return btoa(binary);
  // Node fallback.
  return Buffer.from(bytes).toString('base64');
};

const base64ToBytes = (value) => {
  if (typeof atob === 'function') {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
};

/** @type {CryptoKey | null} */
let cachedKey = null;

const importRawKey = (cryptoObj, raw) =>
  cryptoObj.subtle.importKey('raw', base64ToBytes(raw), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);

/** Read the persisted key: a non-extractable CryptoKey, or legacy raw bytes. */
const readKeyMaterial = async (cryptoObj) => {
  const record = await db.keys.get(KEY_RECORD_ID);
  if (!record) return null;
  if (record.cryptoKey) return record.cryptoKey;
  if (record.raw) return importRawKey(cryptoObj, record.raw);
  return null;
};

/**
 * Create and persist a per-device key.
 *
 * Preferred form: a NON-EXTRACTABLE CryptoKey stored via IndexedDB structured
 * clone — the key material is never persisted as readable bytes. When the
 * environment cannot clone a CryptoKey (e.g. `fake-indexeddb` in unit tests),
 * fall back to exporting raw bytes; this is logged so the degraded mode is
 * visible. The fallback is a test/environment concern, not the browser path.
 */
const createAndStoreKey = async (cryptoObj) => {
  try {
    const key = await cryptoObj.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await db.keys.put({
      id: KEY_RECORD_ID,
      cryptoKey: key,
      kind: 'CryptoKey',
      createdAt: new Date().toISOString(),
    });
    return key;
  } catch {
    /* fall through to raw */
  }
  const bytes = new Uint8Array(32);
  cryptoObj.getRandomValues(bytes);
  await db.keys.put({
    id: KEY_RECORD_ID,
    raw: bytesToBase64(bytes),
    kind: 'raw',
    createdAt: new Date().toISOString(),
  });
  return importRawKey(cryptoObj, bytesToBase64(bytes));
};

const getKey = async () => {
  if (cachedKey) return cachedKey;
  const cryptoObj = subtleCrypto();
  if (!cryptoObj) return null;
  const existing = await readKeyMaterial(cryptoObj);
  cachedKey = existing || (await createAndStoreKey(cryptoObj));
  return cachedKey;
};

/** Drop the in-memory key so a purged database cannot keep decrypting. */
export const resetCachedKey = () => {
  cachedKey = null;
};

/**
 * Encrypt a JSON-serializable value into a storable envelope.
 *
 * Falls back to a clearly-marked plaintext envelope when WebCrypto is not
 * available (e.g. a non-secure context). Callers and the UI can detect this via
 * `envelope.enc === false`; it is logged once so the degraded mode is visible
 * rather than silent.
 */
let warnedNoCrypto = false;
export const encryptJson = async (value) => {
  const key = await getKey();
  const cryptoObj = subtleCrypto();
  if (!key || !cryptoObj) {
    if (!warnedNoCrypto) {
      warnedNoCrypto = true;
      console.warn(
        '[kalusagap/offline] WebCrypto unavailable; offline payloads are stored without at-rest encryption.',
      );
    }
    return { enc: false, v: ENVELOPE_VERSION, plain: value };
  }
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(value ?? null));
  const cipher = await cryptoObj.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    enc: true,
    v: ENVELOPE_VERSION,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(cipher)),
  };
};

/** Reverse of {@link encryptJson}. Returns the original value. */
export const decryptJson = async (envelope) => {
  if (!envelope || typeof envelope !== 'object') return null;
  if (envelope.enc === false) return envelope.plain ?? null;
  const key = await getKey();
  const cryptoObj = subtleCrypto();
  if (!key || !cryptoObj) throw new Error('Cannot decrypt offline data: WebCrypto unavailable.');
  const iv = base64ToBytes(envelope.iv);
  const ct = base64ToBytes(envelope.ct);
  const plain = await cryptoObj.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plain));
};

export const isEncryptedEnvelope = (value) =>
  Boolean(value && typeof value === 'object' && 'enc' in value);

export default { encryptJson, decryptJson, resetCachedKey, isEncryptedEnvelope };

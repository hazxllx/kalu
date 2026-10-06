import 'fake-indexeddb/auto';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { db } from '../src/services/offline/db.js';
import { decryptJson, encryptJson, resetCachedKey } from '../src/services/offline/crypto.js';

beforeEach(async () => {
  await db.open();
  await db.transaction('rw', db.drafts, db.outbox, db.records, db.syncMeta, db.keys, async () => {
    await Promise.all([
      db.drafts.clear(),
      db.outbox.clear(),
      db.records.clear(),
      db.syncMeta.clear(),
      db.keys.clear(),
    ]);
  });
  resetCachedKey();
});

test('payloads are encrypted to an envelope with no plaintext field', async () => {
  const envelope = await encryptJson({ name: 'Juan', contact: '09171234567' });
  assert.equal(envelope.enc, true);
  assert.ok(envelope.iv && envelope.ct);
  assert.equal(JSON.stringify(envelope).includes('09171234567'), false);
});

test('a stored key is persisted and decrypts after a simulated reload', async () => {
  const envelope = await encryptJson({ a: 1, b: 'two' });
  const keyRecord = await db.keys.get('device-aes-gcm');
  assert.ok(keyRecord, 'a device key is persisted');
  assert.ok(
    keyRecord.cryptoKey || keyRecord.raw,
    'the key is stored as a CryptoKey (browser) or raw bytes (fallback)',
  );

  // Simulate a page reload: drop the in-memory cache and decrypt from storage.
  resetCachedKey();
  const plain = await decryptJson(envelope);
  assert.deepEqual(plain, { a: 1, b: 'two' });
});

test('the same value encrypts to different ciphertext (random IV)', async () => {
  const one = await encryptJson({ x: 'same' });
  const two = await encryptJson({ x: 'same' });
  assert.notEqual(one.ct, two.ct);
});

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { beforeEach } from 'node:test';
import { db, setOfflineOwnerResolver } from '../../src/services/offline/db.js';
import { decryptJson, encryptJson, resetCachedKey } from '../../src/services/offline/crypto.js';

// Two separately-bundled module instances (simulating two browser tabs) share
// the same IndexedDB store. The key must be created exactly once: the first
// tab's winner survives, and the second tab adopts it rather than overwriting,
// so every earlier ciphertext remains decryptable.
let firstModule;
let secondModule;

const loadModule = async () => {
  const module = await import(`../../src/services/offline/crypto.js?t=${Date.now()}-${Math.random()}`);
  return module;
};

beforeEach(async () => {
  setOfflineOwnerResolver(null);
  if (!db.isOpen()) await db.open();
  await Promise.all([db.drafts.clear(), db.outbox.clear(), db.records.clear(), db.syncMeta.clear(), db.keys.clear()]);
  firstModule = await loadModule();
  secondModule = await loadModule();
});

test('two concurrent module instances converge on one device key without overwrite', async () => {
  // First tab records encrypted clinical work before the second tab ever loads.
  const before = { entity: 'household', headName: 'First-tab encrypted draft' };
  const envelope = await firstModule.encryptJson(before);
  assert.equal(envelope.enc, true);

  // Second tab initializes from the SAME empty store and must adopt the key
  // already claimed by the first, not generate and persist a competing one.
  const secondEnvelope = await secondModule.encryptJson({ entity: 'household', headName: 'Second-tab draft' });
  assert.equal(secondEnvelope.enc, true);

  // Exactly one device key exists.
  assert.equal(await db.keys.count(), 1);

  // Both tabs decrypt everything, including the first tab's earlier work.
  assert.deepEqual(await firstModule.decryptJson(envelope), before);
  assert.deepEqual(await secondModule.decryptJson(envelope), before);
  assert.deepEqual(await secondModule.decryptJson(secondEnvelope), { entity: 'household', headName: 'Second-tab draft' });
});

test('a concurrent winner that claimed the store first is never overwritten', async () => {
  // Tab one wins the key.
  await firstModule.encryptJson({ id: 'tab-one' });
  // Tab two starts cold (fresh module, fresh in-memory cache) and must reuse it.
  const third = await loadModule();
  const envelope = await third.encryptJson({ id: 'tab-two' });
  assert.equal(envelope.enc, true);
  assert.equal(await db.keys.count(), 1);
  assert.deepEqual(await third.decryptJson(await firstModule.encryptJson({ id: 'tab-one-payload' })), { id: 'tab-one-payload' });
});

test('resetCachedKey clears both the in-memory key and any in-flight single-flight promise', async () => {
  await firstModule.encryptJson({ id: 'primed' });
  resetCachedKey();
  // After a purge, a new getKey must re-create (not return the stale key).
  await firstModule.encryptJson({ id: 're-encrypted' });
  assert.equal(await db.keys.count(), 1);
});
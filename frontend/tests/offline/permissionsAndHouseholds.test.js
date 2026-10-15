import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { db } from '../../src/services/offline/db.js';
import { resetCachedKey } from '../../src/services/offline/crypto.js';
import {
  PERMISSION_CACHE_TTL_MS,
  cacheVerifiedPermissions,
  invalidateVerifiedPermissions,
  readVerifiedPermissions,
} from '../../src/services/accessControl/permissionCache.js';
import { isPermissionMatrixRequest } from '../../src/services/accessControl/permissionRequestPolicy.js';
import {
  hasValidPermissionSnapshot,
  routePermissionsAllowed,
} from '../../src/services/accessControl/permissionAccess.js';
import { readPermissionMatrix } from '../../src/services/api/rolesPermissionsResponse.js';
import {
  createHouseholdOffline,
  listHouseholdsOffline,
} from '../../src/services/offline/householdOfflineService.js';
import { getDraft } from '../../src/services/offline/drafts.js';
import { getOperation, listOperations, requeueOperation, OUTBOX_STATUS } from '../../src/services/offline/outbox.js';
import { runSyncPass } from '../../src/services/offline/syncRunner.js';
import { MUTATION_TIER } from '../../src/services/offline/mutationPolicy.js';
import {
  createResidentOffline,
  listResidentsOffline,
  updateResidentOffline,
} from '../../src/services/offline/residentOfflineService.js';
import { cacheRecord } from '../../src/services/offline/records.js';

const OWNER = 'offline-workflow-user';
const matrix = { bhw: { 'households.view': true, 'households.create': true } };
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

const setOnline = (online) => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: online },
  });
};

const clearStores = async () => {
  resetCachedKey();
  if (!db.isOpen()) await db.open();
  await db.transaction('rw', db.drafts, db.outbox, db.records, db.syncMeta, db.keys, async () => {
    await Promise.all([
      db.drafts.clear(),
      db.outbox.clear(),
      db.records.clear(),
      db.syncMeta.clear(),
      db.keys.clear(),
    ]);
  });
};

beforeEach(async () => {
  setOnline(false);
  await clearStores();
});

afterEach(async () => {
  if (db.isOpen()) db.close();
  resetCachedKey();
  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  } else {
    delete globalThis.navigator;
  }
});

test('permission snapshots are encrypted, owner/role-bound, and survive a page reload', async () => {
  const snapshot = await cacheVerifiedPermissions({ userId: OWNER, role: 'bhw', matrix, now: 1000 });
  const stored = await db.syncMeta.get(`verifiedPermissions:${OWNER}`);
  assert.equal(stored.value.enc, true);
  assert.notDeepEqual(stored.value, matrix);

  db.close();
  await db.open();
  const restored = await readVerifiedPermissions({ userId: OWNER, role: 'bhw', now: 1001 });
  assert.deepEqual(restored.matrix, matrix);
  assert.equal(restored.verifiedAt, snapshot.verifiedAt);
  assert.equal(await readVerifiedPermissions({ userId: 'another-user', role: 'bhw', now: 1001 }), null);
});

test('missing, expired, future-dated, and role-mismatched permissions are not reusable', async () => {
  assert.equal(await readVerifiedPermissions({ userId: OWNER, role: 'bhw', now: 1000 }), null);
  await cacheVerifiedPermissions({ userId: OWNER, role: 'bhw', matrix, now: 1000 });
  assert.equal(
    await readVerifiedPermissions({ userId: OWNER, role: 'bhw', now: 1000 + PERMISSION_CACHE_TTL_MS }),
    null,
  );
  await cacheVerifiedPermissions({ userId: OWNER, role: 'bhw', matrix, now: 2000 });
  assert.equal(await readVerifiedPermissions({ userId: OWNER, role: 'health_supervisor', now: 2001 }), null);
  await cacheVerifiedPermissions({ userId: OWNER, role: 'bhw', matrix, now: 3000 });
  assert.equal(await readVerifiedPermissions({ userId: OWNER, role: 'bhw', now: 2999 }), null);
});

test('offline startup admits a cached permission and fails closed without a valid snapshot', () => {
  const cachedState = {
    userId: OWNER,
    role: 'bhw',
    status: 'ready',
    source: 'cache',
    expiresAt: 5000,
  };
  const can = (permission) => permission === 'households.view';
  assert.equal(hasValidPermissionSnapshot(cachedState, OWNER, 'bhw', 4999), true);
  assert.equal(
    routePermissionsAllowed({
      permissions: ['households.view'],
      state: cachedState,
      userId: OWNER,
      role: 'bhw',
      can,
      now: 4999,
    }),
    true,
  );
  assert.equal(
    routePermissionsAllowed({
      permissions: ['households.view'],
      state: { ...cachedState, expiresAt: 4999 },
      userId: OWNER,
      role: 'bhw',
      can,
      now: 4999,
    }),
    false,
  );
  assert.equal(
    routePermissionsAllowed({
      permissions: ['households.view'],
      state: { userId: OWNER, role: 'bhw', status: 'error' },
      userId: OWNER,
      role: 'bhw',
      can: () => true,
      now: 1000,
    }),
    false,
  );
});

test('rejected permissions are explicitly invalidated and malformed server matrices are rejected', async () => {
  await cacheVerifiedPermissions({ userId: OWNER, role: 'bhw', matrix });
  await invalidateVerifiedPermissions(OWNER);
  assert.equal(await readVerifiedPermissions({ userId: OWNER, role: 'bhw' }), null);
  assert.deepEqual(readPermissionMatrix({ matrix }), matrix);
  assert.throws(
    () => readPermissionMatrix({ matrix: { bhw: { 'households.create': 'yes' } } }),
    { code: 'INVALID_PERMISSION_MATRIX_RESPONSE' },
  );
});

test('service worker matches the permission read only; it does not treat writes as permission fetches', () => {
  assert.equal(
    isPermissionMatrixRequest({
      url: new URL('https://app.example.test/api/roles/permissions'),
      request: { method: 'GET' },
    }),
    true,
  );
  assert.equal(
    isPermissionMatrixRequest({
      url: new URL('https://app.example.test/api/roles/permissions'),
      request: { method: 'PATCH' },
    }),
    false,
  );
  assert.equal(
    isPermissionMatrixRequest({
      url: new URL('https://app.example.test/api/households'),
      request: { method: 'GET' },
    }),
    false,
  );
});

test('household draft survives offline reload and synchronizes only after a confirmed response', async () => {
  const result = await createHouseholdOffline({
    ownerId: OWNER,
    payload: {
      barangay: 'San Jose',
      headName: 'Ana Dela Cruz',
      purok: 'Purok 1',
      members: [{ name: 'Ana Dela Cruz' }],
    },
  });
  assert.equal(result.queued, true);
  assert.equal(result.source, 'local');
  assert.equal(result.household.syncStatus, 'Pending Sync');

  const savedDraft = await getDraft(result.localId);
  assert.equal(savedDraft.data.headName, 'Ana Dela Cruz');
  const offlineList = await listHouseholdsOffline({ ownerId: OWNER, params: { limit: 20 } });
  assert.equal(offlineList.rows[0].id, result.household.id);

  db.close();
  await db.open();
  assert.equal((await getDraft(result.localId)).data.headName, 'Ana Dela Cruz');
  const [queued] = await listOperations(OWNER);

  setOnline(true);
  const failed = await runSyncPass({
    ownerId: OWNER,
    workerId: 'network-failure',
    getHandler: () => Object.assign(async () => {
      throw new TypeError('Failed to fetch');
    }, { mutationType: MUTATION_TIER.SAFE_SYNC }),
  });
  assert.equal(failed.stoppedReason, 'network');
  assert.equal((await db.outbox.get(queued.opId)).status, OUTBOX_STATUS.FAILED);
  assert.equal((await getDraft(result.localId)).status, OUTBOX_STATUS.FAILED);

  await requeueOperation(queued.opId);
  const serverRecord = { id: 'HH-SYNC-001', headName: 'Ana Dela Cruz', revision: 1 };
  const synced = await runSyncPass({
    ownerId: OWNER,
    workerId: 'reconnected',
    getHandler: () => Object.assign(async (operation) => {
      const persisted = await getOperation(operation.opId);
      assert.equal(persisted.payload.headName, 'Ana Dela Cruz');
      return { serverId: serverRecord.id, serverRecord };
    }, { mutationType: MUTATION_TIER.SAFE_SYNC }),
  });
  assert.equal(synced.synced, 1);
  assert.equal((await db.outbox.get(queued.opId)).status, OUTBOX_STATUS.SYNCED);
  const reconciled = await getDraft(result.localId);
  assert.equal(reconciled.status, OUTBOX_STATUS.SYNCED);
  assert.equal(reconciled.data.id, 'HH-SYNC-001');
});

test('a sync response without a confirmed record leaves the operation failed for review', async () => {
  await createHouseholdOffline({
    ownerId: OWNER,
    payload: { barangay: 'San Jose', headName: 'Unconfirmed', members: [{}] },
  });
  const [operation] = await listOperations(OWNER);
  setOnline(true);
  const pass = await runSyncPass({
    ownerId: OWNER,
    workerId: 'empty-response',
    getHandler: () => Object.assign(async () => {
      throw Object.assign(new Error('The server did not confirm a durable household record.'), {
        code: 'malformed',
      });
    }, { mutationType: MUTATION_TIER.SAFE_SYNC }),
  });
  assert.equal(pass.failed, 1);
  assert.equal((await db.outbox.get(operation.opId)).status, OUTBOX_STATUS.FAILED);
  assert.notEqual((await db.outbox.get(operation.opId)).status, OUTBOX_STATUS.SYNCED);
});

test('resident create and permitted demographic edits persist locally without enabling account creation', async () => {
  const created = await createResidentOffline({
    ownerId: OWNER,
    payload: {
      resident: {
        firstName: 'Rosa',
        lastName: 'Santos',
        barangay: 'San Jose',
        createLoginAccount: false,
      },
    },
  });
  assert.equal(created.queued, true);
  assert.equal(created.resident.firstName, 'Rosa');

  await cacheRecord({
    entity: 'resident',
    remoteId: 'RES-42',
    ownerId: OWNER,
    data: { id: 'RES-42', firstName: 'Rosa', lastName: 'Santos', updatedAt: '2026-10-14T10:00:00.000Z' },
  });
  const updated = await updateResidentOffline({
    ownerId: OWNER,
    residentId: 'RES-42',
    baseRevision: '2026-10-14T10:00:00.000Z',
    payload: { resident: { cellphoneNo: '09171234567' } },
  });
  assert.equal(updated.queued, true);
  const directory = await listResidentsOffline({ ownerId: OWNER, params: { q: 'Rosa' } });
  assert.equal(directory.rows.length, 2);
  assert.ok(directory.rows.some((row) => row.syncStatus === 'Pending Sync'));

  await assert.rejects(
    createResidentOffline({
      ownerId: OWNER,
      payload: { resident: { firstName: 'Rosa', createLoginAccount: true, email: 'rosa@example.test' } },
    }),
    /requires an internet connection/,
  );
  await assert.rejects(
    updateResidentOffline({
      ownerId: OWNER,
      residentId: 'RES-42',
      baseRevision: '2026-10-14T10:00:00.000Z',
      payload: { resident: { verificationStatus: 'verified' } },
    }),
    /not approved for offline synchronization/,
  );
});

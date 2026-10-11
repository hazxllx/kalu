// Offline consultation (PHN/RHU "Treatment Consultation") vertical-slice tests.
//
// Classification under test: OFFLINE_DRAFT. A consultation is saved locally when
// offline, survives refresh/restart, is NEVER placed in the auto-sync outbox,
// and is submitted only by an explicit online action that cannot create a
// duplicate. These tests are the evidence for that classification.
//
// Run with:  node --test tests/offline/consultationDraft.test.js

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { db } from '../../src/services/offline/db.js';
import { resetCachedKey } from '../../src/services/offline/crypto.js';
import {
  saveConsultationOffline,
  listConsultationDrafts,
  restoreConsultationDraft,
  submitConsultationDraft,
  listConsultationsOffline,
  toServerPayload,
} from '../../src/services/offline/consultationOfflineService.js';
import { OfflineActionRequiredError } from '../../src/services/offline/mutationPolicy.js';

const OWNER = 'phn-user-1';

const resetAll = async () => {
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

beforeEach(resetAll);

const CONSULT = {
  residentId: 'RES-0001',
  consultationDate: '2026-10-11',
  chiefComplaint: 'Cough and fever',
  findings: 'Clear breath sounds',
  diagnosis: 'Viral URI',
  bloodPressure: '120/80',
  medications: [{ name: 'Paracetamol', qty: 10 }],
};

const online = () => true;
const offline = () => false;

const networkError = () => {
  const err = new Error('Failed to fetch');
  err.name = 'TypeError';
  return err;
};
const httpError = (status, message = 'nope') => {
  const err = new Error(message);
  err.status = status;
  return err;
};

const recordingCreate = (impl) => {
  const calls = [];
  const fn = async (data) => {
    calls.push(data);
    return impl ? impl(data, calls.length) : { consultation: { id: 'SUB-000001', ...data, status: 'completed' } };
  };
  fn.calls = calls;
  return fn;
};

test('offline save stores an OFFLINE_DRAFT and never calls the server or the outbox', async () => {
  const create = recordingCreate();
  const result = await saveConsultationOffline({ ownerId: OWNER, payload: CONSULT, create, online: offline });

  assert.equal(create.calls.length, 0, 'server must not be called offline');
  assert.equal(result.queued, true);
  assert.equal(result.source, 'local');
  assert.equal(result.record.status, 'Saved Offline');
  assert.ok(result.localId);

  // Draft persisted; outbox stays empty (no auto-sync for clinical drafts).
  const drafts = await listConsultationDrafts(OWNER);
  assert.equal(drafts.length, 1);
  assert.equal(await db.outbox.count(), 0, 'OFFLINE_DRAFT must not enqueue a sync operation');
});

test('a saved consultation draft survives a browser restart (close/reopen) with data intact', async () => {
  const create = recordingCreate();
  const { localId } = await saveConsultationOffline({ ownerId: OWNER, payload: CONSULT, create, online: offline });

  // Simulate an app restart: the in-memory handle is dropped and reopened. The
  // encrypted payload and the device key both live in IndexedDB, so the draft
  // and its data must come back.
  db.close();
  await db.open();

  const restored = await restoreConsultationDraft({ ownerId: OWNER, localId });
  assert.ok(restored, 'draft recovered after restart');
  assert.equal(restored.data.chiefComplaint, 'Cough and fever');
  assert.equal(restored.data.diagnosis, 'Viral URI');
  assert.equal(restored.data.residentId, 'RES-0001');
});

test('online save submits directly and returns the server-confirmed consultation', async () => {
  const create = recordingCreate((data) => ({ consultation: { id: 'SUB-000009', ...data, status: 'completed' } }));
  const result = await saveConsultationOffline({ ownerId: OWNER, payload: CONSULT, create, online });

  assert.equal(create.calls.length, 1);
  assert.equal(result.queued, false);
  assert.equal(result.source, 'server');
  assert.equal(result.record.id, 'SUB-000009');
  // Nothing left behind locally for a server-confirmed save.
  assert.equal((await listConsultationDrafts(OWNER)).length, 0);
  // Local-only markers are stripped before hitting the server.
  assert.ok(!('offline' in create.calls[0]));
});

test('a network failure while saving online falls back to a local draft (no data loss)', async () => {
  const create = recordingCreate(() => { throw networkError(); });
  const result = await saveConsultationOffline({ ownerId: OWNER, payload: CONSULT, create, online });
  assert.equal(result.queued, true);
  assert.equal(result.source, 'local');
  assert.equal((await listConsultationDrafts(OWNER)).length, 1);
});

test('a validation error while saving online is surfaced, not silently drafted', async () => {
  const create = recordingCreate(() => { throw httpError(422, 'Diagnosis is required.'); });
  await assert.rejects(
    () => saveConsultationOffline({ ownerId: OWNER, payload: CONSULT, create, online }),
    /Diagnosis is required\./,
  );
  // A server rejection is not stored as an offline draft.
  assert.equal((await listConsultationDrafts(OWNER)).length, 0);
});

test('submitting a draft online creates the consultation once and removes the local copy', async () => {
  const create = recordingCreate((data) => ({ consultation: { id: 'SUB-000100', ...data } }));
  const { localId } = await saveConsultationOffline({ ownerId: OWNER, payload: CONSULT, create, online: offline });

  const out = await submitConsultationDraft({ ownerId: OWNER, localId, create, online });
  assert.equal(out.submitted, true);
  assert.equal(out.record.id, 'SUB-000100');
  assert.equal(create.calls.length, 1);
  // The only local copy is gone, so it cannot be submitted again.
  assert.equal((await listConsultationDrafts(OWNER)).length, 0);
  // The confirmed record is cached for offline reads under the owner scope.
  const cached = await db.records.get([OWNER, 'consultation', 'SUB-000100']);
  assert.ok(cached);
});

test('submitting the same draft twice cannot create a duplicate', async () => {
  const create = recordingCreate((data) => ({ consultation: { id: 'SUB-000200', ...data } }));
  const { localId } = await saveConsultationOffline({ ownerId: OWNER, payload: CONSULT, create, online: offline });

  await submitConsultationDraft({ ownerId: OWNER, localId, create, online });
  // A second submit of the same draft finds nothing to submit.
  await assert.rejects(
    () => submitConsultationDraft({ ownerId: OWNER, localId, create, online }),
    /no longer available|already submitted/i,
  );
  assert.equal(create.calls.length, 1, 'the server create ran exactly once');
});

test('submitting while offline is refused and the draft is preserved', async () => {
  const create = recordingCreate();
  const { localId } = await saveConsultationOffline({ ownerId: OWNER, payload: CONSULT, create, online: offline });

  await assert.rejects(
    () => submitConsultationDraft({ ownerId: OWNER, localId, create, online: offline }),
    (err) => err instanceof OfflineActionRequiredError,
  );
  assert.equal(create.calls.length, 0);
  assert.equal((await listConsultationDrafts(OWNER)).length, 1, 'draft retained for later submission');
});

test('an authorization failure on submit preserves the recoverable draft', async () => {
  const create = recordingCreate(() => { throw httpError(403, 'permission changed'); });
  const { localId } = await saveConsultationOffline({ ownerId: OWNER, payload: CONSULT, create, online: offline });

  await assert.rejects(
    () => submitConsultationDraft({ ownerId: OWNER, localId, create, online }),
    /permission/i,
  );
  // Draft is kept (not lost) and is editable/submittable again.
  const drafts = await listConsultationDrafts(OWNER);
  assert.equal(drafts.length, 1);
  const restored = await restoreConsultationDraft({ ownerId: OWNER, localId });
  assert.equal(restored.data.diagnosis, 'Viral URI');
});

test('a conflict (409) on submit is surfaced and never auto-merged', async () => {
  const create = recordingCreate(() => { throw httpError(409, 'changed on server'); });
  const { localId } = await saveConsultationOffline({ ownerId: OWNER, payload: CONSULT, create, online: offline });
  await assert.rejects(
    () => submitConsultationDraft({ ownerId: OWNER, localId, create, online }),
    /changed on server/i,
  );
  // The draft is preserved verbatim for the clinician to reconcile manually.
  assert.equal((await listConsultationDrafts(OWNER)).length, 1);
});

test('consultation history merges cached rows with local drafts when offline', async () => {
  // Prime the cache with a server read while "online".
  const fetchList = async () => ({ consultations: [{ id: 'SUB-1', chiefComplaint: 'Old' }] });
  await listConsultationsOffline({ ownerId: OWNER, fetchList, online });

  // Save a draft, then go offline: history must show both.
  await saveConsultationOffline({ ownerId: OWNER, payload: CONSULT, create: recordingCreate(), online: offline });
  const offlineList = await listConsultationsOffline({ ownerId: OWNER, fetchList, online: offline });

  assert.ok(offlineList.some((row) => row.id === 'SUB-1'), 'cached server row present offline');
  assert.ok(offlineList.some((row) => row.syncStatus === 'Saved Offline'), 'local draft present offline');
});

test('drafts and reads are isolated to the owner on a shared device', async () => {
  await saveConsultationOffline({ ownerId: OWNER, payload: CONSULT, create: recordingCreate(), online: offline });
  await saveConsultationOffline({ ownerId: 'other-user', payload: { ...CONSULT, diagnosis: 'Other' }, create: recordingCreate(), online: offline });
  const mine = await listConsultationDrafts(OWNER);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].diagnosis, 'Viral URI');
});

test('toServerPayload strips local-only markers', () => {
  const clean = toServerPayload({ residentId: 'R', diagnosis: 'x', offline: true, syncStatus: 'Saved Offline', _offlineBarangay: 'B', localId: 'abc' });
  assert.deepEqual(clean, { residentId: 'R', diagnosis: 'x' });
});

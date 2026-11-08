import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { db, setOfflineOwnerResolver } from '../../src/services/offline/db.js';
import { resetCachedKey } from '../../src/services/offline/crypto.js';
import { getDraft } from '../../src/services/offline/drafts.js';
import { queueOfflineDraft } from '../../src/services/offline/queue.js';
import { resetSyncEngine } from '../../src/services/offline/syncEngine.js';
import { saveConsultationOffline, submitConsultationDraft } from '../../src/services/offline/consultationOfflineService.js';
import { create as createOnServer } from '../../../backend/src/services/consultations.service.js';
import fileRepository from '../../../backend/src/repositories/fileRepository.js';
import store from '../../../backend/src/repositories/fileStore.js';

// Actual frontend queue -> actual backend consultation service -> real file
// visit CRUD and completion. File persistence is disabled; every row is synthetic.
const persist = store.persist;
const originalFetch = globalThis.fetch;
let unexpectedRequests = 0;
const USER = { id: '11111111-1111-4111-8111-111111111111', name: 'Test Clinician', role: 'health_supervisor',
  municipalityId: 'm1', barangayId: 'b1', barangay: 'Test Barangay' };
const OTHER = { ...USER, id: '22222222-2222-4222-8222-222222222222' };
const DATA = { residentId: 'RES-TEST', consultationDate: '2026-11-05', consultationTime: '00:15',
  recordedAt: '2026-11-04T16:16:00.000Z', chiefComplaint: 'Test complaint',
  findings: 'Finding\nDiagnosis: embedded clinical text', diagnosis: 'Test assessment', treatmentGiven: 'Test treatment',
  adviceGiven: 'Test advice', remarks: 'Original clinical history', nextVisitDate: '2026-11-12', followUpRequired: 'Yes',
  referralRequired: 'No', bloodPressure: '120/80', pulseRate: '70',
  medications: [{ genericName: 'Test medicine', custom: true, instructions: 'Test instructions' }],
  consultationDetails: { physicalExam: { neurological: 'Additional clinical finding' }, allergies: 'Additional clinical history' } };
const supabase = { from() { const query = { select() { return query; }, eq() { return query; },
  maybeSingle: async () => ({ data: null, error: null }) }; return query; } };
const server = async (user, data, options) => {
  try {
    return { consultation: await createOnServer({ user, payload: data, idempotencyKey: options.headers['Idempotency-Key'],
      repo: fileRepository, supabase, classifyBp: async () => ({ code: 'normal', label: 'Normal' }), persistRisk: async () => {} }) };
  } catch (error) { throw Object.assign(error, { status: error.statusCode }); }
};

beforeEach(async () => {
  unexpectedRequests = 0;
  globalThis.fetch = async () => { unexpectedRequests += 1; throw new Error('Unexpected network request in isolated consultation test'); };
  resetSyncEngine(); setOfflineOwnerResolver(null); resetCachedKey();
  await db.open();
  await Promise.all([db.outbox.clear(), db.drafts.clear(), db.records.clear(), db.syncMeta.clear(), db.keys.clear()]);
  store.persist = async () => {}; store.chain = Promise.resolve();
  store.data = { counters: { residents: 0, submissions: 0, referrals: 0 }, visits: [], referrals: [], healthAuditLogs: [],
    residents: [{ id: DATA.residentId, firstName: 'Test', lastName: 'Resident', verificationStatus: 'approved',
      barangay: USER.barangay, barangayId: USER.barangayId, municipalityId: USER.municipalityId,
      authUserId: '33333333-3333-4333-8333-333333333333' }] };
});
afterEach(() => {
  globalThis.fetch = originalFetch; store.persist = persist; store.data = null; resetSyncEngine(); setOfflineOwnerResolver(null);
  assert.equal(unexpectedRequests, 0);
});

test('lost real backend create response replays ONE visit/follow-up and preserves clinical data/time', async () => {
  const calls = [];
  const create = async (data, options) => {
    calls.push(data.clientOperationKey);
    const result = await server(USER, data, options);
    if (calls.length === 1) throw new TypeError('Failed to fetch');
    return result;
  };
  const lost = await saveConsultationOffline({ ownerId: USER.id, payload: DATA, create, online: () => true });
  assert.equal(lost.source, 'local');
  assert.equal(store.data.visits.length, 1);
  assert.equal(store.data.followUps.length, 1);
  db.close(); await db.open();
  const retry = await submitConsultationDraft({ ownerId: USER.id, localId: lost.localId, create, online: () => true });
  assert.equal(retry.source, 'server');
  assert.equal(new Set(calls).size, 1);
  assert.equal(store.data.visits.length, 1);
  assert.equal(store.data.counters.submissions, 1);
  assert.equal(store.data.followUps.length, 1);
  assert.equal(store.data.notifications.length, 2);
  assert.equal(retry.record.consultationDate, DATA.consultationDate);
  assert.equal(retry.record.consultationTime, DATA.consultationTime);
  assert.equal(retry.record.recordedAt, DATA.recordedAt);
  assert.equal(retry.record.resident.id, DATA.residentId);
  assert.equal(retry.record.findings, DATA.findings);
  assert.deepEqual(retry.record.consultationDetails.physicalExam, DATA.consultationDetails.physicalExam);
  assert.equal(retry.record.medications[0].instructions, DATA.medications[0].instructions);
  assert.equal((await getDraft(lost.localId, USER.id)).status, 'synced');
});

test('an actual backend scope rejection retains the clinical queue and never starts side effects', async () => {
  const queued = await saveConsultationOffline({ ownerId: USER.id, payload: DATA, create: async () => null, online: () => false });
  store.data.residents[0].municipalityId = 'm2';
  await assert.rejects(submitConsultationDraft({ ownerId: USER.id, localId: queued.localId,
    create: (data, options) => server(USER, data, options), online: () => true }), { status: 404 });
  assert.equal(store.data.visits.length, 0);
  assert.equal(store.data.notifications, undefined);
  const draft = await getDraft(queued.localId, USER.id);
  assert.equal(draft.status, 'failed');
  assert.equal(draft.data.diagnosis, DATA.diagnosis);
  assert.deepEqual(draft.data.consultationDetails, DATA.consultationDetails);
});

test('a second device/user cannot appropriate an original backend consultation UUID', async () => {
  const first = await saveConsultationOffline({ ownerId: USER.id, payload: DATA,
    create: (data, options) => server(USER, data, options), online: () => true });
  const original = structuredClone(store.data.visits[0]);
  // Simulate a different device with no locally cached operation.
  await Promise.all([db.drafts.clear(), db.outbox.clear(), db.records.clear()]);
  await assert.rejects(saveConsultationOffline({ ownerId: OTHER.id,
    payload: { ...DATA, clientOperationKey: first.record.clientOperationKey },
    create: (data, options) => server(OTHER, data, options), online: () => true }), { status: 409 });
  assert.equal(store.data.visits.length, 1);
  assert.deepEqual(store.data.visits[0], original);
  assert.equal(store.data.followUps.length, 1);
  assert.equal(store.data.notifications.length, 2);
  const draft = await getDraft((await db.drafts.toArray())[0].localId, OTHER.id);
  assert.equal(draft.status, 'conflict');
  assert.equal(draft.data.remarks, DATA.remarks);
});

test('legacy response-loss ambiguity conflicts without duplicating or guessing an unkeyed visit', async () => {
  const oldKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await server(USER, { ...DATA, clientOperationKey: oldKey }, { headers: { 'Idempotency-Key': oldKey } });
  // Model a pre-upgrade visit: it had no durable client operation identity.
  delete store.data.visits[0].clientOperationKey;
  delete store.data.visits[0].clientOperationPayloadHash;
  delete store.data.visits[0].consultationEffectsCompletedAt;
  const original = structuredClone(store.data.visits[0]);
  const legacy = await queueOfflineDraft({ entity: 'consultationDraft', ownerId: USER.id, data: DATA });
  await assert.rejects(submitConsultationDraft({ ownerId: USER.id, localId: legacy.localId,
    create: (data, options) => server(USER, data, options), online: () => true }), { status: 409 });
  assert.equal(store.data.visits.length, 1);
  assert.deepEqual(store.data.visits[0], original);
  assert.equal(store.data.followUps.length, 1);
  assert.equal(store.data.notifications.length, 2);
  const draft = await getDraft(legacy.localId, USER.id);
  assert.equal(draft.status, 'conflict');
  assert.equal(draft.data.clientOperationKey, legacy.localId);
  assert.equal(draft.data.recordedAt, DATA.recordedAt);
  assert.equal(draft.data.findings, DATA.findings);
  assert.deepEqual(draft.data.consultationDetails, DATA.consultationDetails);
});

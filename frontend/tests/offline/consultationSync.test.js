import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { db, setOfflineOwnerResolver } from '../../src/services/offline/db.js';
import { resetCachedKey } from '../../src/services/offline/crypto.js';
import { getOperation, requeueOperation } from '../../src/services/offline/outbox.js';
import { getDraft } from '../../src/services/offline/drafts.js';
import { queueOfflineDraft } from '../../src/services/offline/queue.js';
import { runSyncPass } from '../../src/services/offline/syncRunner.js';
import { configureSyncEngine, startSyncEngine, resetSyncEngine, refreshSyncState, subscribe, getSnapshot } from '../../src/services/offline/syncEngine.js';
import { MUTATION_TIER, requireOnlineForMutation, OfflineActionRequiredError } from '../../src/services/offline/mutationPolicy.js';
import {
  saveConsultationOffline, submitConsultationDraft, adoptLegacyConsultationDrafts,
  createConsultationSyncHandler, listConsultationDrafts, listConsultationsOffline,
  restoreConsultationDraft, deleteConsultationDraft, listConsultationResidentsOffline,
} from '../../src/services/offline/consultationOfflineService.js';

const OWNER = 'test-consultation-owner';
const OTHER = 'test-other-owner';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATA = { residentId: 'RES-TEST', consultationDate: '2026-11-05', consultationTime: '09:42',
  recordedAt: '2026-11-05T01:43:12.000Z', chiefComplaint: 'Test complaint',
  findings: 'Finding\nDiagnosis: text inside finding', diagnosis: 'Test diagnosis',
  treatmentGiven: 'Treatment\nMedication: text inside treatment', adviceGiven: 'Advice\nNext visit: text inside advice',
  remarks: 'Original retained clinical history', nextVisitDate: '2026-11-12', followUpRequired: 'Yes', referralRequired: 'Yes',
  bloodPressure: '120/80', pulseRate: '70', medications: [{ genericName: 'Test medicine', instructions: 'Test instruction' }] };
const offline = () => false;
const online = () => true;
const recordFor = (data, id = 'SUB-TEST') => ({ ...data, id, resident: { id: data.residentId, name: 'Test Resident' },
  createdAt: '2026-11-06T02:00:00.000Z', updatedAt: '2026-11-06T02:00:00.000Z', consultationEffectsCompletedAt: '2026-11-06T02:00:00.000Z', status: 'completed' });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

beforeEach(async () => {
  resetSyncEngine();
  setOfflineOwnerResolver(null);
  resetCachedKey();
  await db.open();
  await Promise.all([db.drafts.clear(), db.outbox.clear(), db.records.clear(), db.syncMeta.clear(), db.keys.clear()]);
});
afterEach(() => {
  resetSyncEngine();
  setOfflineOwnerResolver(null);
  if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator;
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor); else delete globalThis.window;
});

test('the stable UUID and encrypted write-ahead clinical payload exist BEFORE first online HTTP', async () => {
  let calls = 0;
  const create = async (data, options) => {
    calls += 1;
    assert.match(data.clientOperationKey, UUID);
    assert.equal(options.headers['Idempotency-Key'], data.clientOperationKey);
    assert.equal(options.ownerId, OWNER);
    assert.equal(options.offlineMutationType, MUTATION_TIER.SAFE_SYNC);
    const raw = await db.outbox.get(data.clientOperationKey);
    assert.equal(raw.status, 'syncing');
    assert.equal(raw.payload.enc, true);
    assert.ok(raw.consultationAttemptedAt);
    assert.ok(!JSON.stringify(raw).includes(DATA.remarks));
    const draft = await getDraft(raw.localRecordId, OWNER);
    assert.equal(draft.data.recordedAt, DATA.recordedAt);
    assert.equal(draft.data.findings, DATA.findings);
    return { consultation: recordFor(data) };
  };
  const result = await saveConsultationOffline({ ownerId: OWNER, payload: DATA, create, online });
  assert.equal(calls, 1);
  assert.equal(result.source, 'server');
  assert.equal(result.queued, false);
  const raw = await db.outbox.get(result.record.clientOperationKey);
  assert.equal(raw.status, 'synced');
  assert.equal(raw.serverRecord.enc, true);
  assert.ok(!JSON.stringify(raw.serverRecord).includes(DATA.diagnosis));
});

test('response loss and concurrent replay reuse ONE UUID, clinical payload and server visit', async () => {
  const visits = new Map();
  const followups = new Set();
  const calls = [];
  const create = async (data, options) => {
    calls.push({ data, options });
    if (!visits.has(data.clientOperationKey)) {
      visits.set(data.clientOperationKey, recordFor(data));
      followups.add(`${data.clientOperationKey}:${data.nextVisitDate}`);
    }
    if (calls.length === 1) throw new TypeError('Failed to fetch');
    return { consultation: visits.get(data.clientOperationKey) };
  };
  const lost = await saveConsultationOffline({ ownerId: OWNER, payload: DATA, create, online });
  assert.equal(lost.source, 'local');
  assert.equal(lost.queued, true);
  assert.equal((await getDraft(lost.localId, OWNER)).status, 'failed');
  db.close(); await db.open();
  const replay = await Promise.all(Array.from({ length: 3 }, () =>
    submitConsultationDraft({ ownerId: OWNER, localId: lost.localId, create, online })));
  assert.equal(visits.size, 1);
  assert.equal(followups.size, 1);
  assert.equal(new Set(calls.map((call) => call.options.headers['Idempotency-Key'])).size, 1);
  assert.deepEqual(calls[0].data, calls[1].data);
  assert.ok(replay.some((row) => row.source === 'server'));
  assert.equal((await listConsultationDrafts(OWNER)).length, 0);
});

test('a browser reconnect automatically dispatches the consultation handler without manual submission', { timeout: 8000 }, async () => {
  const browser = new EventTarget();
  const connection = { onLine: false };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: connection });
  const queued = await saveConsultationOffline({ ownerId: OWNER, payload: DATA, create: async () => { throw new Error('Not used'); }, online: offline });
  let calls = 0;
  const handler = createConsultationSyncHandler(async (data) => { calls += 1; return { consultation: recordFor(data) }; });
  configureSyncEngine({ getOwnerId: () => OWNER, getHandler: (entity, type) => entity === 'consultation' && type === 'create' ? handler : null });
  startSyncEngine();
  await refreshSyncState();
  const synced = deferred();
  const unsubscribe = subscribe(() => { if (getSnapshot().lastResult?.synced === 1 && !getSnapshot().syncing) synced.resolve(); });
  connection.onLine = true;
  browser.dispatchEvent(new Event('online'));
  await synced.promise;
  unsubscribe();
  assert.equal(calls, 1);
  assert.equal((await getDraft(queued.localId, OWNER)).status, 'synced');
});

test('legacy consultation-only drafts are adopted exactly once with stable keys; RHU triage remains manual', async () => {
  const legacy = await queueOfflineDraft({ ownerId: OWNER, entity: 'consultationDraft', data: DATA });
  const triage = await queueOfflineDraft({ ownerId: OWNER, entity: 'rhuTriage', data: { triageNote: 'Separate manual action' } });
  const counts = await Promise.all(Array.from({ length: 4 }, () => adoptLegacyConsultationDrafts(OWNER)));
  assert.equal(counts.reduce((sum, count) => sum + count, 0), 1);
  assert.equal(await db.outbox.count(), 1);
  const op = (await db.outbox.toArray())[0];
  assert.equal(op.entity, 'consultation');
  assert.equal(op.idempotencyKey, legacy.localId);
  assert.equal(op.mutationType, MUTATION_TIER.SAFE_SYNC);
  assert.equal((await listConsultationDrafts(OWNER)).find((draft) => draft.localId === legacy.localId).canDiscard, false);
  await assert.rejects(deleteConsultationDraft({ ownerId: OWNER, localId: legacy.localId }), { status: 409 });
  assert.equal((await getDraft(legacy.localId, OWNER)).data.recordedAt, DATA.recordedAt);
  db.close(); await db.open();
  assert.equal(await adoptLegacyConsultationDrafts(OWNER), 0);
  const handler = createConsultationSyncHandler(async (data) => ({ consultation: recordFor(data) }));
  const result = await runSyncPass({ ownerId: OWNER, getHandler: (entity) => entity === 'consultation' ? handler : null });
  assert.equal(result.synced, 1);
  assert.equal((await getDraft(triage.localId, OWNER)).status, 'offline_draft');
  assert.equal((await getDraft(legacy.localId, OWNER)).data.clientOperationKey, legacy.localId);
});

test('adoption retains the legacy recording instant when no client timestamp was stored', async () => {
  const { recordedAt, ...oldData } = DATA;
  const legacy = await queueOfflineDraft({ ownerId: OWNER, entity: 'consultationDraft', data: oldData });
  const createdAt = Date.parse('2026-10-31T03:00:00Z');
  await db.drafts.update(legacy.localId, { createdAt });
  await adoptLegacyConsultationDrafts(OWNER);
  assert.equal((await getDraft(legacy.localId, OWNER)).data.recordedAt, '2026-10-31T03:00:00.000Z');
});

test('null, malformed or mismatched 2xx responses never mark clinical work synced', async () => {
  const cases = [
    () => null, () => [], () => ({ consultation: {} }), () => ({ consultation: { id: 'SUB-ONLY-ID' } }),
    (data) => ({ consultation: { ...recordFor(data), resident: { id: 'RES-OTHER' } } }),
    (data) => ({ consultation: { ...recordFor(data), clientOperationKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }),
    (data) => ({ consultation: { ...recordFor(data), recordedAt: 'invalid' } }),
    (data) => ({ consultation: { ...recordFor(data), consultationTime: '10:30' } }),
    (data) => ({ consultation: { ...recordFor(data), createdAt: null } }),
    (data) => ({ consultation: { ...recordFor(data), status: 'made-up' } }),
    (data) => ({ consultation: { ...recordFor(data), consultationEffectsCompletedAt: null } }),
    (data) => ({ consultation: { ...recordFor(data), diagnosis: 'Unconfirmed clinical change' } }),
  ];
  for (const response of cases) {
    const queued = await saveConsultationOffline({ ownerId: OWNER, payload: DATA, create: async () => null, online: offline });
    await assert.rejects(submitConsultationDraft({ ownerId: OWNER, localId: queued.localId, create: async (data) => response(data), online }), { code: 'malformed' });
    const draft = await getDraft(queued.localId, OWNER);
    const op = await getOperation(draft.operationId, OWNER);
    assert.equal(draft.status, 'failed');
    assert.equal(op.status, 'failed');
    assert.equal(op.lastError.code, 'malformed');
    assert.equal(op.payload.remarks, DATA.remarks);
    assert.equal(draft.data.findings, DATA.findings);
    assert.equal(draft.serverId, null);
  }
  assert.equal(await db.records.count(), 0);
});

test('failed payloads cannot be overwritten, silently discarded, or retried as another user', async () => {
  const result = await saveConsultationOffline({ ownerId: OWNER, payload: DATA, create: async () => { throw new TypeError('Failed to fetch'); }, online });
  const key = result.record.clientOperationKey;
  await requeueOperation(key, OWNER);
  await assert.rejects(deleteConsultationDraft({ ownerId: OWNER, localId: result.localId }), { status: 409 });
  await assert.rejects(saveConsultationOffline({ ownerId: OWNER, localId: result.localId,
    payload: { ...DATA, diagnosis: 'Changed diagnosis' }, create: async () => null, online: offline }), { status: 409 });
  const original = await db.outbox.get(key);
  setOfflineOwnerResolver(() => OTHER);
  assert.equal(await restoreConsultationDraft({ ownerId: OTHER, localId: result.localId }), null);
  await assert.rejects(saveConsultationOffline({ ownerId: OTHER, payload: { ...DATA, clientOperationKey: key }, create: async () => null, online }), { status: 409 });
  assert.deepEqual(await db.outbox.get(key), original);
});

test('HTTP failures preserve original clinical data and gates; conflict is never auto-merged', async () => {
  for (const status of [401, 403, 404, 409, 422, 500]) {
    const queued = await saveConsultationOffline({ ownerId: OWNER, payload: DATA, create: async () => null, online: offline });
    const create = async () => { throw Object.assign(new Error('Test server rejection'), { status }); };
    const submit = () => submitConsultationDraft({ ownerId: OWNER, localId: queued.localId, create, online });
    if (status === 500) assert.equal((await submit()).source, 'local');
    else await assert.rejects(submit(), { status });
    const draft = await getDraft(queued.localId, OWNER);
    assert.equal(draft.status, status === 409 ? 'conflict' : 'failed');
    assert.equal(draft.data.remarks, DATA.remarks);
    assert.equal(draft.data.medications[0].instructions, DATA.medications[0].instructions);
  }
  assert.equal(await db.records.count(), 0);
});

test('owner switch during HTTP cannot apply old response; original user resumes the same UUID', async () => {
  let currentOwner = OWNER;
  setOfflineOwnerResolver(() => currentOwner);
  const queued = await saveConsultationOffline({ ownerId: OWNER, payload: DATA, create: async () => null, online: offline });
  const started = deferred(); const release = deferred();
  const handler = createConsultationSyncHandler(async (data) => { started.resolve(); await release.promise; return { consultation: recordFor(data) }; });
  const work = runSyncPass({ ownerId: OWNER, getOwnerId: () => currentOwner, getHandler: () => handler });
  await started.promise;
  currentOwner = OTHER;
  release.resolve();
  assert.equal((await work).stoppedReason, 'owner-changed');
  assert.equal(await db.records.count(), 0);
  assert.notEqual((await db.outbox.get(queued.record.clientOperationKey)).status, 'synced');
  currentOwner = OWNER;
  const resumed = await runSyncPass({ ownerId: OWNER, getOwnerId: () => currentOwner,
    getHandler: () => createConsultationSyncHandler(async (data) => ({ consultation: recordFor(data) })) });
  assert.equal(resumed.synced, 1);
  assert.equal((await getDraft(queued.localId, OWNER)).data.clientOperationKey, queued.record.clientOperationKey);
});

test('history does not infer confirmation from a visible row after response loss', async () => {
  const queued = await saveConsultationOffline({ ownerId: OWNER, payload: DATA, create: async () => null, online: offline });
  const rows = await listConsultationsOffline({ ownerId: OWNER, online,
    fetchList: async () => ({ rows: [recordFor({ ...DATA, clientOperationKey: queued.record.clientOperationKey })] }) });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].offline, true);
  assert.equal((await getDraft(queued.localId, OWNER)).status, 'pending');
});

test('verified resident selector is owner-cached offline; only explicit SAFE_SYNC creates bypass online-only', async () => {
  const residents = [{ id: DATA.residentId, name: 'Test Verified Resident', verificationStatus: 'approved' }];
  await listConsultationResidentsOffline({ ownerId: OWNER, fetchList: async () => ({ rows: residents }), online });
  assert.deepEqual(await listConsultationResidentsOffline({ ownerId: OWNER, fetchList: async () => null, online: offline }), residents);
  assert.deepEqual(await listConsultationResidentsOffline({ ownerId: OTHER, fetchList: async () => null, online: offline }), []);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  assert.throws(() => requireOnlineForMutation(), OfflineActionRequiredError);
  assert.doesNotThrow(() => requireOnlineForMutation(MUTATION_TIER.SAFE_SYNC));
});

test('page labels pending/error notifications honestly and reviews without a new create', async () => {
  const page = await readFile(new URL('../../src/features/consultations/pages/TreatmentConsultation.jsx', import.meta.url), 'utf8');
  assert.ok(page.includes('Awaiting server confirmation'));
  assert.ok(page.includes('Pending consultations sync automatically on reconnect'));
  assert.ok(page.includes('toast.kind === "success" ? <CheckCircle2'));
  assert.ok(page.includes('showToast(submitErrorMessage(err), "error")'));
  assert.ok(page.includes('if (busy || reviewLocalId) return'));
  assert.ok(page.includes('<fieldset disabled={Boolean(reviewLocalId)}>'));
  assert.ok(page.includes('const guard = captureOwnerGuard(ownerId)'));
  assert.ok(page.includes('if (!guard()) return'));
  assert.ok(page.includes('setSelectedResident(null)'));
  assert.ok(page.includes('setFormData(emptyForm())'));
  assert.ok(!page.includes('They are never submitted automatically'));
});

test('consultations API forwards owner, idempotency headers and abort signal on all methods', async () => {
  const calls = [];
  const transport = Object.fromEntries(['get', 'post', 'put'].map((method) => [method, (...args) => {
    calls.push({ method, args }); return Promise.resolve({});
  }]));
  globalThis.__consultationApiTestTransport = transport;
  try {
    const source = (await readFile(new URL('../../src/services/api/consultationsApi.js', import.meta.url), 'utf8'))
      .replace("import { api } from './apiClient.js';", 'const api = globalThis.__consultationApiTestTransport;');
    const { consultationsApi } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const options = { ownerId: OWNER, headers: { 'Idempotency-Key': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, signal: new AbortController().signal };
    const params = { limit: 100, offset: 100, serviceId: 'test-service-id' };
    await consultationsApi.list(params, options);
    await consultationsApi.get('SUB-TEST', options);
    await consultationsApi.create(DATA, options);
    await consultationsApi.update('SUB-TEST', DATA, options);
    assert.equal(calls.length, 4);
    for (const call of calls) {
      const forwarded = call.args.at(-1);
      assert.equal(forwarded.ownerId, OWNER);
      assert.equal(forwarded.headers, options.headers);
      assert.equal(forwarded.signal, options.signal);
    }
    assert.deepEqual(calls[0].args[1].params, params);
    assert.equal(calls[2].args[1], DATA);
    assert.equal(calls[3].args[1], DATA);
  } finally { delete globalThis.__consultationApiTestTransport; }
});

test('new consultation date defaults use the local day and do not invent a consultation time', async () => {
  const page = await readFile(new URL('../../src/features/consultations/pages/TreatmentConsultation.jsx', import.meta.url), 'utf8');
  const source = page.match(/const emptyForm = \(now = new Date\(\)\) => \(\{[\s\S]*?\}\);/)?.[0];
  assert.ok(source);
  const emptyForm = new Function(`${source}; return emptyForm;`)();
  const localClock = { getFullYear: () => 2026, getMonth: () => 10, getDate: () => 6 };
  const form = emptyForm(localClock);
  assert.equal(form.consultationDate, '2026-11-06');
  assert.equal(form.consultationTime, '');
  assert.ok(page.includes('consultationDate: record.consultationDate || ""'));
});

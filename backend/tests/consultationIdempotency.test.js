import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { create, update, get, list, validateCreateReplay, toVisit, fromVisit, syncConsultationFollowUp } from '../src/services/consultations.service.js';
import fileRepository from '../src/repositories/fileRepository.js';
import store from '../src/repositories/fileStore.js';
import ApiError from '../src/utils/apiError.js';

// Real file-driver visit CRUD, with persistence disabled. No disk or remote DB.
const originalPersist = store.persist;
const USER = { id: '11111111-1111-4111-8111-111111111111', role: 'health_supervisor', name: 'Test Clinician',
  barangay: 'Test Barangay', barangayId: 'b1', municipalityId: 'm1' };
const OTHER = { ...USER, id: '22222222-2222-4222-8222-222222222222' };
const KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SERVICE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PAYLOAD = {
  clientOperationKey: KEY, residentId: 'RES-TEST-1', consultationDate: '2026-11-05', consultationTime: '09:42',
  recordedAt: '2026-11-05T01:43:12.000Z', chiefComplaint: 'Test complaint',
  findings: 'First finding\nDiagnosis: text inside a finding', diagnosis: 'Test assessment',
  treatmentGiven: 'Treatment\nMedication: text inside treatment', medicationPrescribed: 'Legacy medicine text',
  medications: [{ genericName: 'Test medicine', strength: '1 mg', instructions: 'Test instruction' }],
  adviceGiven: 'Advice\nNext visit: text inside advice', remarks: 'Original clinical history',
  followUpRequired: 'Yes', nextVisitDate: '2026-11-12', referralRequired: 'Yes',
  bloodPressure: '120/80', pulseRate: '70', respiratoryRate: '18', temperature: '36.7',
  height: '170', weight: '65', oxygenSaturation: '99', serviceId: SERVICE, serviceName: 'Untrusted service label',
};

const supabaseFor = ({ active = true, municipality = 'm1', barangayId = null } = {}) => ({
  from(table) {
    const filters = {};
    const query = {
      select() { return query; },
      eq(key, value) { filters[key] = value; return query; },
      maybeSingle() {
        return Promise.resolve({ data: table === 'health_services' && filters.id === SERVICE
          ? { id: SERVICE, name: 'Authoritative service name', active, municipality_id: municipality, barangay_id: barangayId }
          : null, error: null });
      },
    };
    return query;
  },
});

beforeEach(() => {
  store.persist = async () => {};
  store.chain = Promise.resolve();
  store.data = { counters: { residents: 1, submissions: 0, referrals: 0 }, visits: [], referrals: [],
    residents: [{ id: PAYLOAD.residentId, firstName: 'Test', lastName: 'Resident', barangay: USER.barangay,
      barangayId: 'b1', municipalityId: 'm1', verificationStatus: 'approved',
      authUserId: '33333333-3333-4333-8333-333333333333' }], healthAuditLogs: [] };
});
afterEach(() => { store.persist = originalPersist; store.data = null; });

const input = (overrides = {}) => ({ user: USER, payload: PAYLOAD, repo: fileRepository,
  supabase: supabaseFor(), classifyBp: async () => ({ code: 'normal', label: 'Normal' }), persistRisk: async () => {}, ...overrides });
const edit = (overrides = {}) => ({ ...input(), id: store.data.visits[0].id,
  syncFollowUp: async () => {}, notify: async () => {}, ...overrides });

test('response loss replay creates ONE visit, follow-up and non-clinical resident notification', async () => {
  const first = await create(input()); // Simulate the response being lost after commit.
  const retry = await create(input());
  assert.equal(retry.id, first.id);
  assert.equal(store.data.visits.length, 1);
  assert.equal(store.data.counters.submissions, 1, 'sequential dedup precedes identifier allocation');
  assert.equal(store.data.followUps.length, 1);
  assert.equal(store.data.followUps[0].consultation_id, first.id);
  assert.equal(store.data.followUps[0].resident_id, PAYLOAD.residentId);
  assert.equal(store.data.followUps[0].created_by, USER.id);
  assert.equal(store.data.followUps[0].status, 'Pending');
  assert.equal(store.data.followUps[0].requires_resident_response, true);
  const notifications = store.data.notifications;
  assert.equal(notifications.filter((row) => row.related_type === 'consultation').length, 1);
  assert.equal(notifications.filter((row) => row.related_type === 'follow_ups').length, 1);
  assert.ok(notifications.every((row) => row.recipient_id === store.data.residents[0].authUserId));
  assert.ok(notifications.every((row) => !row.message.includes(PAYLOAD.diagnosis) && !row.message.includes(PAYLOAD.findings)));
  assert.ok(notifications.find((row) => row.related_type === 'consultation').message.includes(PAYLOAD.consultationDate));
});

test('concurrent retries are resolved by the visit uniqueness guard, including initial follow-ups', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => create(input())));
  assert.equal(new Set(results.map((row) => row.id)).size, 1);
  assert.equal(store.data.visits.length, 1);
  assert.equal(store.data.followUps.length, 1);
  assert.equal(store.data.notifications.length, 2);
  assert.equal(store.data.healthAuditLogs.length, 2);
});

test('an original operation cannot be replayed by another user or for another resident/payload', async () => {
  await create(input());
  for (const overrides of [
    { user: OTHER },
    { payload: { ...PAYLOAD, residentId: 'RES-OTHER' } },
    { payload: { ...PAYLOAD, diagnosis: 'Different clinical information' } },
    { payload: { ...PAYLOAD, consultationTime: '10:30' } },
  ]) await assert.rejects(create(input(overrides)), { statusCode: 409 });
  assert.equal(store.data.visits.length, 1);
  assert.equal(store.data.followUps.length, 1);
  assert.equal(store.data.visits[0].consultationDetails.diagnosis, PAYLOAD.diagnosis);
});

test('an edit by another scoped staff member retains the original operation owner and recording time', async () => {
  const first = await create(input());
  store.data.visits[0].status = 'referred';
  const changed = { ...PAYLOAD, findings: 'Reviewed clinical finding', recordedAt: '2026-11-06T01:00:00Z' };
  const result = await update(edit({ user: OTHER, payload: changed }));
  assert.equal(result.status, 'referred');
  assert.equal(result.recordedAt, PAYLOAD.recordedAt);
  assert.equal(store.data.visits[0].recordedById, USER.id);
  assert.equal(store.data.visits[0].recordedByName, USER.name);
  await assert.rejects(create(input({ user: OTHER })), { statusCode: 409 });
  const replay = await create(input());
  assert.equal(replay.id, first.id);
  assert.equal(replay.findings, changed.findings, 'a retry must not overwrite a later authorized edit');
});

test('scope and verified eligibility are rechecked before a durable create replay', async () => {
  const record = await create(input());
  const req = { user: USER, body: PAYLOAD, idempotencyKey: KEY };
  const body = { data: { consultation: record } };
  await validateCreateReplay(req, body, { repo: fileRepository, supabase: supabaseFor() });
  for (const user of [ { ...USER, municipalityId: 'm2' }, { ...USER, barangayId: 'b2' },
    { ...USER, barangay: 'Other Barangay' } ]) {
    await assert.rejects(create(input({ user })), { statusCode: 404 });
    await assert.rejects(validateCreateReplay({ ...req, user }, body, { repo: fileRepository, supabase: supabaseFor() }), { statusCode: 404 });
  }
  store.data.residents[0].verificationStatus = 'rejected';
  await assert.rejects(create(input()), { statusCode: 422 });
  await assert.rejects(validateCreateReplay(req, body, { repo: fileRepository, supabase: supabaseFor() }), { statusCode: 422 });
  assert.equal(store.data.followUps.length, 1);
});

test('a failed create-side-effect completion resumes without a second clinical insert', async () => {
  let attempts = 0;
  const repo = { ...fileRepository, completeConsultationOperation: async (args) => {
    if (++attempts === 1) throw new ApiError(503, 'Temporary completion outage');
    return fileRepository.completeConsultationOperation(args);
  } };
  await assert.rejects(create(input({ repo })), { statusCode: 503 });
  assert.equal(store.data.visits.length, 1);
  assert.equal(store.data.followUps, undefined);
  assert.equal(store.data.visits[0].consultationDetails.remarks, PAYLOAD.remarks);
  const result = await create(input({ repo }));
  assert.equal(result.id, store.data.visits[0].id);
  assert.equal(store.data.counters.submissions, 1);
  assert.equal(store.data.followUps.length, 1);
  assert.equal(store.data.notifications.length, 2);
});

test('response loss after visit insert but before resident/read completion is safe to retry', async () => {
  let loseResponse = true;
  const repo = { ...fileRepository, insertVisit: async (visit) => {
    const result = await fileRepository.insertVisit(visit);
    if (loseResponse) { loseResponse = false; throw new ApiError(503, 'Read after insert failed'); }
    return result;
  } };
  await assert.rejects(create(input({ repo })), { statusCode: 503 });
  const retry = await create(input({ repo }));
  assert.equal(store.data.visits.length, 1);
  assert.equal(retry.recordedAt, PAYLOAD.recordedAt);
  assert.equal(store.data.followUps.length, 1);
});

test('clinical delimiters, exact date/time, medications, resident and authoritative service survive persistence', async () => {
  const result = await create(input());
  for (const field of ['consultationDate', 'consultationTime', 'findings', 'diagnosis', 'treatmentGiven',
    'medicationPrescribed', 'adviceGiven', 'remarks', 'nextVisitDate', 'recordedAt']) assert.equal(result[field], PAYLOAD[field], field);
  assert.equal(result.resident.id, PAYLOAD.residentId);
  assert.equal(result.resident.name, 'Test Resident');
  assert.equal(result.serviceId, SERVICE);
  assert.equal(result.serviceName, 'Authoritative service name');
  assert.equal(store.data.visits[0].visitDate, '2026-11-05T09:42:00+08:00');
  assert.ok(Date.parse(result.createdAt) >= Date.parse(result.recordedAt));
  assert.ok(result.updatedAt);
  assert.equal(result.vitals.hr, 70);
  assert.equal(result.vitals.rr, 18);
  assert.equal(result.vitals.o2sat, 99);
  assert.equal(result.medications[0].genericName, 'Test medicine');
  // A PostgreSQL timestamptz response can be UTC; clinical date/time are retained.
  const utcRead = await fromVisit({ ...store.data.visits[0], visitDate: '2026-11-05T01:42:00Z' }, supabaseFor());
  assert.equal(utcRead.consultationTime, '09:42');
  assert.equal(toVisit({ consultationDate: PAYLOAD.consultationDate, pulseRate: '', height: '', weight: '' }, USER, PAYLOAD.residentId).vitals.hr, null);
});

test('original keys and resident cannot be reassigned on update; every existing workflow status remains intact', async () => {
  await create(input());
  for (const status of ['draft', 'submitted', 'received', 'in_review', 'referred', 'completed']) {
    store.data.visits[0].status = status;
    assert.equal((await update(edit())).status, status);
  }
  await assert.rejects(update(edit({ payload: { ...PAYLOAD, residentId: 'RES-OTHER' } })), { statusCode: 409 });
  await assert.rejects(update(edit({ payload: { ...PAYLOAD, clientOperationKey: OTHER.id } })), { statusCode: 409 });
  await assert.rejects(fileRepository.updateVisit(store.data.visits[0].id, { recordedById: OTHER.id }), { statusCode: 409 });
});

test('new consultation validation and health-service scope/eligibility gates are not bypassed by UUIDs', async () => {
  for (const payload of [
    { ...PAYLOAD, clientOperationKey: 'not-a-uuid' }, { ...PAYLOAD, consultationDate: '2026-02-30' },
    { ...PAYLOAD, consultationTime: '25:61' }, { ...PAYLOAD, nextVisitDate: '2026-11-31' },
    { ...PAYLOAD, nextVisitDate: '' }, { ...PAYLOAD, bloodPressure: 'abc' },
    { ...PAYLOAD, recordedAt: 'not-a-timestamp' }, { ...PAYLOAD, serviceId: USER.id },
  ]) await assert.rejects(create(input({ payload })), { statusCode: 422 });
  for (const supabase of [supabaseFor({ active: false }), supabaseFor({ municipality: 'm2' })]) {
    await assert.rejects(create(input({ supabase })), { statusCode: 422 });
  }
  await assert.rejects(create(input({ user: { ...USER, role: 'bhw' } })), { statusCode: 403 });
  await assert.rejects(create(input({ user: { ...USER, role: 'rhu_personnel' } })), { statusCode: 403 });
  assert.equal(store.data.visits.length, 0);
  assert.equal(store.data.healthAuditLogs.length, 0);
});

test('the same service association can be replayed after deactivation but never moved out of scope', async () => {
  await create(input());
  assert.equal((await create(input({ supabase: supabaseFor({ active: false }) }))).serviceId, SERVICE);
  await assert.rejects(create(input({ supabase: supabaseFor({ municipality: 'm2' }) })), { statusCode: 422 });
  assert.equal(store.data.visits.length, 1);
});

test('extra clinical JSON survives create/detail and scalar edits without losing original fields', async () => {
  const details = { physicalExam: { skin: 'Test finding', neurological: 'Test finding' },
    pastMedicalHistory: ['Test history'], allergies: 'Test allergy' };
  const record = await create(input({ payload: { ...PAYLOAD, consultationDetails: details } }));
  assert.deepEqual(record.consultationDetails.physicalExam, details.physicalExam);
  const changed = await update(edit({ payload: { ...PAYLOAD, diagnosis: 'Reviewed assessment' } }));
  assert.deepEqual(changed.consultationDetails.pastMedicalHistory, details.pastMedicalHistory);
  assert.equal(changed.consultationDetails.diagnosis, 'Reviewed assessment');
  const loaded = await get({ user: USER, id: record.id, repo: fileRepository, supabase: supabaseFor() });
  assert.equal(loaded.consultationDetails.allergies, details.allergies);
  assert.equal(loaded.recordedAt, PAYLOAD.recordedAt);
  await assert.rejects(create(input({ payload: { ...PAYLOAD, clientOperationKey: OTHER.id, consultationDetails: [] } })), { statusCode: 422 });
});

test('detail uses current resident/staff scope and authenticated resident self identity', async () => {
  const record = await create(input());
  const lookup = (user, id = record.id) => get({ user, id, repo: fileRepository, supabase: supabaseFor() });
  assert.equal((await lookup(USER)).id, record.id);
  await assert.rejects(lookup({ ...USER, municipalityId: 'm2' }), { statusCode: 404 });
  await assert.rejects(lookup({ ...USER, barangayId: 'b2' }), { statusCode: 404 });
  await assert.rejects(lookup(USER, 'SUB-MISSING'), { statusCode: 404 });
  await assert.rejects(lookup({ ...USER, role: 'rhu_personnel' }), { statusCode: 403 });
  const residentUser = { id: store.data.residents[0].authUserId, role: 'resident' };
  assert.equal((await lookup(residentUser)).resident.id, PAYLOAD.residentId);
  await assert.rejects(lookup({ ...residentUser, id: OTHER.id }), { statusCode: 404 });
  const selfList = await list({ user: residentUser, filters: { residentId: 'RES-OTHER' }, repo: fileRepository, supabase: supabaseFor() });
  assert.equal(selfList.rows[0].resident.id, PAYLOAD.residentId, 'client filters cannot replace the linked self id');
});

test('scope is applied before pagination, with honest scoped totals and stable distinct pages', async () => {
  await create(input());
  await create(input({ payload: { ...PAYLOAD, clientOperationKey: OTHER.id } }));
  store.data.residents.push({ id: 'RES-OUTSIDE', barangay: 'Outside', barangayId: 'b2', municipalityId: 'm2' });
  store.data.visits.push(...Array.from({ length: 220 }, (_, i) => ({ id: `SUB-OUTSIDE-${i}`, residentId: 'RES-OUTSIDE',
    visitDate: '2026-12-31T12:00:00Z', updatedAt: '2026-12-31T12:00:00Z' })));
  const first = await list({ user: USER, limit: 1, offset: 0, repo: fileRepository, supabase: supabaseFor() });
  const next = await list({ user: USER, limit: 1, offset: 1, repo: fileRepository, supabase: supabaseFor() });
  assert.equal(first.total, 2);
  assert.equal(next.total, 2);
  assert.equal(first.rows.length, 1);
  assert.equal(next.rows.length, 1);
  assert.notEqual(first.rows[0].id, next.rows[0].id);
  assert.equal(first.rows[0].resident.id, PAYLOAD.residentId);
  await assert.rejects(list({ user: USER, limit: 501, repo: fileRepository, supabase: supabaseFor() }), { statusCode: 422 });
  await assert.rejects(list({ user: USER, offset: -1, repo: fileRepository, supabase: supabaseFor() }), { statusCode: 422 });
});

test('same-date terminal legacy follow-ups are not recreated by edit retries', async () => {
  const calls = [];
  const ops = { create: async (args) => calls.push(['create', args]), update: async (args) => calls.push(['update', args]) };
  const linked = { id: 'old-followup', status: 'Completed', resident_decision: 'approved',
    consultation_id: 'SUB-TEST', client_operation_key: null, scheduled_date: PAYLOAD.nextVisitDate };
  const supabase = { from() { const query = { select() { return query; }, eq() { return query; },
    order: async () => ({ data: [linked], error: null }) }; return query; } };
  await syncConsultationFollowUp({ user: USER, visit: { id: 'SUB-TEST', residentId: PAYLOAD.residentId }, payload: PAYLOAD, supabase, ops });
  assert.equal(calls.length, 0);
  await syncConsultationFollowUp({ user: USER, visit: { id: 'SUB-TEST', residentId: PAYLOAD.residentId },
    payload: { ...PAYLOAD, nextVisitDate: '2026-11-13' }, supabase, ops });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'create');
  assert.equal(calls[0][1].idempotencyKey, 'consultation-followup:SUB-TEST:2026-11-13');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { completeSubmission, updateSubmissionForPhn } from '../src/services/phnQueue.service.js';
import errorHandler from '../src/middleware/errorHandler.js';

const actor = { id: 'clinician-a', role: 'rhu_personnel', rhuStations: ['consultation'], facilityId: 'facility-a', municipalityId: 'municipality-a', name: 'Test Clinician' };
const outputs = { findings: 'Recorded findings', treatmentGiven: 'Recorded plan', recommendation: 'Recorded plan', phn: { assessment: 'Recorded concern', notes: 'Recorded notes' }, medications: [{ genericName: 'Paracetamol', dose: '1 tablet', frequency: 'As needed', route: 'Oral', duration: '3 days', quantity: '6', instructions: 'Recorded directions', custom: true, source: 'custom' }] };

function fixture() {
  const recordedVitals = { bp: '120/80', hr: 72, rr: 18, o2sat: 98, temperature: 36.8, heightCm: 170, weightKg: 65, bloodSugar: 100 };
  let record = { id: 'visit-a', residentId: 'patient-a', status: 'in_review', facilityId: 'facility-a', visitDate: '2026-11-19T09:00:00+08:00', updatedAt: '2026-11-19T09:00:00Z',
    consultationRoutedAt: '2026-11-19T08:30:00Z', consultationRoutedFacilityId: 'facility-a',
    resident: { id: 'patient-a', municipalityId: 'municipality-a' },
    consultationDetails: { consultationDate: '2026-11-19', consultationTime: '09:00', clinicalIndicators: { dangerSignsReviewed: true } },
    vitals: recordedVitals, triageSnapshot: { residentId: 'patient-a', vitals: recordedVitals } };
  const writes = [];
  const repo = {
    driver: 'supabase', getVisit: async () => structuredClone(record),
    updateVisit: async (id, patch, guard) => {
      writes.push({ id, patch: structuredClone(patch), guard });
      if (guard.expectedUpdatedAt !== record.updatedAt || !guard.allowedStatuses.includes(record.status)) return null;
      record = { ...record, ...structuredClone(patch), updatedAt: '2026-11-19T09:01:00Z' };
      return structuredClone(record);
    },
  };
  return { repo, writes, saved: () => structuredClone(record) };
}

test('consultation completion saves clinician outputs and status in one guarded write, retaining triage linkage', async () => {
  const f = fixture();
  const saved = await completeSubmission({ id: 'visit-a', user: actor, patch: outputs, repo: f.repo });
  assert.equal(f.writes.length, 1);
  assert.equal(saved.status, 'completed');
  assert.equal(saved.residentId, 'patient-a');
  assert.equal(saved.triageSnapshot.residentId, 'patient-a');
  assert.equal(saved.triageSnapshot.vitals.bloodSugar, 100);
  assert.equal(saved.phn.personnel, 'Test Clinician');
  assert.equal(saved.medications[0].dose, '1 tablet');
  assert.equal(f.writes[0].patch.status, 'completed');
  assert.equal(f.writes[0].guard.expectedUpdatedAt, '2026-11-19T09:00:00Z');
});

test('retrying a confirmed completion returns the same record without another write; changed outputs conflict', async () => {
  const f = fixture();
  await completeSubmission({ id: 'visit-a', user: actor, patch: outputs, repo: f.repo });
  const replay = await completeSubmission({ id: 'visit-a', user: actor, patch: outputs, repo: f.repo });
  assert.equal(replay.id, 'visit-a');
  assert.equal(f.writes.length, 1);
  await assert.rejects(() => completeSubmission({ id: 'visit-a', user: actor, patch: { ...outputs, findings: 'Different findings' }, repo: f.repo }), (e) => e.statusCode === 409);
});

test('missing actual treatment, immutable triage edits, and stale drafts never produce a completion write', async () => {
  const f = fixture();
  for (const patch of [{ ...outputs, treatmentGiven: '' }, { ...outputs, vitals: { bp: '140/90' } }, { ...outputs, chiefComplaint: 'Changed complaint' }, { ...outputs, expectedUpdatedAt: 'stale' }]) {
    await assert.rejects(() => completeSubmission({ id: 'visit-a', user: actor, patch, repo: f.repo }), (e) => [400, 409].includes(e.statusCode));
  }
  assert.equal(f.writes.length, 0);
  assert.equal(f.saved().status, 'in_review');
});

test('database failures and competing completion preserve original record and cannot report success', async () => {
  const f = fixture();
  await assert.rejects(() => completeSubmission({ id: 'visit-a', user: actor, patch: outputs, repo: { ...f.repo, updateVisit: async () => { throw new Error('Database unavailable'); } } }), /Database unavailable/);
  await assert.rejects(() => completeSubmission({ id: 'visit-a', user: actor, patch: outputs, repo: { ...f.repo, updateVisit: async () => null } }), (e) => e.statusCode === 409);
  assert.equal(f.saved().status, 'in_review');
});

test('triage-only staff and cross-patient facility scopes cannot modify consultation records', async () => {
  const f = fixture();
  await assert.rejects(() => updateSubmissionForPhn({ id: 'visit-a', user: { ...actor, rhuStations: ['triage'] }, patch: outputs, repo: f.repo }), (e) => e.statusCode === 403);
  await assert.rejects(() => completeSubmission({ id: 'visit-a', user: { ...actor, facilityId: 'other-facility' }, patch: outputs, repo: f.repo }), (e) => e.statusCode === 404);
  assert.equal(f.writes.length, 0);
});

test('clinical technical errors log correlation and codes without patient data, URLs, or database detail', () => {
  const logged = [];
  const original = console.error;
  let response;
  console.error = (...args) => logged.push(args);
  try {
    errorHandler(Object.assign(new Error('Synthetic patient detail and private query'), { code: '23514' }),
      { method: 'POST', path: '/api/phn/submissions/private-patient-identifier/complete', requestId: 'request-test' },
      { status: () => ({ json: (body) => { response = body; } }) }, () => {});
  } finally { console.error = original; }
  assert.match(JSON.stringify(logged), /request-test/);
  assert.match(JSON.stringify(logged), /23514/);
  assert.doesNotMatch(JSON.stringify(logged), /Synthetic patient|private-patient-identifier|private query/);
  assert.doesNotMatch(response.error.message, /Synthetic patient|private query/);
});

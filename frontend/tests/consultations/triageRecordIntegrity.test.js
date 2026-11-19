import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { mapVisitToPatient, splitWalkInName, triageToVisitPayload } from '../../src/lib/phnWorkflowMap.js';

const visit = (overrides = {}) => ({
  id: 'encounter-a', residentId: 'resident-a', status: 'in_review',
  visitDate: '2026-11-19T08:30:00Z',
  resident: { id: 'resident-a', firstName: 'Test', lastName: 'Patient', age: 0, sex: 'Female', barangay: 'Pili' },
  ...overrides,
});

test('consultation maps every saved triage measurement, identity and attribution', () => {
  const record = visit({
    chiefComplaint: 'Recorded complaint', clinicalHistory: 'Recorded triage note',
    recordedBy: 'triage-actor', recordedByName: 'Recorded Personnel',
    submittedAt: '2026-11-19T08:35:00Z',
    vitals: { heightCm: 55, weightKg: 4, bmi: 13.2, bp: '80/45', bloodSugar: 92, temperature: 37.1, hr: 125, rr: 35, o2sat: 98 },
  });
  const patient = mapVisitToPatient(record);
  assert.equal(patient.age, 0);
  assert.equal(patient.residentId, 'resident-a');
  assert.deepEqual(patient.triage, {
    id: 'encounter-a', residentId: 'resident-a', date: record.submittedAt,
    chiefComplaint: record.chiefComplaint, heightCm: 55, weight: 4, bmi: 13.2,
    bloodPressure: '80/45', bloodSugar: 92, temperature: 37.1, pulseRate: 125,
    respiratoryRate: 35, oxygenSaturation: 98, notes: record.clinicalHistory,
    personnel: 'Recorded Personnel', personnelId: 'triage-actor', warnings: [],
  });
});

test('missing measurements and personnel remain missing instead of invented defaults', () => {
  const patient = mapVisitToPatient(visit({ resident: { id: 'resident-a', firstName: 'Test' } }));
  assert.equal(patient.age, '');
  assert.equal(patient.sex, '');
  assert.equal(patient.barangay, null);
  for (const key of ['heightCm', 'weight', 'bmi', 'bloodPressure', 'bloodSugar', 'temperature', 'pulseRate', 'respiratoryRate', 'oxygenSaturation']) {
    assert.equal(patient.triage[key], null, key);
  }
  assert.equal(patient.triage.personnel, '');
});

test('immutable submitted snapshot takes precedence over later demographic or clinical changes', () => {
  const patient = mapVisitToPatient(visit({
    resident: { id: 'resident-a', firstName: 'Later', lastName: 'Name', age: 31, barangay: 'Later Barangay' },
    chiefComplaint: 'Later complaint', vitals: { weightKg: 100 },
    triageSnapshot: {
      residentId: 'resident-a', resident: { firstName: 'Original', lastName: 'Name', age: 30, sex: 'Male', barangay: 'Original Barangay' },
      chiefComplaint: 'Original complaint', clinicalHistory: 'Original notes',
      visitDate: '2026-11-18T10:00:00Z', submittedAt: '2026-11-18T10:05:00Z',
      vitals: { weightKg: 60, bloodSugar: 110 }, recordedByName: 'Original Recorder',
    },
  }));
  assert.equal(patient.patient, 'Original Name');
  assert.equal(patient.age, 30);
  assert.equal(patient.barangay, 'Original Barangay');
  assert.equal(patient.triage.weight, 60);
  assert.equal(patient.triage.bloodSugar, 110);
  assert.equal(patient.triage.chiefComplaint, 'Original complaint');
  assert.equal(patient.triage.personnel, 'Original Recorder');
});

test('incomplete snapshots never borrow measurements from a later clinical edit', () => {
  const patient = mapVisitToPatient(visit({
    vitals: { weightKg: 90, bp: '120/80' },
    triageSnapshot: { residentId: 'resident-a', resident: {}, vitals: {} },
  }));
  assert.equal(patient.triage.weight, null);
  assert.equal(patient.triage.bloodPressure, null);
});

test('patient identity mismatches fail closed for both joins and snapshots', () => {
  assert.throws(() => mapVisitToPatient(visit({ resident: { id: 'resident-b' } })), /identity could not be verified/);
  assert.throws(() => mapVisitToPatient(visit({ triageSnapshot: { residentId: 'resident-b' } })), /identity could not be verified/);
});

test('unfinished consultation hydrates saved prescription and findings without marking completed', () => {
  const medications = [{ genericName: 'Selected medicine', dose: 'Clinician entry', instructions: 'Recorded instructions' }];
  const patient = mapVisitToPatient(visit({ findings: 'Saved findings', medications, phn: { assessment: 'Saved concern', notes: 'Saved notes' } }));
  assert.equal(patient.checkup, undefined);
  assert.equal(patient.checkupDraft.assessment, 'Saved findings');
  assert.equal(patient.checkupDraft.healthConcern, 'Saved concern');
  assert.deepEqual(patient.checkupDraft.medications, medications);
});

test('mapping another encounter never reuses the preceding prescription or triage values', () => {
  mapVisitToPatient(visit({ medications: [{ genericName: 'First medicine' }], vitals: { bp: '120/80' } }));
  const other = mapVisitToPatient(visit({ id: 'encounter-b', residentId: 'resident-b', resident: { id: 'resident-b', firstName: 'Other' } }));
  assert.equal(other.triage.bloodPressure, null);
  assert.deepEqual(other.checkupDraft.medications, []);
});

test('legacy birth date is aged at the recorded encounter date and missing completer stays unknown', () => {
  const patient = mapVisitToPatient(visit({ status: 'completed', resident: { id: 'resident-a', birthDate: '2000-12-01' } }));
  assert.equal(patient.age, 25);
  assert.equal(patient.checkup.completedBy, '');
});

test('clinical payload preserves malformed raw measurements for server validation and a stable date', () => {
  const payload = triageToVisitPayload({ visitDate: '2026-11-19T08:30:00Z', temperature: '', pulseRate: 'abc', bloodSugar: '-5', heightCm: '1e3', weight: '60kg', bloodPressure: '120/9023123', bmi: 999 });
  assert.equal(payload.visitDate, '2026-11-19T08:30:00Z');
  assert.equal(payload.vitals.temperature, null);
  assert.equal(payload.vitals.hr, 'abc');
  assert.equal(payload.vitals.bloodSugar, '-5');
  assert.equal(payload.vitals.heightCm, '1e3');
  assert.equal(payload.vitals.weightKg, '60kg');
  assert.equal(payload.vitals.bp, '120/9023123');
  assert.equal(Object.hasOwn(payload.vitals, 'bmi'), false);
});

test('single-word names do not acquire an invented surname', () => {
  assert.deepEqual(splitWalkInName('Test'), { firstName: 'Test', lastName: '' });
});

async function workflowApi(api) {
  const source = await readFile(new URL('../../src/services/api/phnWorkflow.js', import.meta.url), 'utf8');
  const imports = `import { mapVisitToPatient, mapVisitsToPatients, splitWalkInName, triageToVisitPayload } from ${JSON.stringify(new URL('../../src/lib/phnWorkflowMap.js', import.meta.url).href)};`;
  const injected = source.replace(/^import .*;\r?\n/gm, '')
    .replace('export const phnWorkflowApi = {', 'export const createWorkflowApi = (api) => ({')
    .replace(/\r?\n};\r?\n\r?\nexport default phnWorkflowApi;/, '\n});');
  const module = await import(`data:text/javascript;base64,${Buffer.from(`${imports}\n${injected}`).toString('base64')}`);
  return module.createWorkflowApi(api);
}

test('handoff performs one atomic request carrying age and replay identity', async () => {
  const calls = [];
  const api = await workflowApi({ post: async (...args) => { calls.push(args); return { submission: visit({ status: 'submitted' }) }; } });
  const result = await api.sendToPhnQueue({ clientSubmissionId: 'operation-a', visitDate: '2026-11-19T08:30:00Z', patient: 'Test Patient', age: 0, sex: 'Female', barangay: 'Pili' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/intake/visits');
  assert.equal(calls[0][1].submit, true);
  assert.equal(calls[0][1].resident.age, 0);
  assert.equal(calls[0][1].clientSubmissionId, 'operation-a');
  assert.deepEqual(result, { confirmed: true, id: 'encounter-a' });
});

test('unconfirmed draft response and mismatched patient cannot produce handoff success', async () => {
  const draft = await workflowApi({ post: async () => ({ submission: visit({ status: 'draft' }) }) });
  await assert.rejects(() => draft.sendToPhnQueue({ clientSubmissionId: 'operation-a' }), /could not be confirmed/);
  const wrongPatient = await workflowApi({ post: async () => ({ submission: visit({ status: 'submitted', residentId: 'resident-b' }) }) });
  await assert.rejects(() => wrongPatient.sendToPhnQueue({ clientSubmissionId: 'operation-a', residentId: 'resident-a' }), /does not match/);
});

test('network and expired-auth errors propagate without another create request', async () => {
  for (const error of [new Error('Network interrupted'), Object.assign(new Error('Session expired'), { status: 401 })]) {
    let calls = 0;
    const api = await workflowApi({ post: async () => { calls += 1; throw error; } });
    await assert.rejects(() => api.sendToPhnQueue({ clientSubmissionId: 'operation-a' }), (actual) => actual === error);
    assert.equal(calls, 1);
  }
});

test('opening a consultation fetches its exact saved record and rejects another patient', async () => {
  const calls = [];
  const api = await workflowApi({ get: async (path) => { calls.push(path); return { submission: visit({ vitals: { bloodSugar: 101 } }) }; } });
  const patient = await api.getCheckup('encounter-a', 'resident-a');
  assert.deepEqual(calls, ['/phn/submissions/encounter-a/consultation']);
  assert.equal(patient.triage.bloodSugar, 101);
  await assert.rejects(() => api.getCheckup('encounter-a', 'resident-b'), /does not match/);
});

test('consultation outputs and completion use one confirmed request without inventing treatment from the diagnosis', async () => {
  const calls = [];
  const api = await workflowApi({ post: async (...args) => { calls.push(args); return { submission: { id: 'encounter-a', status: 'completed' } }; } });
  await api.completeCheckup('encounter-a', { assessment: 'Findings', healthConcern: 'Concern', clinicalNotes: 'Notes', expectedUpdatedAt: 'saved-timestamp' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/phn/submissions/encounter-a/complete');
  assert.equal(calls[0][1].submission.treatmentGiven, '');
  assert.equal(calls[0][1].submission.phn.assessment, 'Concern');
  assert.equal(calls[0][1].submission.expectedUpdatedAt, 'saved-timestamp');
  const unconfirmed = await workflowApi({ post: async () => ({ submission: { id: 'encounter-a', status: 'in_review' } }) });
  await assert.rejects(() => unconfirmed.completeCheckup('encounter-a', {}), /could not be confirmed/);
});

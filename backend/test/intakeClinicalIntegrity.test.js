import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateVitals, validateSubmissionForSubmit, triageReviewWarnings, createSubmission } from '../src/services/intake.service.js';
import { VITAL_FIELDS, emptyVitals, reviewFlags, validateVisitDetails } from '../../frontend/src/features/triage/lib/triageValidation.js';

test('triage vital validation accepts omitted optional observations and returns field errors for raw invalid values', () => {
  assert.deepEqual(validateVitals({}), {});
  assert.deepEqual(validateVitals({ hr: 'not-a-number', o2sat: 101, heightCm: 0, bp: '20/30' }), {
    'vitals.hr': 'Heart rate must be between 20 and 250 bpm.',
    'vitals.o2sat': 'Oxygen saturation must be between 50 and 100%.',
    'vitals.heightCm': 'Height must be between 20 and 300 cm.',
    'vitals.bp': 'Enter a plausible systolic/diastolic reading (40-300/20-200 mmHg, systolic greater than diastolic).',
  });
});

test('triage hand-off checks demographics and current visit fields with stable field keys', () => {
  const errors = validateSubmissionForSubmit({ firstName: '', lastName: '', sex: '', age: null, barangay: '' }, {
    visitDate: 'bad-date', chiefComplaint: '', vitals: { bloodSugar: 0 },
  });
  assert.deepEqual(Object.keys(errors).sort(), [
    'resident.age', 'resident.barangay', 'resident.firstName', 'resident.sex',
    'visit.chiefComplaint', 'visit.visitDate', 'vitals.bloodSugar',
  ]);
});

test('raw clinical and demographic validation rejects coercion and accepts valid single names', () => {
  const aliases = { pulseRate: 'hr', respiratoryRate: 'rr', oxygenSaturation: 'o2sat', bloodPressure: 'bp' };
  for (const { key, min, max } of VITAL_FIELDS) {
    for (const value of [String(min), String(max), String(min - 1), String(max + 1), '1e2', '1.5']) {
      const field = aliases[key] || key;
      const frontend = validateVisitDetails({ ...emptyVitals(), [key]: value }, 'Check-up', '');
      assert.equal(Boolean(frontend[key]), Boolean(validateVitals({ [field]: value })[`vitals.${field}`]), `${key}: ${value}`);
    }
  }
  for (const [key, values] of Object.entries({ temperature: ['34', '37', '38'], respiratoryRate: ['7', '40', '41', '60'], oxygenSaturation: ['93', '94', '95'], bloodSugar: ['69', '220', '250', '251'], bloodPressure: ['89/50', '120/80', '180/120'] })) {
    for (const value of values) assert.equal(reviewFlags({ ...emptyVitals(), [key]: value }).length > 0, triageReviewWarnings({ [aliases[key] || key]: value }).length > 0, `${key}: ${value} review flag`);
  }
  for (const field of ['heightCm', 'weightKg', 'hr', 'rr', 'o2sat', 'bloodSugar', 'temperature']) {
    for (const value of ['1e2', '0x40', true, [70], {}, '65kg', '-1']) assert.ok(validateVitals({ [field]: value })[`vitals.${field}`], `${field}: ${String(value)}`);
  }
  assert.ok(validateVitals({ hr: '72.5' })['vitals.hr']);
  assert.ok(validateVitals({ rr: '16.1' })['vitals.rr']);
  const patient = { firstName: 'Mononym', lastName: '', age: 30, sex: 'Female', barangay: 'San Antonio' };
  const visit = { visitDate: '2026-11-19T09:00:00Z', chiefComplaint: 'Checkup', vitals: {} };
  assert.deepEqual(validateSubmissionForSubmit(patient, visit), {});
  for (const age of ['1e2', '0x20', true, [30], -1, 1.5, 121]) assert.ok(validateSubmissionForSubmit({ ...patient, age }, visit)['resident.age']);
  for (const firstName of ['12345', 'Test2', '<Test>']) assert.ok(validateSubmissionForSubmit({ ...patient, firstName }, visit)['resident.firstName']);
  assert.ok(validateSubmissionForSubmit(patient, { ...visit, chiefComplaint: 'x'.repeat(2001) })['visit.chiefComplaint']);
  assert.ok(validateSubmissionForSubmit(patient, { ...visit, clinicalHistory: 'x'.repeat(10001) })['visit.clinicalHistory']);
});

test('atomic service returns the same complete flat snapshot contract used by consultation mapping', async () => {
  let saved;
  const repo = {
    driver: 'file',
    getResident: async () => ({ id: 'patient-a', firstName: 'Test', lastName: 'Patient', birthDate: '2000-12-01', age: null, sex: 'Female', barangay: 'San Antonio' }),
    createSubmittedTriage: async (args) => { saved = args; return { id: 'visit-a', status: 'submitted', ...args.visit }; },
  };
  await createSubmission({ residentId: 'patient-a', submit: true, clientSubmissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    user: { id: 'actor-a', role: 'rhu_personnel', facilityId: 'facility-a', rhuStations: ['triage'], name: 'Test Recorder' },
    visit: { visitDate: '2026-11-19T09:00:00Z', chiefComplaint: 'Recorded complaint', clinicalHistory: 'Recorded notes', vitals: { heightCm: '170', weightKg: '65', bloodSugar: '100' } }, repo });
  assert.equal(saved.visit.triageSnapshot.residentId, 'patient-a');
  assert.equal(saved.visit.triageSnapshot.resident.age, 25);
  assert.equal(saved.visit.triageSnapshot.vitals.bmi, 22.5);
  assert.equal(saved.visit.triageSnapshot.vitals.bloodSugar, 100);
  assert.equal(saved.visit.triageSnapshot.recordedBy, 'actor-a');
  assert.equal(saved.visit.triageSnapshot.recordedByName, 'Test Recorder');
  assert.equal(saved.visit.triageSnapshot.chiefComplaint, 'Recorded complaint');
  assert.equal(saved.visit.triageSnapshot.clinicalHistory, 'Recorded notes');
  assert.equal(Object.hasOwn(saved.visit.triageSnapshot, 'visit'), false);
});

test('file adapter serializes replays and rejects operation-key payload changes', async (t) => {
  const [{ fileRepository }, { FileStore }] = await Promise.all([
    import('../src/repositories/fileRepository.js'), import('../src/repositories/fileStore.js'),
  ]);
  const dir = await mkdtemp(path.join(tmpdir(), 'rhu-triage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storeAdapter = new FileStore(path.join(dir, 'store.json'));
  const args = {
    resident: { firstName: 'Atomic', lastName: 'Replay', age: 30, sex: 'Female', barangay: 'San Antonio' },
    visit: { visitDate: '2026-11-19T09:00:00.000Z', chiefComplaint: 'Test', recordedByRole: 'bhw', vitals: {} },
    submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', fingerprint: 'a'.repeat(64), actorId: 'worker-test', storeAdapter,
  };
  const [first, second] = await Promise.all([fileRepository.createSubmittedTriage(args), fileRepository.createSubmittedTriage(args)]);
  assert.equal(first.id, second.id);
  assert.equal(first.status, 'submitted');
  assert.equal(first.resident.age, 30);
  await assert.rejects(fileRepository.createSubmittedTriage({ ...args, fingerprint: 'b'.repeat(64) }), (error) => error.statusCode === 409);
  assert.equal(storeAdapter.visits.filter((row) => row.clientSubmissionId === args.submissionId).length, 1);
  assert.equal(storeAdapter.residents.filter((row) => row.firstName === 'Atomic').length, 1);
});

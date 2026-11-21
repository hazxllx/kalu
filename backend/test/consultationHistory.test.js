import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import repository from '../src/repositories/fileRepository.js';
import store from '../src/repositories/fileStore.js';
import { create, get, list, update, toVisit, fromVisit, validateVitals, parseListFilters } from '../src/services/consultations.service.js';
import { classifyBloodPressure } from '../src/config/bpThresholds.js';
import { getOwnHealthRecords, getStaffHealthHistory } from '../src/services/residents.service.js';
import { list as listController } from '../src/controllers/consultations.controller.js';
import { DEFAULT_CLINICAL_ASSESSMENT_CONFIG } from '../src/utils/clinicalAssessment.js';

const staff = { id: 'staff', role: 'health_supervisor', name: 'Recording Nurse', municipalityId: 'm1', barangayId: 'b1', barangay: 'Test Barangay' };
const phn = { id: 'phn', role: 'phn', municipalityId: 'm1' };
const residentUser = { id: 'account-1', role: 'resident' };
const originalPersist = store.persist;
const resident = (id, extra = {}) => ({ id, firstName: id, lastName: 'Resident', municipalityId: 'm1', barangayId: 'b1', barangay: 'Test Barangay', verificationStatus: 'approved', ...extra });
const visit = (id, residentId, date, extra = {}) => ({ id, residentId, status: 'completed', visitDate: `${date}T09:00:00`, updatedAt: '2026-11-01', vitals: {}, ...extra });

beforeEach(() => {
  store.persist = async () => {};
  store.chain = Promise.resolve();
  store.data = {
    counters: { residents: 4, submissions: 10, referrals: 0 },
    residents: [resident('r1', { authUserId: residentUser.id }), resident('r2'), resident('r3', { barangayId: 'b2', barangay: 'Other Barangay' }), resident('r4', { municipalityId: 'm2' })],
    visits: [visit('old', 'r1', '2025-01-01', { updatedAt: '2027-01-01', findings: 'Historical finding\nDiagnosis: Historical diagnosis', treatmentGiven: 'Rest\nMedication: Legacy medication', recordedByName: 'Former Nurse' }),
      visit('recent', 'r1', '2026-11-01'), visit('pending', 'r1', '2026-11-20', { status: 'in_review' }),
      visit('other-patient', 'r2', '2026-11-10'), visit('other-barangay', 'r3', '2026-11-10'), visit('other-municipality', 'r4', '2026-11-10')],
    referrals: [], followUps: [], healthAuditLogs: [], riskCriteria: [], riskSettings: null,
  };
});
afterEach(() => { store.persist = originalPersist; store.data = null; });

test('historical risk is read from saved assessments and only reassessed through an audited edit', async () => {
  const protocol = {
    version: 'approved-test-v1', thresholds: DEFAULT_CLINICAL_ASSESSMENT_CONFIG.thresholds,
    approved_by: 'reviewer', approved_at: '2026-11-20T00:00:00Z', review_reference: 'Test protocol',
  };
  const supabase = { from(table) {
    const query = {
      select: () => query, eq: () => query, lte: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: table === 'clinical_assessment_protocols' ? protocol : null }),
    };
    return query;
  } };
  store.data.residents[0].birthDate = '1990-01-01';
  store.data.visits = [
    visit('low', 'r1', '2026-11-01', { chiefComplaint: 'Review visit', findings: 'No danger signs', vitals: { bp: '110/70' } }),
    visit('medium', 'r1', '2026-11-02', { chiefComplaint: 'Review visit', vitals: { bp: '143/92' }, treatmentGiven: 'Rest' }),
    visit('high', 'r2', '2026-11-03', { findings: 'Severe bleeding', consultationDetails: { clinicalAssessmentHistory: [{ level: 'HIGH' }] } }),
    visit('legacy-medium', 'r2', '2026-11-03', { consultationDetails: { clinical_assessment: { risk_level: 'medium' } } }),
    visit('unassessed', 'r2', '2026-11-04', { vitals: { temperature: 36.5 }, consultationDetails: {
      followUpRequired: 'Yes', nextVisitDate: '2026-11-30',
    } }),
    visit('absent', 'r2', '2026-11-05'),
  ];
  const args = { user: staff, repo: repository, supabase };
  const expected = { low: 'Unassessed', medium: 'Unassessed', high: 'High', 'legacy-medium': 'Moderate',
    unassessed: 'Unassessed', absent: 'Unassessed' };
  const before = await list(args);
  assert.deepEqual(Object.fromEntries(before.rows.map(({ id, riskLevel }) => [id, riskLevel])), expected);
  for (const [id, level] of Object.entries(expected)) {
    const detail = await get({ ...args, id });
    assert.equal(detail.riskLevel, level);
    assert.equal(detail.resident.id, id === 'low' || id === 'medium' ? 'r1' : 'r2');
  }
  assert.equal((await repository.getVisit('medium')).consultationDetails, undefined);
  assert.equal((await repository.getVisit('low')).consultationDetails, undefined);
  const first = await update({ ...args, id: 'medium', payload: { adviceGiven: 'Test update' },
    persistRisk: async () => {}, notify: async () => {} });
  assert.equal(first.riskLevel, 'Moderate');
  assert.equal(first.clinicalAssessment.level, 'Medium');
  assert.equal(first.vitals.bp, '143/92');
  assert.equal(first.treatmentGiven, 'Rest');
  assert.equal(first.consultationDetails.clinicalAssessmentHistory.length, 1);
  const second = await update({ ...args, id: 'medium', payload: { adviceGiven: 'Another update' },
    persistRisk: async () => {}, notify: async () => {} });
  assert.deepEqual(second.consultationDetails.clinicalAssessmentHistory, first.consultationDetails.clinicalAssessmentHistory);
  assert.equal((await get({ ...args, id: 'medium' })).riskLevel, 'Moderate');
  const reassessedLow = await update({ ...args, id: 'low', payload: { adviceGiven: 'Reviewed with approved protocol' },
    persistRisk: async () => {}, notify: async () => {} });
  assert.equal(reassessedLow.riskLevel, 'Low');
  assert.equal(reassessedLow.clinicalAssessmentHistory, undefined);
  assert.equal(reassessedLow.consultationDetails.clinicalAssessmentHistory.length, 1);
  assert.equal(reassessedLow.consultationDetails.clinicalAssessmentHistory[0].assessedBy, staff.id);
  assert.equal(store.data.visits.length, 6);
});

test('staff controller propagates both resident filter spellings and rejects malformed ids', async () => {
  for (const query of [{ residentId: 'r1' }, { resident_id: 'r1' }]) {
    let body;
    await listController({ user: staff, query }, { status() { return this; }, json(value) { body = value; } });
    assert.deepEqual(body.data.rows.map((row) => row.id), ['recent', 'old']);
    assert.equal(body.data.total, 2);
  }
  assert.ok(parseListFilters({ residentId: ['r1', 'r2'] }).errors.length);
});

test('history uses clinical chronology before pagination while queue ordering stays unchanged', async () => {
  const filters = { residentId: 'r1', statuses: ['completed'] };
  const first = await list({ user: staff, filters, limit: 1, repo: repository });
  const second = await list({ user: staff, filters, limit: 1, offset: 1, repo: repository });
  assert.equal(first.rows[0].id, 'recent');
  assert.equal(second.rows[0].id, 'old');
  assert.equal(first.total, 2);
  assert.equal((await repository.listVisits(filters)).rows[0].id, 'old');
});

test('staff history cannot cross barangay or municipality scope through resident filters or direct ids', async () => {
  assert.equal((await list({ user: staff, filters: { residentId: 'r3' }, repo: repository })).total, 0);
  assert.equal((await list({ user: phn, filters: { residentId: 'r4' }, repo: repository })).total, 0);
  assert.equal((await list({ user: phn, filters: { residentId: 'r3' }, repo: repository })).total, 1);
  await assert.rejects(get({ user: staff, id: 'other-barangay', repo: repository }), { statusCode: 404 });
  await assert.rejects(get({ user: phn, id: 'other-municipality', repo: repository }), { statusCode: 404 });
  for (const user of [{ ...phn, municipalityId: null }, { ...staff, barangayId: null, barangay: null }]) {
    await assert.rejects(list({ user, repo: repository }), { statusCode: 403 });
    await assert.rejects(get({ user, id: 'old', repo: repository }), { statusCode: 403 });
  }
});

test('completed staff history excludes encounters still waiting for consultation', async () => {
  const parsed = parseListFilters({ residentId: 'r1' });
  const result = await list({ user: staff, filters: { ...parsed.filters, statuses: ['completed'] }, repo: repository });
  assert.ok(result.rows.every((row) => row.status === 'completed'));
  assert.ok(!result.rows.some((row) => row.id === 'pending'));
  assert.ok((await list({ user: staff, repo: repository })).rows.some((row) => row.id === 'pending'));
});

test('an account without a linked resident cannot read historical records', async () => {
  const user = { id: 'unlinked-account', role: 'resident' };
  assert.deepEqual(await list({ user, filters: { residentId: 'r1' }, repo: repository }), { rows: [], total: 0 });
  assert.equal((await getOwnHealthRecords({ user, repo: repository })).resident, null);
  await assert.rejects(get({ user, id: 'old', repo: repository }), { statusCode: 404 });
});

test('source referral and terminal follow-up remain attached to their original encounter', async () => {
  store.data.visits[1].referralId = 'incoming-referral';
  store.data.visits[1].completedAt = '2026-11-01T10:00:00Z';
  store.data.visits[1].consultationDetails = { clinicalAssessment: { level: 'High' } };
  store.data.referrals.push({ id: 'incoming-referral', resident_id: 'r1', treatment_visit_id: 'earlier-visit', status: 'Completed' });
  store.data.followUps.push({ id: 'terminal-followup', resident_id: 'r1', consultation_id: 'recent', status: 'Completed' },
    { id: 'unlinked-followup', resident_id: 'r1', consultation_id: null, status: 'Pending' });
  const record = await get({ user: residentUser, id: 'recent', repo: repository });
  assert.equal(record.riskLevel, 'High');
  assert.equal(record.completedAt, '2026-11-01T10:00:00Z');
  assert.equal(record.fromReferral, true);
  assert.deepEqual(record.referrals.map((row) => row.id), ['incoming-referral']);
  assert.deepEqual(record.followUps.map((row) => row.id), ['terminal-followup']);

  store.data.visits.push(visit('follow-up-only', 'r1', '2026-11-02', {
    consultationDetails: { clinicalAssessment: { level: 'Medium' }, followUpRequired: 'Yes', nextVisitDate: '2026-11-30' },
  }));
  store.data.followUps.push({ id: 'scheduled-followup', resident_id: 'r1', consultation_id: 'follow-up-only', status: 'Pending' });
  const followUpOnly = await get({ user: residentUser, id: 'follow-up-only', repo: repository });
  assert.equal(followUpOnly.riskLevel, 'Moderate');
  assert.equal(followUpOnly.referralRequired, 'No');
  assert.equal(followUpOnly.referrals.length, 0);
  assert.deepEqual(followUpOnly.followUps.map((row) => row.id), ['scheduled-followup']);
});

test('resident identity comes from the session for list, detail and completed self history', async () => {
  const result = await list({ user: residentUser, filters: { residentId: 'r2', statuses: ['completed'] }, repo: repository });
  assert.deepEqual(result.rows.map((row) => row.id), ['recent', 'old']);
  await assert.rejects(get({ user: residentUser, id: 'other-patient', repo: repository }), { statusCode: 404 });
  const own = await getOwnHealthRecords({ user: residentUser, filters: { residentId: 'r2' }, repo: repository });
  assert.deepEqual(own.consultations.map((row) => row.id), ['recent', 'old']);
  const old = own.consultations[1];
  assert.equal(old.diagnosis, 'Historical diagnosis');
  assert.equal(old.medications, 'Legacy medication');
  assert.equal(old.consultingPersonnel, 'Former Nurse');
});

test('a newly completed canonical visit appears with full prescription, vitals, follow-up, referral and personnel context', async () => {
  const created = await create({ user: staff, repo: repository, supabase: null,
    persistRisk: async () => {},
    payload: { residentId: 'r1', clientOperationKey: '11111111-1111-4111-8111-111111111111', consultationDate: '2026-11-19', consultationTime: '08:45',
      chiefComplaint: 'Cough', findings: 'Clear chest', diagnosis: 'Viral illness', treatmentGiven: 'Rest', adviceGiven: 'Hydrate', remarks: 'Improving',
      medications: [{ genericName: 'Paracetamol', strength: '500 mg', dose: '1 tablet', route: 'Oral', frequency: 'As needed', duration: '3 days', instructions: 'With food' }],
      bloodPressure: '120/80', pulseRate: '70', respiratoryRate: '18', oxygenSaturation: '99', temperature: '36.5', height: '170', weight: '65',
      followUpRequired: 'Yes', nextVisitDate: '2026-11-25', referralRequired: 'Yes' } });
  store.data.referrals.push({ id: 'ref-1', residentId: 'r1', visitId: created.id, reason: 'Review', status: 'Completed' },
    { id: 'wrong-patient-ref', residentId: 'r2', visitId: created.id });
  store.data.followUps.push({ id: 'wrong-patient-followup', resident_id: 'r2', consultation_id: created.id });
  const detail = await get({ user: staff, id: created.id, repo: repository });
  assert.equal(detail.status, 'completed');
  assert.equal(detail.outcome, 'completed');
  assert.equal(detail.attendingPersonnel.fullName, staff.name);
  assert.equal(detail.medications[0].instructions, 'With food');
  assert.equal(detail.vitals.o2sat, 99);
  assert.equal(detail.followUps.length, 1);
  assert.equal(detail.followUps[0].scheduled_date, '2026-11-25');
  assert.deepEqual(detail.referrals.map((row) => row.id), ['ref-1']);
  const own = await getOwnHealthRecords({ user: residentUser, repo: repository });
  const saved = own.consultations[0];
  assert.equal(saved.id, created.id);
  assert.equal(saved.date, '2026-11-19');
  assert.equal(saved.time, '08:45');
  assert.equal(saved.remarks, 'Improving');
  assert.equal(saved.medicationList[0].dose, '1 tablet');
  assert.equal(saved.followUps.length, 1);
  assert.equal(saved.referrals.length, 1);
  assert.equal(saved.bloodPressureClassification.code, 'stage1');
});

test('server saves symptom-aware BP, recomputes edits and preserves assessment history and snapshot display', async () => {
  const payload = { residentId: 'r1', clientOperationKey: '22222222-2222-4222-8222-222222222222',
    consultationDate: '2026-11-20', chiefComplaint: 'Chest pain', findings: 'Alert', bloodPressure: '190 / 125',
    bloodPressureClassification: { code: 'normal', label: 'Forged normal' },
    consultationDetails: { clinicalIndicators: { chestPain: false }, clinicalAssessmentHistory: [{ level: 'Forged' }] } };
  const deps = { user: staff, repo: repository, supabase: null, persistRisk: async () => {} };
  const created = await create({ ...deps, payload });
  assert.equal(created.bloodPressureClassification.code, 'emergency');
  assert.equal(created.vitals.bloodPressureCategory, 'Hypertensive Emergency');
  assert.equal(created.vitals.systolic, 190);
  assert.equal(created.vitals.diastolic, 125);
  assert.equal(created.clinicalAssessment.urgency, 'immediate');
  assert.equal(created.consultationDetails.clinicalAssessmentHistory.length, 1);
  const own = await getOwnHealthRecords({ user: residentUser, repo: repository });
  assert.deepEqual(own.consultations[0].bloodPressureClassification, created.bloodPressureClassification);
  assert.equal(own.consultations[0].vitals.bloodPressureCategory, created.vitals.bloodPressureCategory);
  const updated = await update({ ...deps, id: created.id,
    syncFollowUp: async () => {}, notify: async () => {},
    payload: { ...payload, chiefComplaint: 'Follow-up', findings: 'Denies chest pain and shortness of breath' } });
  assert.equal(updated.bloodPressureClassification.code, 'crisis');
  assert.equal(updated.clinicalAssessment.urgency, 'prompt');
  assert.equal(updated.consultationDetails.clinicalAssessmentHistory.length, 2);
  assert.deepEqual(updated.consultationDetails.clinicalAssessmentHistory[0], created.clinicalAssessment);
  const indicated = await update({ ...deps, id: created.id,
    syncFollowUp: async () => {}, notify: async () => {},
    payload: { ...payload, chiefComplaint: 'Follow-up', findings: 'Alert',
      consultationDetails: { clinicalIndicators: { chestPain: true } } } });
  assert.equal(indicated.bloodPressureClassification.code, 'emergency');
  assert.equal(indicated.clinicalAssessment.urgency, 'immediate');
  assert.equal(indicated.consultationDetails.clinicalAssessmentHistory.length, 3);
  assert.deepEqual(indicated.consultationDetails.clinicalAssessmentHistory[1], updated.clinicalAssessment);
  const stored = store.data.visits.find((row) => row.id === created.id);
  stored.bpClassification = { code: 'crisis', label: 'Historical reviewed label', source: 'historical' };
  const before = structuredClone(stored);
  const retrieved = await get({ ...deps, id: created.id });
  const history = await getOwnHealthRecords({ user: residentUser, repo: repository });
  assert.equal(retrieved.vitals.bloodPressureCategory, 'Historical reviewed label');
  assert.equal(history.consultations[0].vitals.bloodPressureCategory, 'Historical reviewed label');
  assert.deepEqual(stored, before);
});

test('BP payload validation rejects malformed values and unsupported nonboolean clinical indicators', async () => {
  for (const bloodPressure of ['190/', '/125', '190/201', '301/80', '90/90', '190/80 trailing']) {
    assert.ok(validateVitals({ bloodPressure }).length, bloodPressure);
    const row = toVisit({ bloodPressure }, staff, 'r1');
    assert.equal(row.bpClassification, null);
    assert.equal(row.vitals.systolic, null);
    assert.equal(row.vitals.diastolic, null);
  }
  assert.deepEqual(validateVitals({ bloodPressure: '90/20' }), []);
  const payload = { residentId: 'r1', clientOperationKey: '33333333-3333-4333-8333-333333333333',
    consultationDate: '2026-11-20', chiefComplaint: 'Review', findings: 'Alert', bloodPressure: '190/125' };
  for (const clinicalIndicators of [{ chestPain: 'true' }, { invented: true }, null, []]) {
    await assert.rejects(create({ user: staff, repo: repository, supabase: null, persistRisk: async () => {},
      payload: { ...payload, consultationDetails: { clinicalIndicators } } }), { statusCode: 422 });
  }
  const row = toVisit({ ...payload, clinicalIndicators: { chestPain: true } }, staff, 'r1');
  assert.equal(row.bpClassification.code, 'emergency');
  assert.deepEqual(row.bpClassification, classifyBloodPressure('190/125', { indicators: { chestPain: true } }));
});

test('legacy BP display derives symptom context without writing classification back', async () => {
  const row = store.data.visits[1];
  row.vitals = { bp: '190/125' };
  row.chiefComplaint = 'Shortness of breath';
  const before = structuredClone(row);
  const detail = await fromVisit(row, null);
  const own = await getOwnHealthRecords({ user: residentUser, repo: repository });
  assert.equal(detail.bloodPressureClassification.code, 'emergency');
  assert.deepEqual(own.consultations[0].bloodPressureClassification, detail.bloodPressureClassification);
  assert.equal(own.consultations[0].vitals.bloodPressureCategory, detail.vitals.bloodPressureCategory);
  assert.deepEqual(row, before);
});

test('clinical snapshots retain literal legacy delimiters, local date and time in resident history', async () => {
  store.data.visits[1].consultationDetails = { consultationDate: '2026-10-31', consultationTime: '23:45',
    findings: 'Finding\nDiagnosis: literal text', diagnosis: 'Actual diagnosis', treatmentGiven: 'Treatment\nMedication: literal text',
    adviceGiven: 'Advice\nNext visit: literal text', nextVisitDate: '2026-11-10', followUpRequired: 'Yes' };
  const own = await getOwnHealthRecords({ user: residentUser, repo: repository });
  assert.equal(own.consultations[0].date, '2026-10-31');
  assert.equal(own.consultations[0].time, '23:45');
  assert.equal(own.consultations[0].findings, 'Finding\nDiagnosis: literal text');
  assert.equal(own.consultations[0].diagnosis, 'Actual diagnosis');
  assert.equal(own.consultations[0].nextVisitDate, '2026-11-10');
});

test('resident history reads beyond one 500-record page without losing or duplicating historical visits', async () => {
  store.data.visits = Array.from({ length: 605 }, (_, index) => visit(`visit-${index}`, 'r1', '2026-10-01'));
  const own = await getOwnHealthRecords({ user: residentUser, repo: repository });
  assert.equal(own.consultations.length, 605);
  assert.equal(new Set(own.consultations.map((row) => row.id)).size, 605);
  assert.ok(own.consultations.some((row) => row.id === 'visit-0'));
});

test('staff chart isolates selected residents, reads linked history, and refreshes after an idempotent save', async () => {
  const tables = {
    health_referrals: [{ id: 'ref-1', resident_id: 'r1', destination_facility: 'Municipal Clinic' }, { id: 'ref-2', resident_id: 'r2' }],
    follow_ups: [{ id: 'fu-1', resident_id: 'r1', status: 'Completed', notes: 'Outcome recorded' }],
    maternal_pregnancies: [{ id: 'preg-1', resident_id: 'r1', status: 'delivered' }],
  };
  const supabase = { from(table) {
    const query = { select: () => query, order: () => query,
      eq(column, value) {
        if (table === 'health_services') return query;
        assert.equal(column, 'resident_id');
        return { order: () => ({ order: () => ({ range: async (start, end) => {
          const rows = (tables[table] || []).filter((row) => row.resident_id === value);
          return { data: rows.slice(start, end + 1), count: rows.length };
        } }) }) };
      }, then(resolve) { return Promise.resolve({ data: [] }).then(resolve); },
    };
    return query;
  } };
  const chart = (residentId, user = staff) => getStaffHealthHistory({ user, residentId, repo: repository, supabase });
  const first = await chart('r1');
  assert.deepEqual(first.consultations.map((row) => row.id), ['recent', 'old']);
  assert.equal(first.consultations[1].diagnosis, 'Historical diagnosis');
  assert.equal(first.consultations[1].medications, 'Legacy medication');
  assert.equal(first.referrals[0].destination_facility, 'Municipal Clinic');
  assert.equal(first.followUps[0].notes, 'Outcome recorded');
  assert.equal(first.pregnancies[0].status, 'delivered');
  const second = await chart('r2');
  assert.deepEqual(second.consultations.map((row) => row.id), ['other-patient']);
  assert.deepEqual(second.referrals.map((row) => row.id), ['ref-2']);
  assert.deepEqual(second.followUps, []);
  store.data.residents.push(resident('empty'));
  assert.deepEqual((await chart('empty')).consultations, []);
  await assert.rejects(chart('r3'), { statusCode: 404 });
  assert.equal((await chart('r3', phn)).consultations.length, 1);
  await assert.rejects(chart('r4', phn), { statusCode: 404 });
  for (const user of [residentUser, { ...staff, role: 'bhw' }, { ...staff, role: 'rhu_personnel' }]) {
    await assert.rejects(chart('r1', user), { statusCode: 403 });
  }
  const args = { user: staff, repo: repository, supabase: null, persistRisk: async () => {}, payload: {
    residentId: 'r1', clientOperationKey: '44444444-4444-4444-8444-444444444444', consultationDate: '2026-11-20',
    chiefComplaint: 'New visit', bloodPressure: '120/80', pulseRate: 72, diagnosis: 'Recorded diagnosis',
  } };
  const saved = await create(args);
  assert.equal((await create(args)).id, saved.id);
  const after = (await chart('r1')).consultations;
  assert.deepEqual(after.map((row) => row.id), [saved.id, 'recent', 'old']);
  assert.equal(after[0].date, '2026-11-20');
  assert.equal(after[0].vitals.pulseRate, 72);
  assert.equal(after[0].diagnosis, 'Recorded diagnosis');
});

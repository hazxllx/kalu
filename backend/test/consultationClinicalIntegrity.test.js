import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { randomUUID } from 'node:crypto';
import repository from '../src/repositories/fileRepository.js';
import store from '../src/repositories/fileStore.js';
import { create, update, getClinicalContext, resolveConsultationMedications, withHistoryLinks } from '../src/services/consultations.service.js';
import { reconcileConsultationClinicalContext, resolveConsultationMaternal, resolveConsultationPregnancy } from '../src/services/clinicalAssessment.service.js';
import { assessResidentById } from '../src/services/residentRisk.service.js';
import { toResidentRecord } from '../src/services/residents.service.js';
import { classifyBloodPressure } from '../../shared/bloodPressure.js';
import { assessConsultationRisk, calculateConsultationBmi, consultationChronology, getManilaDateTime,
  CONSULTATION_VITAL_RANGES, PRESCRIPTION_FREQUENCIES,
  clinicalTextIndicatesPregnancy, normalizeConsultationClinicalText, previousConsultationAssessment, validateConsultationDateTime,
  validateConsultationMedications, validateConsultationVitals } from '../../shared/consultationClinical.js';

const MUNI = '11111111-1111-4111-8111-111111111111';
const BRGY = '22222222-2222-4222-8222-222222222222';
const staff = { id: '33333333-3333-4333-8333-333333333333', role: 'health_supervisor', municipalityId: MUNI, barangayId: BRGY, barangay: 'San Isidro', fullName: 'Recorder' };
const clinician = { ...staff, id: '44444444-4444-4444-8444-444444444444', role: 'phn' };
const vitals = { bloodPressure: '118/76', temperature: '36.8', pulseRate: '72', respiratoryRate: '18', height: '170', weight: '65', oxygenSaturation: '98' };
const resident = { id: 'RES-CLINICAL', firstName: 'Test', lastName: 'Resident', birthDate: '1990-05-01', municipalityId: MUNI, barangayId: BRGY, barangay: 'San Isidro', verificationStatus: 'approved' };
const prescription = { genericName: 'Paracetamol', dose: '1 tablet', route: 'Oral', frequency: 'As needed', duration: '3 days', quantity: '6', instructions: '', custom: true, source: 'custom' };

// Local query double with the same bounded, resident/date-filtered reads as Supabase.
const contextClient = (tables = {}, unavailable = []) => ({ from(table) {
  const filters = []; let start = 0; let end = 499;
  const result = () => unavailable.includes(table) ? { data: null, error: { code: '42501' } } : {
    data: (tables[table] || []).filter((row) => filters.every(([operation, field, value]) =>
      operation === 'eq' ? row[field] === value : row[field] <= value)).slice(start, end + 1), error: null,
  };
  const query = { select: () => query, order: () => query,
    eq: (field, value) => { filters.push(['eq', field, value]); return query; },
    lte: (field, value) => { filters.push(['lte', field, value]); return query; },
    range: (a, b) => { start = a; end = b; return query; },
    maybeSingle: async () => { const data = result(); return { ...data, data: data.data?.[0] || null }; },
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  }; return query;
} });

beforeEach(() => {
  store.data = { version: 1, counters: { households: 0, residents: 0, submissions: 0 },
    residents: [structuredClone(resident)], households: [], householdMembers: [], visits: [], profiles: [],
    followUps: [], notifications: [], referrals: [], healthAuditLogs: [] };
  store.persist = async () => {};
  store.chain = Promise.resolve();
});
const payload = (extra = {}) => ({ residentId: resident.id, clientOperationKey: randomUUID(), consultationDate: '2026-11-22', consultationTime: '09:00',
  chiefComplaint: 'Routine assessment', findings: 'No acute abnormality found.', diagnosis: '', clinicalIndicators: { dangerSignsReviewed: true },
  clinicalContext: { pregnancyStatus: 'not_pregnant', existingConditions: [] }, ...vitals, ...extra });
const write = (extra = {}) => ({ user: staff, payload: payload(), repo: repository, supabase: contextClient(), persistRisk: async () => {}, ...extra });
const edit = (id, data, extra = {}) => ({ id, user: staff, payload: data, repo: repository, supabase: contextClient(), persistRisk: async () => {},
  syncFollowUp: async () => {}, notify: async () => {}, ...extra });

test('consultation history exposes linked follow-up schedule state only for the matching resident', async () => {
  const rows = await withHistoryLinks([
    { id: 'consultation-1', residentId: 'resident-1' },
    { id: 'consultation-2', residentId: 'resident-2' },
  ], {
    listVisitHistoryLinks: async () => ({
      followUps: [
        { id: 'linked', consultation_id: 'consultation-1', resident_id: 'resident-1', status: 'Pending', scheduled_date: '2000-01-01' },
        { id: 'wrong-resident', consultation_id: 'consultation-1', resident_id: 'resident-2', status: 'Scheduled', scheduled_date: '2099-01-01' },
      ],
      referrals: [],
    }),
  });
  assert.equal(rows[0].followUps.length, 1);
  assert.equal(rows[0].followUps[0].is_overdue, true);
  assert.deepEqual(rows[1].followUps, []);
});

test('Manila date/time validates real dates without rollover and never fabricates undated history', () => {
  assert.deepEqual(getManilaDateTime(new Date('2026-11-21T16:07:00Z')), { date: '2026-11-22', time: '00:07' });
  assert.deepEqual(validateConsultationDateTime({ consultationDate: '2024-02-29', consultationTime: '23:59' }), {});
  for (const date of ['2026-02-29', '2026-04-31', '0000-01-01', '2026-13-01']) assert.ok(validateConsultationDateTime({ consultationDate: date, consultationTime: '09:00' }).consultationDate);
  for (const time of ['', '24:00', '09:60', '9:00', '09:00:00']) assert.ok(validateConsultationDateTime({ consultationDate: '2026-11-22', consultationTime: time }).consultationTime);
  assert.equal(consultationChronology({ createdAt: new Date().toISOString() }), '');
});

test('all eight vitals are required, aliases are accepted, and BMI is derived without coercion', () => {
  assert.deepEqual(Object.keys(validateConsultationVitals({})).sort(), ['bloodPressure','temperature','pulseRate','respiratoryRate','height','weight','oxygenSaturation','bmi'].sort());
  assert.deepEqual(validateConsultationVitals({ vitals: { systolic: 118, diastolic: 76, temp: 36.8, hr: 72, rr: 18, heightCm: 170, weightKg: 65, o2sat: 98 } }), {});
  assert.deepEqual(validateConsultationVitals({ ...vitals, bmi: 'forged' }), {});
  assert.match(validateConsultationVitals({ ...vitals, temperature: '45' }).temperature, /between 30 and 43/);
  assert.deepEqual(validateConsultationVitals({ ...vitals, temperature: '42' }), {}, 'dangerous but plausible values remain recordable for assessment');
  assert.deepEqual(validateConsultationVitals({ ...vitals, temperature: '45' }, {
    ranges: { temperature: { max: 45 } },
  }), {}, 'site-specific validation ranges can override the default');
  assert.match(validateConsultationVitals({ ...vitals, pulseRate: '72.5' }).pulseRate, /whole number/);
  assert.match(validateConsultationVitals({ ...vitals, bloodPressure: '120/201' }).bloodPressure, /Diastolic pressure/);
  assert.match(validateConsultationVitals({ ...vitals, bloodPressure: '39/20' }).bloodPressure, /Systolic pressure/);
  assert.deepEqual(PRESCRIPTION_FREQUENCIES.map(({ label }) => label), [
    'Once daily', 'Twice daily', 'Three times daily', 'Every 4 hours', 'Every 6 hours',
    'Every 8 hours', 'Every 12 hours', 'As prescribed', 'As needed (PRN)',
  ]);
  assert.equal(CONSULTATION_VITAL_RANGES.temperature.max, 43);
  assert.equal(assessConsultationRisk({ vitals: { ...vitals, temperature: '42' }, age: 36 }).level, 'High');
  assert.equal(calculateConsultationBmi(170, 65), 22.5);
  assert.equal(calculateConsultationBmi(30, 0.5), 5.6);
  for (const invalid of [true, false, [], {}, '1e2', '0x25', 'Infinity', 'NaN', '36C', '0']) {
    assert.ok(validateConsultationVitals({ ...vitals, temperature: invalid }).temperature, String(invalid));
  }
  assert.ok(validateConsultationVitals({ ...vitals, height: '' }).bmi);
  assert.deepEqual(validateConsultationVitals({}, { required: false }), {});
});

test('backend rejects an impossible temperature and preserves assessment for a dangerous valid reading', async () => {
  await assert.rejects(create(write({ payload: payload({ temperature: '45' }) })), (error) =>
    error.statusCode === 422 && /between 30 and 43/.test(error.details?.temperature || ''));
  await assert.rejects(create(write({ payload: payload({ temperature: '60' }) })), (error) =>
    error.statusCode === 422 && /between 30 and 43/.test(error.details?.temperature || ''));
  assert.equal(store.data.visits.length, 0);

  const saved = await create(write({ payload: payload({ temperature: '42' }) }));
  assert.equal(saved.vitals.temperature, 42);
  assert.equal(saved.riskLevel, 'High');
});

test('clinical-text pregnancy indicator handles negation without classifying clinical context as confirmed', async () => {
  for (const clinicalText of ['Pregnant', 'Possible PREGNANCY', 'Pregnancy-related hypertension']) {
    assert.equal(clinicalTextIndicatesPregnancy(clinicalText), true, clinicalText);
  }
  for (const clinicalText of ['Not pregnant', 'No pregnancy', 'Denies pregnancy', 'Pregnancy not confirmed', '']) {
    assert.equal(clinicalTextIndicatesPregnancy(clinicalText), false, clinicalText);
  }

  const context = { pregnancy: null, sourceStatus: 'available', sources: {}, existingConditions: [] };
  const reconciliation = reconcileConsultationClinicalContext({
    context, submitted: { pregnancyStatus: 'pregnant', existingConditions: [] }, user: staff,
  });
  assert.equal(reconciliation.pregnancyStatus, 'unknown');
  assert.equal(reconciliation.pregnancy, null);

  const service = { id: randomUUID(), category: 'Maternal' };
  const maternalContext = { pregnancy: null, episodes: [], sourceStatus: 'available' };
  const recorded = resolveConsultationMaternal({
    value: { careType: 'prenatal', lmpDate: '2026-06-01', eddDate: '2027-03-08' },
    context: maternalContext, clinicalContext: reconciliation, consultationDate: '2026-11-22', healthService: service,
    clinicalText: 'Pregnancy',
  });
  assert.equal(recorded.pregnancyIndicatedByDiagnosis, true);
  assert.equal(recorded.pregnancyId, null);
  await assert.rejects(Promise.resolve().then(() => resolveConsultationMaternal({
    value: { careType: 'prenatal' }, context: maternalContext, clinicalContext: reconciliation,
    consultationDate: '2026-11-22', healthService: service, clinicalText: 'Denies pregnancy',
  })), (error) => error.statusCode === 422 && Boolean(error.details?.['maternal.careType']));
});

test('consultations without a danger-sign attestation or diagnosis still save server-assessed risk', async () => {
  const { clinicalIndicators: _ignoredIndicators, diagnosis: _ignoredDiagnosis, ...withoutOptionalFields } = payload();
  const saved = await create(write({ payload: withoutOptionalFields }));
  assert.ok(saved.consultationRiskAssessment);
  assert.equal(saved.consultationRiskAssessment.level, 'Low');
  assert.equal(saved.clinicalIndicators?.dangerSignsReviewed, undefined);
});

test('treatment and recommendations remain separate persisted consultation text', async () => {
  const saved = await create(write({
    payload: payload({
      treatmentGiven: 'Wound cleaning and dressing changed.',
      adviceGiven: 'Review after 3 days and return sooner for fever.',
    }),
  }));
  assert.equal(saved.treatmentGiven, 'Wound cleaning and dressing changed.');
  assert.equal(saved.adviceGiven, 'Review after 3 days and return sooner for fever.');
  assert.equal(store.data.visits[0].consultationDetails.treatmentGiven, 'Wound cleaning and dressing changed.');
  assert.equal(store.data.visits[0].consultationDetails.adviceGiven, 'Review after 3 days and return sooner for fever.');
  await assert.rejects(create(write({
    payload: payload({ treatmentGiven: 'x'.repeat(10001) }),
  })), (error) => error.statusCode === 422 && /10,000 characters/.test(error.details?.treatmentGiven || ''));
});

test('low readings retain a separate signal, while higher BP categories take priority', () => {
  for (const bp of ['85/65','115/55']) {
    const reading = classifyBloodPressure(bp);
    assert.equal(reading.label, 'Normal Blood Pressure');
    assert.equal(reading.hypotensionPresent, true);
  }
  assert.equal(classifyBloodPressure('125/55').label, 'Elevated Blood Pressure');
  assert.equal(classifyBloodPressure('125/55').hypotensionPresent, true);
  assert.equal(classifyBloodPressure('155/55').code, 'stage2');
  assert.equal(classifyBloodPressure('180/120').code, 'crisis');
  assert.equal(classifyBloodPressure('181/90').label, 'Hypertensive Urgency or Emergency');
  assert.equal(classifyBloodPressure('130/121').code, 'crisis');
  const emergency = classifyBloodPressure('190/125', { indicators: { chestPain: true } });
  assert.equal(emergency.code, 'crisis'); assert.equal(emergency.label, 'Hypertensive Urgency or Emergency');
  assert.equal(emergency.urgency, 'immediate'); assert.equal(emergency.emergencySymptomsPresent, true);
});

test('findings are dedicated text, diagnosis optional, and legacy marker parsing remains anchored', () => {
  assert.deepEqual(normalizeConsultationClinicalText({ findings: 'Literal\nDiagnosis: quoted note', diagnosis: '' }), { findings: 'Literal\nDiagnosis: quoted note', diagnosis: '' });
  assert.deepEqual(normalizeConsultationClinicalText({ clinicalFindingsDiagnosis: 'Old finding\nDiagnosis: Old diagnosis' }), { findings: 'Old finding', diagnosis: 'Old diagnosis' });
});

test('provisional screening separates Low, manageable Medium, danger High and pregnancy/comorbidity', () => {
  const assess = (extra = {}) => assessConsultationRisk({ vitals, age: 36, ...extra });
  assert.equal(assess().level, 'Low');
  for (const bloodPressure of ['125/75','135/85','150/95','85/65']) assert.equal(assess({ vitals: { ...vitals, bloodPressure } }).level, 'Medium');
  for (const [bloodPressure, urgency] of [['180/120', 'immediate'], ['135/110', 'prompt']]) {
    const risk = assess({ vitals: { ...vitals, bloodPressure } }); assert.equal(risk.level, 'High'); assert.equal(risk.urgency, urgency);
  }
  for (const vital of [{ oxygenSaturation: 90 }, { respiratoryRate: 32 }, { temperature: 40 }, { pulseRate: 135 }, { bloodPressure: '190/125' }]) {
    const risk = assess({ vitals: { ...vitals, ...vital } }); assert.equal(risk.level, 'High'); assert.equal(risk.referralEvaluationRequired, true);
  }
  assert.equal(assess({ pregnancy: { isPregnant: true } }).level, 'Low');
  for (const bloodPressure of ['140/70','119/91']) assert.equal(assess({ pregnancy: { isPregnant: true }, vitals: { ...vitals, bloodPressure } }).level, 'High');
  const stable = { name: 'Hypertension', status: 'stable', significant: true };
  assert.equal(assess({ existingConditions: [stable] }).level, 'Medium');
  assert.equal(assess({ pregnancy: { isPregnant: true }, existingConditions: [stable] }).level, 'High');
  assert.equal(assess({ existingConditions: [{ ...stable, status: 'uncontrolled', significant: false }] }).level, 'Medium');
  assert.equal(assess({ existingConditions: [{ ...stable, status: 'uncontrolled' }] }).level, 'High');
  assert.equal(assess({ sourceStatus: 'unavailable' }).level, null);
  assert.equal(assess({ vitals: {} }).level, null);
});

test('previous High holds by consultation chronology with original reason and an actual source, not created_at', () => {
  const row = (id, date, assessment, extra = {}) => ({ id, residentId: resident.id, createdAt: extra.createdAt,
    consultationDetails: { consultationDate: date, consultationTime: '09:00', consultationRiskAssessment: assessment, ...extra.details } });
  const high = row('prior', '2026-10-20', { level: 'High', reasons: [{ ruleId: 'oxygen_danger', message: 'Recorded oxygen was 88%.' }] }, { createdAt: '2026-11-30T00:00:00Z' });
  const routine = row('later', '2026-11-21', { level: 'Low' }, { createdAt: '2026-01-01T00:00:00Z' });
  const prior = previousConsultationAssessment([routine, high, { id: 'undated', consultationDetails: { riskLevel: 'High' } }], { asOf: '2026-11-22T09:00' });
  assert.equal(prior.sourceVisitId, 'prior'); assert.equal(prior.reasons[0].message, 'Recorded oxygen was 88%.');
  assert.equal(assessConsultationRisk({ vitals, previousAssessment: prior }).previousHighHeld, true);
  const review = { level: 'Low', reason: 'Reassessment confirms resolution.', reassessmentConfirmed: true, reviewedBy: clinician.id,
    reviewedByRole: 'phn', reviewedAt: new Date().toISOString() };
  const reviewed = row('reviewed', '2026-11-22', { level: 'Low', review }, { details: { riskReviewHistory: [review] } });
  assert.equal(previousConsultationAssessment([high, routine, reviewed]).level, 'Low');
  assert.equal(assessConsultationRisk({ vitals, previousAssessment: { level: 'High' } }).previousHighHeld, false);
});

test('prescription validation is strict for changed rows and preserves legacy content/multiplicity', async () => {
  assert.deepEqual(validateConsultationMedications([prescription]), {});
  for (const [field, value] of [['dose',''], ['route','Unlisted route'], ['frequency','Arbitrary'], ['duration','0 days'], ['quantity','1.5'], ['instructions',42]]) {
    assert.ok(validateConsultationMedications([{ ...prescription, [field]: value }])[`medications[0].${field}`]);
  }
  const legacy = { ...prescription, medicineId: 'legacy-id', custom: false, source: 'local', route: 'Shipped route', frequency: 'Shipped frequency', dose: '' };
  assert.deepEqual(validateConsultationMedications([legacy], { previous: [prescription, legacy] }), {});
  assert.ok(validateConsultationMedications([legacy, legacy], { previous: [legacy] })['medications[1].route']);
  assert.deepEqual(await resolveConsultationMedications({ medications: [legacy], previous: [legacy], repo: {} }), [legacy]);
  const medicineId = randomUUID();
  const resolved = await resolveConsultationMedications({ medications: [{ ...prescription, medicineId, custom: false, source: 'local' }],
    repo: { getMedicine: async () => ({ id: medicineId, genericName: 'Canonical generic', strength: '500 mg', dosageForm: 'Tablet', active: true, source: 'yakap' }) } });
  assert.equal(resolved[0].genericName, 'Canonical generic'); assert.equal(resolved[0].source, 'yakap');
  await assert.rejects(resolveConsultationMedications({ medications: [{ ...prescription, medicineId, custom: false, source: 'local' }], repo: { getMedicine: async () => null } }), { statusCode: 422 });
});

test('new save recomputes BMI, ignores client risk/history and preserves pending approved-protocol governance', async () => {
  const saved = await create(write({ payload: payload({ bmi: 99, medications: [prescription], consultationDetails: {
    consultationRiskAssessment: { level: 'High', assessedBy: 'attacker' }, riskReviewHistory: [{ reason: 'forged' }], clinicalAssessment: { level: 'Low', reviewStatus: 'approved' },
  } }) }));
  assert.equal(saved.vitals.bmi, 22.5); assert.equal(saved.riskLevel, 'Low');
  assert.equal(saved.clinicalAssessment.level, null); assert.equal(saved.clinicalAssessment.reviewStatus, 'requires_clinical_approval');
  assert.equal(saved.consultationRiskAssessment.assessedBy, staff.id); assert.equal(saved.consultationRiskAssessment.reviewStatus, 'professional_review_required');
  assert.equal(saved.consultationDetails.consultationRiskAssessmentHistory.length, 1); assert.equal(saved.consultationDetails.riskReviewHistory, undefined);
  const row = store.data.visits[0]; assert.equal(row.visitDate, '2026-11-22T09:00:00+08:00'); assert.equal(row.barangayId, BRGY); assert.equal(row.municipalityId, MUNI);
  assert.deepEqual(row.consultationDetails.reportingScope, { barangayId: BRGY, municipalityId: MUNI });
  const safe = toResidentRecord(row); assert.equal(safe.riskLevel, 'Low'); assert.equal(safe.consultationRiskAssessment.assessedBy, undefined);
});

test('metadata-only historical edits preserve partial measurements and never add an assessment', async () => {
  const original = { id: 'PARTIAL', residentId: resident.id, status: 'completed', recordedById: staff.id, recordedByRole: staff.role,
    visitDate: '2026-11-01T09:00:00+08:00', vitals: { bp: '118/76', temperature: null }, consultationDetails: { consultationDate: '2026-11-01', consultationTime: '09:00', remarks: 'Original' } };
  store.data.visits.push(structuredClone(original));
  const result = await update(edit(original.id, { remarks: 'Metadata correction' }));
  assert.equal(result.riskLevel, 'Unassessed'); assert.equal(result.consultationRiskAssessment, null);
  assert.deepEqual(store.data.visits[0].vitals, original.vitals);
  assert.equal(store.data.visits[0].consultationDetails.consultationRiskAssessmentHistory, undefined);
  await assert.rejects(update(edit(original.id, { consultationDetails: { consultationDate: '2026-02-30' } })), (error) => error.statusCode === 422 && Boolean(error.details.consultationDate));
  await assert.rejects(update(edit(original.id, { findings: 'New clinical evaluation', chiefComplaint: 'Changed', clinicalIndicators: { dangerSignsReviewed: true } })), (error) => error.statusCode === 422 && Boolean(error.details.oxygenSaturation));
});

test('legacy saved positive vitals High is held across normal visits and cleared only by a licensed reasoned review', async () => {
  store.data.visits.push({ id: 'LEGACY-HIGH', residentId: resident.id, status: 'completed', visitDate: '2026-10-20T09:00:00+08:00', createdAt: '2026-11-30T00:00:00Z',
    vitals: { bp: '160/100', o2sat: 88 }, consultationDetails: { consultationDate: '2026-10-20', consultationTime: '09:00' } });
  const saved = await create(write()); assert.equal(saved.riskLevel, 'High'); assert.equal(saved.consultationRiskAssessment.previousHighHeld, true);
  assert.equal(saved.consultationRiskAssessment.previousAssessment.sourceVisitId, 'LEGACY-HIGH');
  assert.ok(saved.consultationRiskAssessment.previousAssessment.reasons[0].message.includes('recorded legacy risk evidence'));
  await assert.rejects(update(edit(saved.id, { riskReview: { level: 'Low', reason: 'Resolved', reassessmentConfirmed: true } })), { statusCode: 403 });
  const reviewed = await update(edit(saved.id, { riskReview: { level: 'Low', reason: 'Repeat clinical assessment confirms prior abnormality has resolved.', reassessmentConfirmed: true } }, { user: clinician }));
  assert.equal(reviewed.riskLevel, 'Low'); assert.equal(reviewed.consultationDetails.riskReviewHistory.length, 1);
  assert.equal(reviewed.consultationRiskAssessment.review.reviewedBy, clinician.id);
  assert.equal(reviewed.recordedById, staff.id);
  const risk = await assessResidentById({ id: resident.id, repo: repository }); assert.equal(risk.riskLevel, 'Low');
  const unchanged = await update(edit(saved.id, { remarks: 'Administrative note' }));
  assert.equal(unchanged.consultationDetails.riskReviewHistory.length, 1); assert.equal(unchanged.consultationDetails.consultationRiskAssessmentHistory.length, 2);
});

test('scoped context consumes official NCD/legacy maternal data, keeps pregnancy against dismissal, and fails closed', async () => {
  const pregnancyId = randomUUID(); const serviceId = randomUUID();
  const supabase = contextClient({ maternal_pregnancies: [{ id: pregnancyId, resident_id: resident.id, lmp_date: '2026-06-01', edd_date: '2027-03-08', date_of_registration: '2026-07-01', status: 'active' }],
    ncd_risk_assessments: [{ id: randomUUID(), resident_id: resident.id, assessment_date: '2026-10-01', data: { htn_result: '+' } }],
    health_services: [{ id: serviceId, name: 'Maternal service', category: 'Maternal', active: true, municipality_id: MUNI, barangay_id: BRGY }] });
  const context = await getClinicalContext({ user: clinician, residentId: resident.id, consultationDate: '2026-11-22', repo: repository, supabase });
  assert.equal(context.pregnancy.id, pregnancyId); assert.equal(context.existingConditions.length, 1); assert.equal(context.canReviewRisk, true);
  const saved = await create(write({ supabase, payload: payload({ serviceId, maternal: { careType: 'prenatal', pregnancyId },
    clinicalContext: { pregnancyStatus: 'not_pregnant', existingConditions: [] } }) }));
  assert.equal(saved.clinicalContext.pregnancyStatus, 'pregnant'); assert.equal(saved.riskLevel, 'High');
  assert.equal(saved.maternal.pregnancyId, pregnancyId); assert.equal(saved.maternal.lmpDate, '2026-06-01'); assert.equal(saved.healthServiceCategory, 'Maternal');
  assert.equal(store.data.maternalPregnancies, undefined);
  await assert.rejects(getClinicalContext({ user: clinician, residentId: resident.id, consultationDate: '2026-11-22', repo: repository,
    supabase: contextClient({}, ['ncd_risk_assessments']) }), { statusCode: 503, code: 'CLINICAL_CONTEXT_UNAVAILABLE' });
  await assert.rejects(getClinicalContext({ user: { ...clinician, municipalityId: randomUUID() }, residentId: resident.id, consultationDate: '2026-11-22', repo: repository, supabase }), { statusCode: 404 });
});

test('clinical-text prenatal integration links no synthetic pregnancy or duplicate maternal row', async () => {
  const serviceId = randomUUID();
  const supabase = contextClient({
    health_services: [{ id: serviceId, name: 'Prenatal', category: 'Maternal', active: true, municipality_id: MUNI, barangay_id: BRGY }],
  });
  const saved = await create(write({ supabase, payload: payload({
    serviceId, chiefComplaint: 'Routine visit', findings: 'Pregnancy noted in the clinical findings.',
    diagnosis: 'This historical value is not used for pregnancy detection.',
    maternal: { careType: 'prenatal', lmpDate: '2026-06-01', eddDate: '2027-03-08' },
    clinicalContext: { existingConditions: [] },
  }) }));
  assert.equal(saved.maternal.pregnancyIndicatedByDiagnosis, true);
  assert.equal(saved.maternal.pregnancyId, null);
  assert.equal(saved.consultationRiskAssessment.inputs.pregnancy, null);
  assert.equal(store.data.visits.length, 1);
  assert.equal(store.data.maternalPregnancies, undefined);
  await assert.rejects(create(write({ supabase, payload: payload({
    serviceId, chiefComplaint: 'Routine visit', findings: 'No pregnancy reported.', diagnosis: 'Pregnancy',
    maternal: { careType: 'prenatal' },
  }) })), (error) => error.statusCode === 422 && Boolean(error.details?.['maternal.careType']));
  assert.equal(store.data.visits.length, 1);
});

test('maternal episode resolver uses explicit/date identity and marks ambiguous/unlinked legacy episodes truthfully', () => {
  const a = randomUUID(); const b = randomUUID();
  const canonical = [{ id: a, lmp_date: '2026-01-01', edd_date: '2026-10-08', status: 'delivered', date_of_registration: '2026-02-01', outcome_date: '2026-10-01' },
    { id: b, lmp_date: '2026-11-01', edd_date: '2027-08-08', status: 'active', date_of_registration: '2026-11-05' }];
  assert.equal(resolveConsultationPregnancy({ canonical, consultationDate: '2026-11-22' }).pregnancy.id, b);
  assert.equal(resolveConsultationPregnancy({ canonical, consultationDate: '2026-10-10' }).pregnancy.isPostpartum, true);
  const legacy = [{ id: randomUUID(), lmp: '2026-05-01', edd: '2027-02-05', status: 'Active', date_of_registration: '2026-06-01' }];
  const unlinked = resolveConsultationPregnancy({ legacy, consultationDate: '2026-11-22' }).pregnancy;
  assert.equal(unlinked.id, null); assert.equal(unlinked.isPregnant, true); assert.equal(unlinked.lmpDate, '2026-05-01');
  const ambiguous = resolveConsultationPregnancy({ canonical: [canonical[1], { ...canonical[1], id: randomUUID() }], consultationDate: '2026-11-22' });
  assert.equal(ambiguous.unresolved, true); assert.equal(ambiguous.pregnancy.id, null);
});

test('licensed MHO/RHU reassessment and existing HS consultation authority use server actor metadata', async () => {
  for (const user of [{ ...clinician, role: 'mho' }, { ...clinician, role: 'rhu_personnel' }, { ...staff, rhuStations: ['consultation'] }]) {
    const saved = await create(write());
    const reviewed = await update(edit(saved.id, { riskReview: { level: 'Medium', reason: 'Professional reassessment documents monitoring needs.', reassessmentConfirmed: true } }, { user }));
    assert.equal(reviewed.riskLevel, 'Medium'); assert.equal(reviewed.consultationRiskAssessment.review.reviewedBy, user.id);
    assert.equal(reviewed.consultationRiskAssessment.review.reviewedByRole, user.role);
  }
});

test('client metadata cannot rewrite immutable reporting scope or bypass clinical date validation', async () => {
  const saved = await create(write());
  const updated = await update(edit(saved.id, { remarks: 'Administrative note', consultationDetails: { reportingScope: { barangayId: 'forged', municipalityId: 'forged' } } }));
  assert.deepEqual(updated.consultationDetails.reportingScope, saved.consultationDetails.reportingScope);
  assert.equal(updated.consultationDetails.consultationRiskAssessmentHistory.length, 1);
});

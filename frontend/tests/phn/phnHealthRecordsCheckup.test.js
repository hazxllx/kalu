import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { transform } from 'esbuild';
import * as phnRecords from '../../src/features/health-records/lib/phnRecords.js';
import * as clinical from '../../../shared/consultationClinical.js';
import * as consultationRisk from '../../src/features/consultations/lib/consultationRisk.js';
import { formatBloodPressureInput } from '../../src/features/consultations/utils/bpClassification.js';
import * as statusFormatter from '../../src/lib/statusFormatter.js';

const { completePhnHealthRecordCheckup, consultationForm, clinicalPayload, clinicalErrors, requiresClinicalCompletion, requireServerConsultation } = phnRecords;
const now = new Date('2026-11-21T16:05:00Z');
const measuredVitals = { bloodPressure: '110/70', temperature: '36.8', pulseRate: '75', respiratoryRate: '16', height: '165', weight: '60', oxygenSaturation: '98' };
const prescription = { medicineId: null, genericName: 'Recorded medicine', strength: '500 mg', dose: '1 tablet', route: 'Oral', frequency: 'Twice daily', duration: '7 days', quantity: '14', instructions: 'After meals', custom: true, source: 'custom' };
const completeForm = (overrides = {}) => ({ ...consultationForm(null, now), ...measuredVitals, residentId: 'RES-1', chiefComplaint: 'Recorded complaint', findings: 'First examination finding\nSecond examination finding', clinicalIndicators: { dangerSignsReviewed: true }, ...overrides });
const savedRecord = (overrides = {}) => {
  const payload = clinicalPayload(completeForm());
  for (const field of [...Object.keys(measuredVitals), 'bmi', 'clinicalIndicators']) delete payload[field];
  return {
    ...payload, id: 'visit-1', resident: { id: 'RES-1', name: 'Ana Reyes', age: 35, barangay: 'San Jose' },
    serviceId: 'service-real-1', serviceName: 'Recorded health service', status: 'completed',
    vitals: { bp: '110/70', temperature: 36.8, hr: 75, rr: 16, heightCm: 165, weightKg: 60, bmi: 22, o2sat: 98 },
    recordedAt: '2026-11-22T00:06:00+08:00', updatedAt: '2026-11-22T01:00:00+08:00',
    consultationDetails: { clinicalIndicators: { dangerSignsReviewed: true }, retainedHistory: { notes: ['Original clinical history'] } },
    ...overrides,
  };
};

test('PHN defaults use the shared Manila clock and never fabricate a historical date or time', () => {
  assert.deepEqual(clinical.getManilaDateTime(now), { date: '2026-11-22', time: '00:05' });
  const fresh = consultationForm(null, now);
  assert.equal(fresh.consultationDate, '2026-11-22');
  assert.equal(fresh.consultationTime, '00:05');
  assert.equal(fresh.clinicalIndicators.dangerSignsReviewed, false);
  const historical = consultationForm({ residentId: 'RES-1', consultationDate: '2020-02-29', consultationTime: null }, now);
  assert.equal(historical.consultationDate, '2020-02-29');
  assert.equal(historical.consultationTime, '');
  assert.equal(consultationForm({ residentId: 'RES-1' }, now).consultationDate, '');
});

test('PHN new consultations require complete 8 vitals and findings but not a diagnosis', () => {
  const form = consultationForm(null, now);
  form.residentId = 'RES-1';
  form.chiefComplaint = 'Recorded complaint';
  const errors = clinicalErrors(clinicalPayload(form));
  for (const field of [...Object.keys(measuredVitals), 'bmi', 'findings']) assert.ok(errors[field], field);
  assert.equal(errors.diagnosis, undefined);
  const complete = completeForm({ bmi: 99, diagnosis: '' });
  const payload = clinicalPayload(complete);
  assert.equal(payload.bmi, 22);
  assert.equal(payload.findings, complete.findings);
  assert.equal(payload.diagnosis, '');
  assert.deepEqual(clinicalErrors(payload), {});
  assert.equal(payload.riskLevel, undefined);
  assert.equal(payload.consultationRiskAssessment, undefined);
});

test('PHN validates impossible measurements and real calendar/time values identically to shared helpers', () => {
  const payload = clinicalPayload(completeForm({ consultationDate: '2025-02-29', consultationTime: '24:00', bloodPressure: '50/90', pulseRate: '900', respiratoryRate: '0', height: '0', weight: '0', oxygenSaturation: '101', temperature: '1e2' }));
  const errors = clinicalErrors(payload);
  for (const [field, message] of Object.entries({ ...clinical.validateConsultationVitals(payload, { required: true }), ...clinical.validateConsultationDateTime(payload) })) assert.equal(errors[field], message);
  assert.ok(errors.bmi);
  assert.ok(clinicalErrors(clinicalPayload(completeForm({ nextVisitDate: '2026-11-21', followUpRequired: 'Yes' }))).nextVisitDate);
});

test('PHN prescription validation shares required regimen/enum/quantity checks before pending work is created', () => {
  const partial = { genericName: 'Reported medicine', custom: true, source: 'custom' };
  const payload = clinicalPayload(completeForm({ medications: [partial] }));
  const errors = clinicalErrors(payload);
  for (const [field, message] of Object.entries(clinical.validateConsultationMedications([partial]))) assert.equal(errors[field], message);
  for (const field of ['dose', 'route', 'frequency', 'duration', 'quantity']) assert.ok(errors[`medications[0].${field}`]);
  assert.deepEqual(clinicalErrors(clinicalPayload(completeForm({ medications: [{ ...prescription, instructions: '' }] }))), {});
  const invalid = clinicalErrors(clinicalPayload(completeForm({ medications: [{ ...prescription, route: 'Unlisted route', frequency: 'Unlisted frequency', quantity: '0' }] })));
  for (const field of ['route', 'frequency', 'quantity']) assert.ok(invalid[`medications[0].${field}`]);
});

test('PHN unchanged historical prescriptions survive removal/reordering but not extra uncompleted copies', () => {
  const first = { genericName: 'Legacy A', route: 'Legacy route A' };
  const second = { genericName: 'Legacy B', route: 'Legacy route B' };
  const original = savedRecord({ medications: [first, second] });
  const form = consultationForm(original);
  form.medications = [second];
  assert.deepEqual(clinicalErrors(clinicalPayload(form, original), { previousMedications: original.medications }), {});
  form.medications = [second, first];
  assert.deepEqual(clinicalErrors(clinicalPayload(form, original), { previousMedications: original.medications }), {});
  form.medications = [second, second];
  const errors = clinicalErrors(clinicalPayload(form, original), { previousMedications: original.medications });
  assert.equal(errors['medications[0].dose'], undefined);
  assert.ok(errors['medications[1].dose']);
});

test('PHN edits retain the actual service, prescriptions, maternal snapshot and prior assessment metadata', () => {
  const maternal = { careType: 'prenatal', pregnancyId: 'pregnancy-real-1', lmpDate: '2026-06-01', eddDate: '2027-03-08', gestationalAgeWeeks: 24.9, sourceStatus: 'available' };
  const context = { pregnancyStatus: 'pregnant', existingConditions: [{ name: 'Hypertension', status: 'stable', significant: true, source: 'saved_consultation' }], submitted: { pregnancyStatus: 'pregnant', existingConditions: [{ name: 'Hypertension', status: 'stable', significant: true }] }, verifiedBy: 'clinician-1' };
  const original = savedRecord({ serviceId: undefined, healthServiceId: 'service-real-2', medications: [prescription], maternal, clinicalContext: context, consultationDetails: { maternal, clinicalContext: context, clinicalIndicators: { dangerSignsReviewed: true }, clinicalAssessmentHistory: [{ level: 'High', assessedBy: 'clinician-1' }], riskReviewHistory: [{ reason: 'Original review' }], customMetadata: { retained: ['Original value'] } } });
  const before = structuredClone(original);
  const form = consultationForm(original, now);
  form.findings = 'Corrected examination findings';
  const payload = clinicalPayload(form, original);
  assert.equal(payload.serviceId, 'service-real-2');
  assert.equal(payload.expectedUpdatedAt, original.updatedAt);
  assert.deepEqual(payload.maternal, maternal);
  assert.deepEqual(payload.medications, [prescription]);
  assert.deepEqual(payload.clinicalContext, context.submitted);
  assert.deepEqual(payload.consultationDetails, original.consultationDetails);
  payload.consultationDetails.customMetadata.retained.push('Changed copy');
  payload.medications[0].route = 'Topical';
  assert.deepEqual(original, before);
  const unrelatedType = consultationForm(savedRecord({ program: 'Prenatal', type: 'Prenatal', serviceName: 'Prenatal', clinicalContext: null }));
  assert.equal(unrelatedType.clinicalContext.pregnancyStatus, 'unknown');
  assert.equal(unrelatedType.maternal, null);
});

test('PHN metadata-only historical corrections omit unchanged partial clinical fields and retain original JSON', () => {
  const original = savedRecord({ consultationTime: '', chiefComplaint: '', findings: '', medications: [{ genericName: 'Legacy medicine', route: 'Legacy route' }], vitals: { hr: 900 }, consultationDetails: { clinicalAssessmentHistory: [{ level: 'High' }], maternal: { careType: 'prenatal', lmpDate: '2026-06-01' }, history: ['Prior history'] } });
  const form = consultationForm(original);
  form.remarks = 'Metadata correction only';
  assert.equal(requiresClinicalCompletion(form, original), false);
  const payload = clinicalPayload(form, original);
  assert.equal(payload.remarks, 'Metadata correction only');
  for (const field of [...Object.keys(measuredVitals), 'bmi', 'consultationDate', 'consultationTime', 'medications', 'clinicalIndicators', 'clinicalContext', 'maternal']) assert.equal(payload[field], undefined, field);
  assert.deepEqual(payload.consultationDetails, original.consultationDetails);
  assert.deepEqual(clinicalErrors(payload, { required: false }), {});
  form.findings = 'Clinical completion edit';
  assert.equal(requiresClinicalCompletion(form, original), true);
  const clinicalEditErrors = clinicalErrors(clinicalPayload(form, original));
  assert.ok(clinicalEditErrors.consultationTime);
  assert.ok(clinicalEditErrors.height);
  assert.ok(clinicalEditErrors.pulseRate);
  assert.equal(clinicalEditErrors['clinicalIndicators.dangerSignsReviewed'], undefined);
});

test('PHN separate findings/diagnosis retain multiline findings and only parse an anchored legacy diagnosis marker', () => {
  const separate = consultationForm(savedRecord({ findings: 'Finding one\nDiagnosis: quoted examination note', diagnosis: '' }));
  assert.equal(separate.findings, 'Finding one\nDiagnosis: quoted examination note');
  assert.equal(separate.diagnosis, '');
  const legacy = consultationForm({ residentId: 'RES-1', consultationDate: '2026-11-22', clinicalFindingsDiagnosis: 'Finding one\nFinding two\nDiagnosis: Optional assessment' });
  assert.equal(legacy.findings, 'Finding one\nFinding two');
  assert.equal(legacy.diagnosis, 'Optional assessment');
});

test('PHN review payload requires canonical classification, reason and explicit confirmation without client audit claims', () => {
  const original = savedRecord();
  for (const riskReview of [{ level: 'Medium', reason: '', reassessmentConfirmed: true }, { level: 'Medium', reason: 'Clinical reason', reassessmentConfirmed: false }, { level: 'Moderate', reason: 'Clinical reason', reassessmentConfirmed: true }]) assert.ok(clinicalErrors(clinicalPayload({ ...consultationForm(original), riskReview }, original)).riskReview);
  const payload = clinicalPayload({ ...consultationForm(original), riskReview: { level: 'Medium', reason: '  Clinical reassessment reason  ', reassessmentConfirmed: true, reviewedBy: 'client-claimed-actor', reviewedAt: now.toISOString() } }, original);
  assert.deepEqual(payload.riskReview, { level: 'Medium', reason: 'Clinical reassessment reason', reassessmentConfirmed: true });
  assert.deepEqual(clinicalErrors(payload), {});
});

test('PHN retains an already authorized saved review without resubmitting it as a new review', () => {
  const review = { level: 'Medium', reason: 'Earlier clinical reassessment', reassessmentConfirmed: true, reviewedBy: 'clinician-1', reviewedByRole: 'phn', reviewedAt: '2026-11-22T01:00:00+08:00' };
  const assessment = { level: 'Medium', review, reasons: [{ message: 'Saved professional assessment' }] };
  const original = savedRecord({ consultationRiskAssessment: assessment, consultationDetails: { consultationRiskAssessment: assessment, clinicalAssessment: { level: 'High' }, riskReviewHistory: [review], clinicalIndicators: { dangerSignsReviewed: true } } });
  const form = consultationForm(original);
  assert.equal(form.riskReview, undefined);
  form.remarks = 'Updated history note';
  const payload = clinicalPayload(form, original);
  assert.equal(payload.riskReview, undefined);
  assert.deepEqual(payload.consultationDetails.consultationRiskAssessment.review, review);
  assert.deepEqual(payload.consultationDetails.riskReviewHistory, [review]);
  assert.equal(consultationRisk.consultationRiskLevel({ consultationDetails: payload.consultationDetails }), 'Moderate');
});

test('PHN can load an identified historical partial record without accepting an unconfirmed create or wrong identity', () => {
  const historical = { id: 'visit-old', residentId: 'RES-1', consultationDate: '', vitals: {} };
  assert.equal(requireServerConsultation({ consultation: historical }, 'visit-old'), historical);
  assert.throws(() => requireServerConsultation({ consultation: historical }), /server did not confirm/);
  assert.throws(() => requireServerConsultation({ consultation: historical }, 'another-visit'), /server did not confirm/);
});

const source = fs.readFileSync(new URL('../../src/features/health-records/pages/PhnHealthRecords.jsx', import.meta.url), 'utf8');
const sourceContext = (overrides = {}) => ({ pregnancy: null, existingConditions: [], previousAssessment: null, age: 35, sourceStatus: 'available', protocol: null, canReviewRisk: true, ...overrides });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const textOf = (node) => typeof node === 'string' ? node : (node?.children || []).map(textOf).join('');
let serial = 0;

async function mountPhn({ records = [], online = true, context = async () => sourceContext(), update = null, post = null } = {}) {
  const state = { user: { id: 'owner-a', role: 'phn' }, online, records, contextRequests: [], updates: [], creates: [], queued: [], refreshes: 0 };
  const Empty = () => null;
  const Panel = ({ children, ...props }) => React.createElement('div', props, children);
  const StubSearchableSelect = ({ ariaLabel, value, onChange }) => React.createElement('input', {
    'aria-label': ariaLabel, value: value || '', onChange,
  });
  const KpiHorizontal = Panel;
  KpiHorizontal.Item = Empty;
  const StubMedicineSelector = ({ disabled, value }) => React.createElement('div', { 'data-medicine-selector': true, 'data-disabled': disabled }, `${value.length} recorded prescriptions`);
  const serverRecord = (payload, original = null) => {
    const assessment = payload.riskReview ? { level: payload.riskReview.level, reasons: [{ ruleId: 'professional_review', message: 'Server-confirmed professional review' }], review: { ...payload.riskReview, reviewedBy: state.user.id, reviewedByRole: 'phn', reviewedAt: '2026-11-22T02:00:00+08:00' } } : original?.consultationRiskAssessment || { level: 'Medium', reasons: [{ ruleId: 'server_assessment', message: 'Server assessment reasons' }] };
    return { ...original, ...payload, id: original?.id || 'created-visit', status: original?.status || 'completed', resident: original?.resident || { id: payload.residentId, name: 'Ana Reyes', age: 35, barangay: 'San Jose' }, vitals: payload.height !== undefined ? { bp: payload.bloodPressure, temperature: payload.temperature, hr: payload.pulseRate, rr: payload.respiratoryRate, heightCm: payload.height, weightKg: payload.weight, bmi: payload.bmi, o2sat: payload.oxygenSaturation } : original?.vitals || {}, consultationRiskAssessment: assessment, consultationDetails: { ...original?.consultationDetails, ...payload.consultationDetails, consultationRiskAssessment: assessment } };
  };
  const deps = {
    ...phnRecords, ...clinical, ...consultationRisk, ...statusFormatter,
    getManilaDateTime: () => clinical.getManilaDateTime(now),
    formatBloodPressureInput,
    PageHeader: ({ title, action }) => React.createElement('header', null, title, action), Card: Panel, KpiHorizontal,
    ErrorState: Empty, SkeletonStatGrid: Empty, TablePagination: Empty, LabResultsPanel: Empty, PhnCheckupWorkbench: Empty,
    MedicineSelector: StubMedicineSelector,
    SearchableSelect: StubSearchableSelect,
    Search: Empty, Plus: Empty, Eye: Empty, Edit2: Empty, Trash2: Empty, X: Empty, ClipboardCheck: Empty, MoreVertical: Empty,
    useAuth: () => ({ user: state.user }), usePhnCoverage: () => ({ coverage: null }), useSyncStatus: () => ({ online: state.online }),
    usePhnWorkflow: () => ({ patients: [], refresh: async () => {}, completeCheckup: async () => {} }),
    useAuthorizedData: () => ({ data: { consultations: state.records, residents: [{ id: 'RES-1', name: 'Ana Reyes', age: 35, barangay: 'San Jose' }, { id: 'RES-2', name: 'Ben Cruz', age: 40, barangay: 'San Jose' }], pending: [], followUps: [] }, loading: false, error: '', refresh: async () => { state.refreshes += 1; } }),
    filterRowsByScope: (rows) => rows, normalizeResident: (resident) => resident,
    loadServerRows: async () => [], listConsultationsOffline: async () => [], listConsultationResidentsOffline: async () => [],
    followUpsApi: { list: async () => ({ rows: [] }) }, followUpNeedsAttention: () => false, isHighRiskResident: () => false,
    manilaDateKey: () => clinical.getManilaDateTime(now).date, formatClinicalDate: (date) => date,
    captureOwnerGuard: (ownerId) => () => state.user?.id === ownerId,
    consultationsApi: { clinicalContext: (params, options) => { state.contextRequests.push({ params, options }); return context(params, options); } },
    api: {
      get: async (url) => ({ consultation: structuredClone(state.records.find((record) => url === `/consultations/${record.id}`)) }),
      put: async (url, body, options) => { state.updates.push({ url, body, options }); return update ? update(url, body, options) : { consultation: serverRecord(body.consultation, state.records.find((record) => url === `/consultations/${record.id}`)) }; },
      post: async (url, body, options) => { state.creates.push({ url, body, options }); return post ? post(url, body, options) : { consultation: serverRecord(body.consultation) }; },
    },
    saveConsultationOffline: async ({ ownerId, payload, create: save }) => {
      if (!state.online) { state.queued.push(structuredClone(payload)); return { queued: true, source: 'outbox' }; }
      const response = await save({ consultation: payload }, { ownerId });
      return { queued: false, source: 'server', record: response.consultation };
    },
    submitConsultationDraft: async () => {}, restoreConsultationDraft: async () => {},
  };
  const key = `__phnRecordsTest${serial++}`;
  globalThis[key] = deps;
  const previousDocument = globalThis.document;
  globalThis.document ||= { body: { style: {} } };
  const injected = source.replace(/^import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2;?/gm, (statement, bindings, _quote, modulePath) => {
    if (modulePath === 'react') return statement.replace(/['"]react['"]/, JSON.stringify(import.meta.resolve('react')));
    return bindings.trim().startsWith('{') ? `const ${bindings.replace(/\bas\b/g, ':')} = globalThis.${key};` : `const ${bindings.trim()} = globalThis.${key}.${bindings.trim()};`;
  });
  const compiled = await transform(injected, { loader: 'jsx', jsx: 'transform' });
  const { default: Page } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
  let renderer;
  await act(async () => { renderer = create(React.createElement(Page)); });
  const page = {
    state, renderer, text: () => JSON.stringify(renderer.toJSON()),
    change: async (label, value) => act(async () => {
      const field = renderer.root.findByProps({ 'aria-label': label });
      if (label === 'Resident Registry Record') field.props.onChange(value);
      else {
        const target = { value, checked: value, selectionStart: String(value).length, selectionEnd: String(value).length, setSelectionRange() {} };
        try {
          field.props.onChange({ target, currentTarget: target, nativeEvent: { inputType: 'insertText' } });
        } catch (error) {
          throw new Error(`Unable to change ${label}: ${error.message}`, { cause: error });
        }
      }
    }),
    click: async (label) => act(async () => { await renderer.root.findAllByType('button').find((button) => textOf(button).trim() === label).props.onClick(); }),
    openEdit: async () => { await act(async () => { renderer.root.findByProps({ title: 'Actions' }).props.onClick(); }); await page.click('Edit Record'); },
    medicine: () => renderer.root.findByType(StubMedicineSelector),
    rerender: async () => act(async () => { renderer.update(React.createElement(Page)); }),
    close: () => { act(() => renderer.unmount()); delete globalThis[key]; if (previousDocument === undefined) delete globalThis.document; },
  };
  return page;
}

async function fillNewClinicalForm(page) {
  await page.change('Resident Registry Record', 'RES-1');
  await page.change('Encounter Date', '2026-11-22');
  await page.change('Encounter Time', '00:05');
  const labels = { bloodPressure: 'Blood Pressure', temperature: 'Temperature (C)', pulseRate: 'Pulse Rate', respiratoryRate: 'Respiratory Rate', height: 'Height (cm)', weight: 'Weight (kg)', oxygenSaturation: 'Oxygen Saturation (%)' };
  for (const [field, value] of Object.entries(measuredVitals)) await page.change(labels[field], value);
  await page.change('Chief Complaint', 'Recorded complaint');
  await page.change('Examination Findings', 'First examination finding\nSecond examination finding');
}

test('PHN rendered new form rejects missing clinical completion, then saves separate findings and canonical prescriptions through outbox service', async () => {
  const page = await mountPhn();
  try {
    await page.click('New Clinical Record');
    await page.change('Resident Registry Record', 'RES-1');
    await page.change('Chief Complaint', 'Recorded complaint');
    await page.click('Save Clinical Record');
    assert.equal(page.state.creates.length, 0);
    assert.match(page.text(), /BMI requires a valid measured height and weight/);
    assert.match(page.text(), /Clinical findings are required/);
    await fillNewClinicalForm(page);
    assert.equal(page.renderer.root.findByProps({ 'aria-label': 'BMI' }).props.readOnly, true);
    assert.equal(page.renderer.root.findByProps({ 'aria-label': 'BMI' }).props.value, '22.0');
    await act(async () => { page.medicine().props.onChange([prescription]); });
    await page.click('Save Clinical Record');
    const request = page.state.creates[0];
    assert.equal(request.url, '/consultations');
    assert.equal(request.options.ownerId, 'owner-a');
    assert.equal(request.body.consultation.findings, 'First examination finding\nSecond examination finding');
    assert.equal(request.body.consultation.diagnosis, '');
    assert.deepEqual(request.body.consultation.medications, [prescription]);
    assert.deepEqual(request.body.consultation.clinicalContext, { pregnancyStatus: 'unknown', existingConditions: [] });
    assert.match(page.text(), /Risk Classification/);
    assert.match(page.text(), /Medium/);
    assert.doesNotMatch(page.text(), /Moderate/);
  } finally { page.close(); }
});

test('PHN context requests fence resident/date/signal and never replace manual encounter or reported clinical values', async () => {
  const requests = [];
  const page = await mountPhn({ context: () => { const request = deferred(); requests.push(request); return request.promise; } });
  try {
    await page.click('New Clinical Record');
    await fillNewClinicalForm(page);
    const first = page.state.contextRequests[0];
    assert.equal(first.options.ownerId, 'owner-a');
    assert.ok(first.options.signal instanceof AbortSignal);
    await page.change('Encounter Date', '2026-11-20');
    await page.change('Encounter Time', '22:11');
    assert.equal(first.options.signal.aborted, true);
    await act(async () => { requests.at(-1).resolve(sourceContext({ pregnancy: { isPregnant: true }, existingConditions: [{ name: 'Source condition', status: 'uncontrolled', significant: true }] })); });
    assert.equal(page.renderer.root.findByProps({ 'aria-label': 'Encounter Date' }).props.value, '2026-11-20');
    assert.equal(page.renderer.root.findByProps({ 'aria-label': 'Encounter Time' }).props.value, '22:11');
    await page.change('Resident Registry Record', 'RES-2');
    await act(async () => { requests.at(-1).resolve(sourceContext()); requests[0].resolve(sourceContext({ pregnancy: { isPregnant: true }, existingConditions: [{ name: 'Stale source condition', status: 'uncontrolled', significant: true }] })); });
    assert.equal(page.state.contextRequests.at(-1).params.residentId, 'RES-2');
    assert.doesNotMatch(page.text(), /Stale source condition/);
  } finally { page.close(); }
});

test('PHN source failure keeps normal complete measurements Unassessed and offline work queued, not persisted', async () => {
  const page = await mountPhn({ context: async () => { throw new Error('Clinical context unavailable'); } });
  try {
    await page.click('New Clinical Record');
    await fillNewClinicalForm(page);
    assert.match(textOf(page.renderer.root.findByProps({ 'aria-label': 'Automatic risk preview' })), /Automatic Risk AssessmentUnassessed/);
    page.state.online = false;
    await page.rerender();
    await act(async () => { page.medicine().props.onChange([prescription]); });
    await page.click('Save Clinical Record');
    assert.equal(page.state.creates.length, 0);
    assert.equal(page.state.queued.length, 1);
    assert.equal(page.state.queued[0].medications[0].route, 'Oral');
    assert.equal(page.state.queued[0].bmi, 22);
    assert.match(page.text(), /not a server health record until synchronization is confirmed/);
    assert.equal(page.renderer.root.findAllByProps({ 'aria-label': 'Saved consultation risk' }).length, 0);
  } finally { page.close(); }
});

test('PHN incomplete new prescriptions never enter the immutable outbox operation', async () => {
  const page = await mountPhn({ online: false });
  try {
    await page.click('New Clinical Record');
    await fillNewClinicalForm(page);
    await act(async () => { page.medicine().props.onChange([{ genericName: 'Reported medicine', custom: true, source: 'custom' }]); });
    await page.click('Save Clinical Record');
    assert.equal(page.state.queued.length, 0);
    assert.ok(page.medicine().props.errors['medications[0].dose']);
    assert.ok(page.medicine().props.errors['medications[0].route']);
    await act(async () => { page.medicine().props.onChange([prescription]); });
    await page.click('Save Clinical Record');
    assert.equal(page.state.queued.length, 1);
    assert.deepEqual(page.state.queued[0].medications, [prescription]);
  } finally { page.close(); }
});

test('PHN freezes the reused prescription selector and clinical inputs during an in-flight update', async () => {
  const pending = deferred();
  const page = await mountPhn({ records: [savedRecord()], update: () => pending.promise });
  try {
    await page.openEdit();
    await page.change('Examination Findings', 'Corrected findings');
    let saving;
    await act(async () => { saving = page.renderer.root.findAllByType('button').find((button) => textOf(button).trim() === 'Save Clinical Record').props.onClick(); });
    assert.equal(page.medicine().props.disabled, true);
    assert.equal(page.renderer.root.findByProps({ 'aria-label': 'Encounter Date' }).props.disabled, true);
    await act(async () => { pending.resolve({ consultation: savedRecord({ findings: 'Corrected findings' }) }); await saving; });
    assert.match(page.text(), /Consultation updated on the server/);
  } finally { page.close(); }
});

test('PHN existing High preview is held from the actual saved record and licensed review remains distinct until server-confirmed save', async () => {
  const original = savedRecord({ consultationRiskAssessment: { level: 'High', reasons: [{ ruleId: 'prior_high', message: 'Original saved High reason' }] }, medications: [prescription] });
  const page = await mountPhn({ records: [original] });
  try {
    await page.openEdit();
    const preview = () => textOf(page.renderer.root.findByProps({ 'aria-label': 'Automatic risk preview' }));
    assert.match(preview(), /Automatic Risk AssessmentHigh/);
    assert.match(preview(), /Clinical decision support only; not a medical diagnosis/);
    await page.change('Record a professional risk review', true);
    await page.change('Reviewed Risk Level', 'Medium');
    await page.change('Clinical Review Reason', '  Reassessed with stable measurements and documented monitoring  ');
    await page.click('Save Clinical Record');
    assert.equal(page.state.updates.length, 0);
    assert.match(page.text(), /explicitly confirm reassessment/);
    await page.change('Reassessment confirmed', true);
    assert.match(preview(), /Automatic Risk AssessmentHigh/);
    await page.click('Save Clinical Record');
    const payload = page.state.updates[0].body.consultation;
    assert.deepEqual(payload.riskReview, { level: 'Medium', reason: 'Reassessed with stable measurements and documented monitoring', reassessmentConfirmed: true });
    assert.equal(payload.expectedUpdatedAt, original.updatedAt);
    assert.equal(payload.consultationRiskAssessment, undefined);
    assert.match(textOf(page.renderer.root.findByProps({ 'aria-label': 'Saved consultation risk' })), /Risk ClassificationMedium/);
    assert.match(page.text(), /Server-confirmed professional review/);
    assert.deepEqual(original.medications, [prescription]);
  } finally { page.close(); }
});

test('PHN client role never exposes or authorizes review without current scoped server permission', async () => {
  const pending = deferred();
  const page = await mountPhn({ records: [savedRecord()], context: () => pending.promise });
  try {
    await page.openEdit();
    assert.equal(page.renderer.root.findAllByProps({ 'aria-label': 'Record a professional risk review' }).length, 0);
    await act(async () => { pending.resolve(sourceContext({ canReviewRisk: false })); });
    assert.equal(page.state.user.role, 'phn');
    assert.equal(page.renderer.root.findAllByProps({ 'aria-label': 'Record a professional risk review' }).length, 0);
    assert.equal(page.state.updates.length, 0);
  } finally { page.close(); }
});

test('PHN scope changes invalidate review permission and stale owner responses cannot reopen clinical controls', async () => {
  const pending = deferred();
  let calls = 0;
  const page = await mountPhn({ records: [savedRecord()], context: () => ++calls === 1 ? Promise.resolve(sourceContext()) : pending.promise });
  try {
    await page.openEdit();
    await page.change('Record a professional risk review', true);
    await page.change('Reviewed Risk Level', 'Medium');
    await page.change('Clinical Review Reason', 'Documented reassessment');
    await page.change('Reassessment confirmed', true);
    await page.change('Encounter Date', '2026-11-21');
    assert.equal(page.renderer.root.findAllByProps({ 'aria-label': 'Record a professional risk review' }).length, 0);
    await page.click('Save Clinical Record');
    assert.equal(page.state.updates.length, 0);
    assert.match(page.text(), /current server-confirmed clinical authority/);
    page.state.user = { id: 'owner-b', role: 'phn' };
    page.state.records = [];
    await page.rerender();
    await act(async () => { pending.resolve(sourceContext({ canReviewRisk: true, existingConditions: [{ name: 'Owner A condition', status: 'stable', significant: false }] })); });
    assert.equal(page.renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
    assert.equal(page.renderer.root.findAllByProps({ 'aria-label': 'Record a professional risk review' }).length, 0);
    assert.doesNotMatch(page.text(), /Owner A condition/);
  } finally { page.close(); }
});

test('PHN historical metadata-only UI saves without inventing vitals, time, pregnancy or an automatic assessment', async () => {
  const original = savedRecord({ consultationTime: '', chiefComplaint: '', findings: '', vitals: { hr: 900 }, medications: [{ genericName: 'Legacy medicine', route: 'Legacy route' }], clinicalContext: null, consultationDetails: { retainedHistory: ['Original partial encounter'], clinicalAssessmentHistory: [{ level: 'High' }] } });
  const before = structuredClone(original);
  const page = await mountPhn({ records: [original] });
  try {
    await page.openEdit();
    assert.equal(page.renderer.root.findByProps({ 'aria-label': 'Encounter Time' }).props.value, '');
    await page.change('Next Visit Date', '2026-12-01');
    await page.click('Save Clinical Record');
    assert.equal(page.state.updates.length, 1);
    const payload = page.state.updates[0].body.consultation;
    assert.equal(payload.nextVisitDate, '2026-12-01');
    assert.equal(payload.pulseRate, undefined);
    assert.equal(payload.consultationTime, undefined);
    assert.equal(payload.clinicalContext, undefined);
    assert.deepEqual(payload.consultationDetails, original.consultationDetails);
    assert.deepEqual(original, before);
  } finally { page.close(); }
});

test('P0-6: completePhnHealthRecordCheckup persists recorded checkup and refreshes records and queue', async () => {
  const calls = [];
  const recorded = {
    assessment: 'Controlled hypertension',
    healthConcern: 'Hypertension',
    clinicalNotes: 'BP 125/80',
    recommendations: 'Continue maintenance',
    medications: [],
  };

  await completePhnHealthRecordCheckup({
    checkup: { id: 'sub-777' },
    recorded,
    completeCheckup: async (id, payload) => {
      calls.push(['complete', id, payload]);
    },
    refreshRecords: async () => {
      calls.push(['refreshRecords']);
    },
    refreshQueue: async () => {
      calls.push(['refreshQueue']);
    },
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], ['complete', 'sub-777', recorded]);
  assert.deepEqual(calls[1], ['refreshRecords']);
  assert.deepEqual(calls[2], ['refreshQueue']);
});

test('P0-6: completePhnHealthRecordCheckup propagates server failures without silently calling refreshes', async () => {
  let refreshed = false;
  await assert.rejects(
    () => completePhnHealthRecordCheckup({
      checkup: { id: 'sub-777' },
      recorded: { assessment: 'x' },
      completeCheckup: async () => {
        throw new Error('500 Server Error');
      },
      refreshRecords: async () => { refreshed = true; },
      refreshQueue: async () => { refreshed = true; },
    }),
    /500 Server Error/,
  );
  assert.equal(refreshed, false);
});

test('P0-6: PhnHealthRecords passes onComplete (never nonexistent onSaved) to PhnCheckupWorkbench', () => {
  const src = fs.readFileSync(
    path.resolve('src/features/health-records/pages/PhnHealthRecords.jsx'),
    'utf8',
  );
  assert.doesNotMatch(src, /<PhnCheckupWorkbench[\s\S]*?onSaved=/);
  assert.doesNotMatch(src, /<PhnCheckupWorkbench[\s\S]*?patientId=/);
  assert.match(src, /<PhnCheckupWorkbench[\s\S]*?onComplete=\{handleCompleteCheckup\}/);
});

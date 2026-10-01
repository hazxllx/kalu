import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import repository from '../src/repositories/index.js';
import * as intake from '../src/services/intake.service.js';
import * as phn from '../src/services/phnQueue.service.js';
import { computeBMI } from '../src/utils/bmi.js';

/**
 * BUG-003B-3 — RHU triage → PHN queue submission contract + BMI auto-calc.
 *
 * Verifies the corrected lifecycle: a triage hand-off (no findings/treatment)
 * can be submitted and enter the PHN queue; the PHN supplies findings/treatment
 * during processing; completion enforces those clinical outputs. BMI is
 * recomputed server-side from height/weight (reusing utils/bmi.js). Repository
 * is stubbed in-memory following the existing harness.
 */

const STUBBED = [
  'getResident', 'findResidentByIdentity', 'nextResidentIds', 'insertResident',
  'nextSubmissionId', 'insertVisit', 'getVisit', 'updateVisit', 'listVisits',
  'searchResidents', 'getReferralByVisitId', 'nextReferralId', 'insertReferral',
  'getReferral', 'updateReferral', 'listReferrals',
];
const original = {};

let residents; // id -> resident row
let visits; // id -> visit row (no embedded resident)
let referrals; // id -> referral
let identityMatch; // optional resident returned by findResidentByIdentity
let seq;

const RHU = { id: 'rhu-1', role: 'rhu_personnel', name: 'RHU One', municipalityId: 'mun-1', facilityId: 'facility-rhu-1' };
const PHN = { id: 'phn-1', role: 'phn', name: 'PHN One', municipalityId: 'mun-1' };
const RESIDENT_USER = { id: 'ru-1', role: 'resident-limited', name: 'Res' };
const HS = { id: 'hs-1', role: 'health_supervisor', name: 'HS', barangay: 'San Isidro', barangayId: 'brgy-si', municipalityId: 'mun-1' };

const goodVitals = (over = {}) => ({
  bp: '120/80', hr: 80, rr: 18, o2sat: 98, temperature: 37,
  heightCm: 170, weightKg: 70, ...over,
});

before(() => {
  for (const k of STUBBED) original[k] = repository[k];

  repository.getResident = async (id) => residents.get(id) || null;
  repository.findResidentByIdentity = async () => identityMatch;
  repository.nextResidentIds = async () => { seq += 1; return { id: `RES-${seq}`, healthRecordNo: `HR-${seq}` }; };
  repository.insertResident = async (row) => { residents.set(row.id, row); return row; };
  repository.nextSubmissionId = async () => { seq += 1; return { id: `SUB-${seq}` }; };
  repository.insertVisit = async (sub) => { visits.set(sub.id, { ...sub }); return { ...sub, resident: residents.get(sub.residentId) || null }; };
  repository.getVisit = async (id) => {
    const v = visits.get(id);
    return v ? { ...v, resident: residents.get(v.residentId) || null } : null;
  };
  repository.updateVisit = async (id, patch) => {
    const v = visits.get(id);
    if (!v) return null;
    const next = { ...v, ...patch };
    visits.set(id, next);
    return { ...next, resident: residents.get(next.residentId) || null };
  };
  repository.listVisits = async ({ statuses = null } = {}) => {
    let rows = [...visits.values()];
    if (statuses) rows = rows.filter((v) => statuses.includes(v.status));
    return { rows: rows.map((v) => ({ ...v, resident: residents.get(v.residentId) || null })), total: rows.length };
  };
  repository.searchResidents = async () => [...residents.values()];
  repository.getReferralByVisitId = async (visitId) => [...referrals.values()].find((r) => r.visitId === visitId) || null;
  repository.nextReferralId = async () => { seq += 1; return { id: `REF-${seq}` }; };
  repository.insertReferral = async (row) => { referrals.set(row.id, row); return row; };
  repository.getReferral = async (id) => referrals.get(id) || null;
  repository.updateReferral = async (id, patch) => { const r = referrals.get(id); const n = { ...r, ...patch }; referrals.set(id, n); return n; };
  repository.listReferrals = async () => ({ rows: [...referrals.values()], total: referrals.size });
});

after(() => { for (const k of STUBBED) repository[k] = original[k]; });

beforeEach(() => {
  residents = new Map();
  visits = new Map();
  referrals = new Map();
  identityMatch = null;
  seq = 0;
  residents.set('RES-1', { id: 'RES-1', firstName: 'Juan', lastName: 'Dela Cruz', barangay: 'San Isidro', barangayId: 'brgy-si', municipalityId: 'mun-1' });
});

const createTriage = (user = RHU, visitOver = {}) =>
  intake.createSubmission({
    residentId: 'RES-1',
    visit: { visitDate: '2026-09-24T09:00:00Z', chiefComplaint: 'Fever', vitals: goodVitals(), ...visitOver },
    user,
  });

/* ------------------------------ lifecycle ------------------------------- */

test('1. a valid triage visit can be created (draft, no findings/treatment)', async () => {
  const sub = await createTriage();
  assert.equal(sub.status, 'draft');
  assert.equal(sub.findings, '');
  assert.equal(sub.treatmentGiven, '');
  assert.equal(sub.facilityId, RHU.facilityId);
});

test('triage facility comes from the authenticated assignment, not the request payload', async () => {
  const sub = await createTriage(RHU, { facilityId: 'another-facility' });
  assert.equal(sub.facilityId, RHU.facilityId);
});

test('RHU triage is denied when the authenticated account has no facility assignment', async () => {
  await assert.rejects(
    () => createTriage({ ...RHU, facilityId: null }),
    (error) => error.statusCode === 422,
  );
});

test('2+3. a triage visit can be submitted without findings or treatmentGiven', async () => {
  const sub = await createTriage();
  const result = await intake.submitSubmission({ id: sub.id, user: RHU });
  assert.equal(result.submission.status, 'submitted');
  assert.equal(result.locked, true);
});

test('4. a submitted visit appears in the PHN queue', async () => {
  const sub = await createTriage();
  await intake.submitSubmission({ id: sub.id, user: RHU });
  const queue = await phn.listQueue({ user: PHN });
  assert.ok(queue.rows.some((v) => v.id === sub.id && v.status === 'submitted'));
});

test('5+6. PHN can receive then mark in_review', async () => {
  const sub = await createTriage();
  await intake.submitSubmission({ id: sub.id, user: RHU });
  const received = await phn.receiveSubmission({ id: sub.id, user: PHN });
  assert.equal(received.status, 'received');
  const reviewing = await phn.markInReview({ id: sub.id, user: PHN });
  assert.equal(reviewing.status, 'in_review');
});

test('7+8. PHN adds findings/treatment then completes', async () => {
  const sub = await createTriage();
  await intake.submitSubmission({ id: sub.id, user: RHU });
  await phn.receiveSubmission({ id: sub.id, user: PHN });
  await phn.markInReview({ id: sub.id, user: PHN });
  await phn.updateSubmissionForPhn({
    id: sub.id,
    patch: { findings: 'BP elevated on recheck', treatmentGiven: 'Advised rest; BP monitoring', recommendation: 'Follow-up in 1 week' },
    user: PHN,
  });
  const completed = await phn.completeSubmission({ id: sub.id, user: PHN });
  assert.equal(completed.status, 'completed');
  assert.ok(completed.completedAt);
});

test('BUG-008. the full triage -> queue -> checkup -> completion state PERSISTS across a reload', async () => {
  // Simulates: RHU triages, PHN works the queue, then a fresh session (or a
  // browser refresh / another device) re-reads the record from the repository.
  const sub = await createTriage();
  await intake.submitSubmission({ id: sub.id, user: RHU });

  // "Reload" 1 — a brand-new read sees the record in the PHN queue.
  const afterSubmit = await repository.getVisit(sub.id);
  assert.equal(afterSubmit.status, 'submitted');

  await phn.receiveSubmission({ id: sub.id, user: PHN });
  await phn.markInReview({ id: sub.id, user: PHN });
  await phn.updateSubmissionForPhn({
    id: sub.id,
    patch: { findings: 'Persisted findings', treatmentGiven: 'Persisted treatment', recommendation: 'Follow-up' },
    user: PHN,
  });
  await phn.completeSubmission({ id: sub.id, user: PHN });

  // "Reload" 2 — a fresh read (new session) still sees the completed clinical
  // record with its findings/treatment. Nothing lived only in the browser.
  const reloaded = await repository.getVisit(sub.id);
  assert.equal(reloaded.status, 'completed');
  assert.equal(reloaded.findings, 'Persisted findings');
  assert.equal(reloaded.treatmentGiven, 'Persisted treatment');
  assert.ok(reloaded.completedAt);

  // And it appears in the PHN queue read used by the frontend hook.
  const queue = await phn.listQueue({ user: PHN });
  assert.ok(queue.rows.some((r) => r.id === sub.id && r.status === 'completed'));
});

test('8b. completion is blocked until findings AND treatment exist', async () => {
  const sub = await createTriage();
  await intake.submitSubmission({ id: sub.id, user: RHU });
  await phn.receiveSubmission({ id: sub.id, user: PHN });
  await phn.markInReview({ id: sub.id, user: PHN });
  // No findings/treatment yet -> 400
  await assert.rejects(() => phn.completeSubmission({ id: sub.id, user: PHN }), (e) => e.statusCode === 400);
  // findings only -> still blocked
  await phn.updateSubmissionForPhn({ id: sub.id, patch: { findings: 'x' }, user: PHN });
  await assert.rejects(() => phn.completeSubmission({ id: sub.id, user: PHN }), (e) => e.statusCode === 400);
});

test('9. existing referral behavior still works from in_review', async () => {
  const sub = await createTriage();
  await intake.submitSubmission({ id: sub.id, user: RHU });
  await phn.receiveSubmission({ id: sub.id, user: PHN });
  await phn.markInReview({ id: sub.id, user: PHN });
  const referral = await phn.createReferral({
    visitId: sub.id,
    draft: { receivingFacility: 'Bicol Medical Center', reasonForReferral: 'Further evaluation' },
    user: PHN,
  });
  assert.equal(referral.visitId, sub.id);
  const after = await repository.getVisit(sub.id);
  assert.equal(after.status, 'referred');
});

/* --------------------------- authz / integrity -------------------------- */

test('10. non-intake role cannot create; non-PHN cannot receive/complete', async () => {
  await assert.rejects(() => createTriage(RESIDENT_USER), (e) => e.statusCode === 403);
  const sub = await createTriage();
  await intake.submitSubmission({ id: sub.id, user: RHU });
  await assert.rejects(() => phn.receiveSubmission({ id: sub.id, user: HS }), (e) => e.statusCode === 403);
  await assert.rejects(() => phn.completeSubmission({ id: sub.id, user: RHU }), (e) => e.statusCode === 403);
});

test('11. only the record owner may submit', async () => {
  const sub = await createTriage(RHU);
  await assert.rejects(() => intake.submitSubmission({ id: sub.id, user: { id: 'other', role: 'rhu_personnel' } }), (e) => e.statusCode === 403);
});

test('13. resident_id is required (neither residentId nor resident supplied)', async () => {
  await assert.rejects(() => intake.createSubmission({ visit: { chiefComplaint: 'x' }, user: RHU }), (e) => e.statusCode === 400);
});

test('14. no duplicate resident is created when identity matches', async () => {
  identityMatch = { id: 'RES-1', firstName: 'Juan', lastName: 'Dela Cruz', healthRecordNo: 'HR-1' };
  await assert.rejects(
    () => intake.createSubmission({ resident: { firstName: 'Juan', lastName: 'Dela Cruz' }, visit: { chiefComplaint: 'x' }, user: RHU }),
    (e) => e.statusCode === 409,
  );
});

test('12/scope. barangay-scoped search only returns in-scope residents', async () => {
  residents.set('RES-2', { id: 'RES-2', firstName: 'Ana', lastName: 'Reyes', barangay: 'Cadlan' });
  const forHs = await intake.searchResidents({ q: '', user: HS }); // HS barangay = San Isidro
  assert.ok(forHs.every((r) => r.barangay === 'San Isidro'));
  assert.ok(forHs.some((r) => r.id === 'RES-1'));
  assert.ok(!forHs.some((r) => r.id === 'RES-2'));
});

test('12b/scope. a barangay-scoped caller cannot attach a visit to an out-of-scope resident (404)', async () => {
  residents.set('RES-2', { id: 'RES-2', firstName: 'Ana', lastName: 'Reyes', barangay: 'Cadlan' });
  await assert.rejects(
    () => intake.createSubmission({
      residentId: 'RES-2',
      visit: { visitDate: '2026-09-24T09:00:00Z', chiefComplaint: 'Fever', vitals: goodVitals() },
      user: HS, // San Isidro
    }),
    (e) => e.statusCode === 404,
  );
});

test('12c/scope. a barangay-scoped caller cannot create a new resident in another barangay (403)', async () => {
  await assert.rejects(
    () => intake.createSubmission({
      resident: { firstName: 'Bagong', lastName: 'Residente', barangay: 'Cadlan' }, // another barangay
      visit: { visitDate: '2026-09-24T09:00:00Z', chiefComplaint: 'Cough', vitals: goodVitals() },
      user: HS, // San Isidro
    }),
    (e) => e.statusCode === 403,
  );
});

test('12d/scope. a new resident with no barangay is forced to the scoped callers barangay', async () => {
  const sub = await intake.createSubmission({
    resident: { firstName: 'Walang', lastName: 'Barangay' }, // no barangay supplied
    visit: { visitDate: '2026-09-24T09:00:00Z', chiefComplaint: 'Cough', vitals: goodVitals() },
    user: HS, // San Isidro
  });
  const created = residents.get(sub.residentId);
  assert.equal(created.barangay, 'San Isidro');
});

/* ---------------------- BUG-002 cross-scope PHI reads ------------------- */

const OTHER_BRGY_RES = { id: 'RES-9', firstName: 'Out', lastName: 'OfBarangay', barangay: 'Cadlan', barangayId: 'brgy-cadlan', municipalityId: 'mun-1' };
const OTHER_MUNI_RES = { id: 'RES-8', firstName: 'Out', lastName: 'OfMunicipality', barangay: 'San Jose', barangayId: 'brgy-sj', municipalityId: 'mun-2' };

test('BUG-002. a Health Supervisor cannot view a submission from another barangay (404)', async () => {
  residents.set(OTHER_BRGY_RES.id, OTHER_BRGY_RES);
  visits.set('SUB-B', { id: 'SUB-B', residentId: OTHER_BRGY_RES.id, recordedById: 'phn-1', status: 'submitted' });
  await assert.rejects(() => phn.viewSubmission({ id: 'SUB-B', user: HS }), (e) => e.statusCode === 404);
});

test('BUG-002. a municipality role cannot view a submission from another municipality (404)', async () => {
  residents.set(OTHER_MUNI_RES.id, OTHER_MUNI_RES);
  visits.set('SUB-M', { id: 'SUB-M', residentId: OTHER_MUNI_RES.id, recordedById: 'mho-2', status: 'submitted' });
  await assert.rejects(() => phn.viewSubmission({ id: 'SUB-M', user: PHN }), (e) => e.statusCode === 404);
});

test('BUG-002. a Health Supervisor cannot read a referral from another barangay (404)', async () => {
  referrals.set('REF-X', { id: 'REF-X', residentId: OTHER_BRGY_RES.id, visitId: 'SUB-X', resident: OTHER_BRGY_RES });
  await assert.rejects(() => phn.getReferral({ id: 'REF-X', user: HS }), (e) => e.statusCode === 404);
});

test('BUG-002. listReferrals is filtered to the caller scope', async () => {
  referrals.set('REF-IN', { id: 'REF-IN', residentId: 'RES-1', visitId: 'SUB-1', resident: residents.get('RES-1') });
  referrals.set('REF-OUT', { id: 'REF-OUT', residentId: OTHER_MUNI_RES.id, visitId: 'SUB-8', resident: OTHER_MUNI_RES });
  const result = await phn.listReferrals({ user: PHN });
  const ids = result.rows.map((r) => r.id);
  assert.ok(ids.includes('REF-IN'));
  assert.ok(!ids.includes('REF-OUT'));
});

/* --------------------------------- BMI ---------------------------------- */

test('15. BMI is computed from valid height + weight (1-decimal)', () => {
  assert.deepEqual(computeBMI(170, 70), { bmi: 24.2, category: 'Normal' });
});

test('16-19. BMI is null when height/weight missing, zero, or invalid', () => {
  assert.equal(computeBMI(null, 70).bmi, null);
  assert.equal(computeBMI(170, null).bmi, null);
  assert.equal(computeBMI(0, 70).bmi, null);
  assert.equal(computeBMI(170, 0).bmi, null);
  assert.equal(computeBMI('abc', 70).bmi, null);
});

test('20+21. changing height or weight recomputes BMI', () => {
  assert.equal(computeBMI(160, 70).bmi, 27.3);
  assert.equal(computeBMI(170, 80).bmi, 27.7);
});

test('22. removing height or weight clears BMI (null)', () => {
  assert.equal(computeBMI(undefined, 70).bmi, null);
  assert.equal(computeBMI(170, undefined).bmi, null);
});

test('BMI persists on create and recomputes on PHN vitals update', async () => {
  const sub = await createTriage(RHU, { vitals: goodVitals({ heightCm: 170, weightKg: 70 }) });
  assert.equal(sub.vitals.bmi, 24.2);
  await intake.submitSubmission({ id: sub.id, user: RHU });
  await phn.receiveSubmission({ id: sub.id, user: PHN });
  await phn.markInReview({ id: sub.id, user: PHN });
  const updated = await phn.updateSubmissionForPhn({
    id: sub.id,
    patch: { vitals: goodVitals({ heightCm: 160, weightKg: 80 }) },
    user: PHN,
  });
  assert.equal(updated.vitals.bmi, computeBMI(160, 80).bmi); // recomputed via the same util, no stale value
  assert.notEqual(updated.vitals.bmi, 24.2);
});

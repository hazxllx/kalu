import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import repository from '../src/repositories/index.js';
import * as service from '../src/services/analytics.service.js';

/**
 * Top Condition behavior.
 *
 * The headline Top Condition must be the most frequent REAL recorded condition,
 * never the generic "Others" catch-all, deterministic on ties, and
 * "No recorded condition" / 0 when there is nothing recorded.
 */

test('topConditionFrom ignores the Others catch-all', () => {
  assert.deepEqual(service.topConditionFrom([]), { name: 'No recorded condition', value: 0 });
  assert.deepEqual(service.topConditionFrom([{ name: 'Others', value: 11 }]), { name: 'No recorded condition', value: 0 });
  assert.deepEqual(
    service.topConditionFrom([{ name: 'Others', value: 11 }, { name: 'Hypertension', value: 5 }]),
    { name: 'Hypertension', value: 5 },
  );
});

test('topConditionFrom breaks ties deterministically (alphabetical)', () => {
  const top = service.topConditionFrom([{ name: 'Diabetes', value: 3 }, { name: 'Anemia', value: 3 }]);
  assert.equal(top.name, 'Anemia');
  assert.equal(top.value, 3);
});

const STUBBED = ['listVisits', 'listReferrals', 'searchResidents'];
const original = {};

const RESIDENTS = [
  { id: 'r1', barangay: 'San Isidro', municipalityId: 'M1' },
  { id: 'r2', barangay: 'San Isidro', municipalityId: 'M1' },
  { id: 'r3', barangay: 'San Isidro', municipalityId: 'M1' },
];

const VISITS = [
  { id: 'v1', residentId: 'r1', chiefComplaint: 'Elevated blood pressure', findings: 'Hypertension stage 1', visitDate: '2026-09-01', vitals: { bp: '150/95' } },
  { id: 'v2', residentId: 'r2', chiefComplaint: 'High blood pressure follow-up', findings: '', visitDate: '2026-09-05', vitals: { bp: '145/90' } },
  { id: 'v3', residentId: 'r3', chiefComplaint: 'Back pain', findings: 'muscle strain', visitDate: '2026-09-06', vitals: {} },
];

before(() => {
  for (const k of STUBBED) original[k] = repository[k];
  repository.searchResidents = async () => RESIDENTS.map((r) => ({ ...r }));
  repository.listVisits = async () => ({ rows: VISITS.map((v) => ({ ...v })) });
  repository.listReferrals = async () => ({ rows: [] });
});

after(() => { for (const k of STUBBED) repository[k] = original[k]; });

test('getEarlyWarning surfaces the real top condition, not Others', async () => {
  const res = await service.getEarlyWarning({ barangay: 'San Isidro', municipalityId: 'M1' });
  assert.equal(res.summary.topCondition, 'Hypertension');
  assert.equal(res.summary.topConditionCases, 2);
});

test('getEarlyWarning returns "No recorded condition" when nothing qualifies', async () => {
  repository.listVisits = async () => ({ rows: [{ id: 'vx', residentId: 'r1', chiefComplaint: 'Back pain', findings: '', visitDate: '2026-09-06', vitals: {} }] });
  const res = await service.getEarlyWarning({ barangay: 'San Isidro', municipalityId: 'M1' });
  assert.equal(res.summary.topCondition, 'No recorded condition');
  assert.equal(res.summary.topConditionCases, 0);
  repository.listVisits = async () => ({ rows: VISITS.map((v) => ({ ...v })) });
});

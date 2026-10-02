import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import repository from '../src/repositories/index.js';
import * as service from '../src/services/analytics.service.js';

/**
 * Household map (clustered per family) scope + active-case tests.
 *
 * RULE 7: ONE marker per household (never one per member).
 * RULE 9: a household is flagged active when a linked resident has a
 *         non-completed visit or an active TB program entry.
 * RULE 10: only households with valid stored coordinates are plotted; the
 *          others are returned separately (never a fabricated coordinate).
 * RULE 11: the marker payload is household-level only — no resident identity.
 *
 * Repository is stubbed in-memory.
 */

const STUBBED = ['listHouseholdsForMap', 'listVisits', 'listTclEntries'];
const original = {};

function thisMonthISO(day) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), day);
  return d.toISOString().slice(0, 10);
}

// HH-001 has coordinates + an active case (r2's non-completed visit).
// HH-002 has coordinates but NO active case (r3's only visit is completed).
// HH-003 has NO coordinates (returned unplotted) even though it has an active TB case.
let HOUSEHOLDS = [];
let VISITS = [];
let TCL = [];

before(() => {
  for (const k of STUBBED) original[k] = repository[k];
  repository.listHouseholdsForMap = async ({ barangay = null, municipalityId = null } = {}) =>
    HOUSEHOLDS.filter(
      (h) =>
        (!municipalityId || h.municipalityId === municipalityId) &&
        (!barangay || h.barangay === barangay),
    ).map((h) => ({ ...h, residentIds: [...h.residentIds] }));
  repository.listVisits = async () => ({ rows: VISITS.map((v) => ({ ...v })) });
  repository.listTclEntries = async () => ({ rows: TCL.map((row) => ({ ...row })) });
});

after(() => { for (const k of STUBBED) repository[k] = original[k]; });

beforeEach(() => {
  HOUSEHOLDS = [
    { id: 'HH-001', barangay: 'San Isidro', barangayId: 'b1', municipalityId: 'M1', latitude: 13.5597, longitude: 123.272, riskLevel: 'High', purok: 'Zone 1', memberCount: 4, residentIds: ['r1', 'r2'] },
    { id: 'HH-002', barangay: 'San Isidro', barangayId: 'b1', municipalityId: 'M1', latitude: 13.5601, longitude: 123.273, riskLevel: 'Low', purok: 'Zone 2', memberCount: 3, residentIds: ['r3'] },
    { id: 'HH-003', barangay: 'San Antonio', barangayId: 'b2', municipalityId: 'M1', latitude: null, longitude: null, riskLevel: 'Moderate', purok: 'Zone 1', memberCount: 5, residentIds: ['r4'] },
  ];
  VISITS = [
    { residentId: 'r2', status: 'submitted', visitDate: thisMonthISO(2) }, // active
    { residentId: 'r3', status: 'completed', visitDate: thisMonthISO(1) }, // not active
  ];
  TCL = [
    { id: 'tb-1', residentId: 'r4', program: 'TB Patients', status: 'Active', createdAt: thisMonthISO(5) }, // active TB
  ];
});

test('one marker per household (clustered per family), never one per member', async () => {
  const res = await service.getHouseholdMap({ municipalityId: 'M1' });
  const ids = [...res.households, ...res.unplotted].map((h) => h.id).sort();
  assert.deepEqual(ids, ['HH-001', 'HH-002', 'HH-003']);
  // Member count is reported but there is still exactly ONE marker per household.
  const hh1 = res.households.find((h) => h.id === 'HH-001');
  assert.equal(hh1.memberCount, 4);
});

test('a household with a non-completed visit is flagged as an active case', async () => {
  const res = await service.getHouseholdMap({ municipalityId: 'M1' });
  const hh1 = res.households.find((h) => h.id === 'HH-001');
  assert.equal(hh1.hasActiveCase, true);
  assert.equal(hh1.activeCases, 1);
});

test('a household whose only visit is completed is NOT an active case', async () => {
  const res = await service.getHouseholdMap({ municipalityId: 'M1' });
  const hh2 = res.households.find((h) => h.id === 'HH-002');
  assert.equal(hh2.hasActiveCase, false);
  assert.equal(hh2.activeCases, 0);
});

test('an active TB program enrollment flags the household as active', async () => {
  const res = await service.getHouseholdMap({ municipalityId: 'M1' });
  const hh3 = [...res.households, ...res.unplotted].find((h) => h.id === 'HH-003');
  assert.equal(hh3.hasActiveCase, true);
});

test('households without coordinates are returned unplotted, never with fabricated coordinates', async () => {
  const res = await service.getHouseholdMap({ municipalityId: 'M1' });
  assert.deepEqual(res.households.map((h) => h.id).sort(), ['HH-001', 'HH-002']);
  assert.deepEqual(res.unplotted.map((h) => h.id), ['HH-003']);
  const hh3 = res.unplotted[0];
  assert.equal(hh3.latitude, null);
  assert.equal(hh3.longitude, null);
  assert.equal(hh3.hasCoordinates, false);
});

test('the marker payload is household-level only — no resident identity leaks', async () => {
  const res = await service.getHouseholdMap({ municipalityId: 'M1' });
  const hh1 = res.households.find((h) => h.id === 'HH-001');
  assert.ok(!('residentIds' in hh1));
  assert.ok(!('residents' in hh1));
  assert.ok(!('name' in hh1));
  // Only safe household-level keys are present.
  assert.ok('householdNo' in hh1);
  assert.ok('barangay' in hh1);
  assert.ok('riskLevel' in hh1);
});

test('barangay scope returns only the assigned barangay households', async () => {
  const res = await service.getHouseholdMap({ barangay: 'San Isidro', municipalityId: 'M1' });
  const ids = [...res.households, ...res.unplotted].map((h) => h.id).sort();
  assert.deepEqual(ids, ['HH-001', 'HH-002']); // HH-003 is San Antonio
  assert.equal(res.scope, 'barangay');
});

test('summary rolls up plotted / unplotted / active-case counts', async () => {
  const res = await service.getHouseholdMap({ municipalityId: 'M1' });
  assert.equal(res.summary.households, 3);
  assert.equal(res.summary.plotted, 2);
  assert.equal(res.summary.unplotted, 1);
  assert.equal(res.summary.activeCaseHouseholds, 2); // HH-001 and HH-003
});

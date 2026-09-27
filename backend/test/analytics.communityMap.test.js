import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import repository from '../src/repositories/index.js';
import * as service from '../src/services/analytics.service.js';

/**
 * Community Health Overview map scope tests.
 *
 * A barangay-assigned Health Supervisor gets ONLY their barangay; a
 * municipality-wide caller (MHO) gets every barangay in their municipality.
 * Coordinates and counts are whatever the DB holds — the map never invents
 * them. Repository is stubbed in-memory.
 */

const STUBBED = ['listBarangays', 'listVisits', 'searchResidents'];
const original = {};

const BARANGAYS = [
  { id: 'b1', name: 'San Isidro', latitude: null, longitude: null, municipality_id: 'M1' },
  { id: 'b2', name: 'San Antonio', latitude: 13.558173, longitude: 123.273117, municipality_id: 'M1' },
  { id: 'b3', name: 'Old San Roque', latitude: 13.552406, longitude: 123.276504, municipality_id: 'M1' },
];
const RESIDENTS = [
  { id: 'r1', barangay: 'San Isidro' },
  { id: 'r2', barangay: 'San Antonio' },
  { id: 'r3', barangay: 'San Antonio' },
  { id: 'r4', barangay: 'Old San Roque' },
];
const VISITS = [
  // r2's latest visit is high risk (systolic 150). Two TB visits: one active
  // (submitted) recorded this month, one completed earlier.
  { residentId: 'r2', visitDate: thisMonthISO(2), status: 'submitted', chiefComplaint: 'Persistent cough, rule out TB', vitals: { bp: '150/95' } },
  { residentId: 'r2', visitDate: '2026-01-01', status: 'completed', chiefComplaint: 'Tuberculosis follow-up', vitals: { bp: '120/80' } },
  // r4 (Old San Roque) has a Dengue visit this month, still active.
  { residentId: 'r4', visitDate: thisMonthISO(3), status: 'in_review', chiefComplaint: 'Dengue with fever', vitals: { bp: '110/70' } },
];

function thisMonthISO(day) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), day);
  return d.toISOString().slice(0, 10);
}

before(() => {
  for (const k of STUBBED) original[k] = repository[k];
  repository.listBarangays = async ({ municipalityId = null } = {}) =>
    BARANGAYS.filter((b) => !municipalityId || b.municipality_id === municipalityId).map((b) => ({ ...b }));
  repository.listVisits = async () => ({ rows: VISITS.map((v) => ({ ...v })) });
  repository.searchResidents = async () => RESIDENTS.map((r) => ({ ...r }));
});

after(() => { for (const k of STUBBED) repository[k] = original[k]; });

beforeEach(() => {});

test('Health Supervisor scope returns only their assigned barangay', async () => {
  const res = await service.getCommunityMap({ barangay: 'San Isidro', municipalityId: 'M1' });
  assert.equal(res.scope, 'barangay');
  assert.deepEqual(res.barangays.map((b) => b.name), ['San Isidro']);
  assert.equal(res.barangays[0].hasCoordinates, false);
  assert.equal(res.barangays[0].residents, 1);
});

test('MHO scope returns every barangay in the municipality', async () => {
  const res = await service.getCommunityMap({ barangay: null, municipalityId: 'M1' });
  assert.equal(res.scope, 'municipality');
  assert.deepEqual(res.barangays.map((b) => b.name).sort(), ['Old San Roque', 'San Antonio', 'San Isidro']);
});

test('barangays with verified coordinates are marked hasCoordinates; others are not', async () => {
  const res = await service.getCommunityMap({ barangay: null, municipalityId: 'M1' });
  const byName = Object.fromEntries(res.barangays.map((b) => [b.name, b]));
  assert.equal(byName['San Antonio'].hasCoordinates, true);
  assert.equal(byName['San Antonio'].latitude, 13.558173);
  assert.equal(byName['San Isidro'].hasCoordinates, false);
  assert.equal(byName['San Isidro'].latitude, null);
});

test('high-risk residents are counted from the latest visit vitals', async () => {
  const res = await service.getCommunityMap({ barangay: null, municipalityId: 'M1' });
  const byName = Object.fromEntries(res.barangays.map((b) => [b.name, b]));
  assert.equal(byName['San Antonio'].residents, 2);
  assert.equal(byName['San Antonio'].highRiskResidents, 1);
  assert.equal(byName['Old San Roque'].highRiskResidents, 0);
});

test('unfiltered map counts every scoped visit as a case and rolls up a summary', async () => {
  const res = await service.getCommunityMap({ barangay: null, municipalityId: 'M1' });
  const byName = Object.fromEntries(res.barangays.map((b) => [b.name, b]));
  // San Antonio: r2 has 2 visits (1 active submitted + 1 completed).
  assert.equal(byName['San Antonio'].caseCount, 2);
  assert.equal(byName['San Antonio'].activeCases, 1);
  assert.equal(byName['San Antonio'].completedCases, 1);
  // Old San Roque: r4 one active in_review visit.
  assert.equal(byName['Old San Roque'].caseCount, 1);
  assert.equal(byName['Old San Roque'].activeCases, 1);
  // Municipality summary aggregates all barangays.
  assert.equal(res.summary.totalCases, 3);
  assert.equal(res.summary.affectedBarangays, 2);
  assert.equal(res.summary.completedCases, 1);
});

test('condition filter restricts case counts to the matching disease', async () => {
  const tb = await service.getCommunityMap({ barangay: null, municipalityId: 'M1', condition: 'Tuberculosis' });
  const tbByName = Object.fromEntries(tb.barangays.map((b) => [b.name, b]));
  assert.equal(tb.condition, 'Tuberculosis');
  assert.equal(tbByName['San Antonio'].caseCount, 2); // both r2 visits are TB
  assert.equal(tbByName['Old San Roque'].caseCount, 0); // the dengue visit is excluded
  assert.equal(tb.summary.totalCases, 2);

  const dengue = await service.getCommunityMap({ barangay: null, municipalityId: 'M1', condition: 'Dengue' });
  const dengueByName = Object.fromEntries(dengue.barangays.map((b) => [b.name, b]));
  assert.equal(dengueByName['Old San Roque'].caseCount, 1);
  assert.equal(dengueByName['San Antonio'].caseCount, 0);
});

test('date filter bounds cases by visit date', async () => {
  // Only the January 2026 window: just r2's completed TB visit qualifies.
  const res = await service.getCommunityMap({
    barangay: null,
    municipalityId: 'M1',
    from: '2026-01-01',
    to: '2026-01-31',
  });
  const byName = Object.fromEntries(res.barangays.map((b) => [b.name, b]));
  assert.equal(byName['San Antonio'].caseCount, 1);
  assert.equal(byName['San Antonio'].completedCases, 1);
  assert.equal(byName['Old San Roque'].caseCount, 0);
});

test('intensity is relative to the busiest barangay (0..1)', async () => {
  const res = await service.getCommunityMap({ barangay: null, municipalityId: 'M1' });
  const byName = Object.fromEntries(res.barangays.map((b) => [b.name, b]));
  assert.equal(byName['San Antonio'].intensity, 1); // busiest (2 cases)
  assert.equal(byName['Old San Roque'].intensity, 0.5); // 1 of 2
  assert.equal(byName['San Isidro'].intensity, 0); // no cases
});

test('monthly trends count matching visits per month for the requested year', async () => {
  const now = new Date();
  const res = await service.getCommunityMapTrends({
    barangay: null,
    municipalityId: 'M1',
    condition: 'Tuberculosis',
    year: now.getFullYear(),
  });
  assert.equal(res.monthly.length, 12);
  // Robust across the calendar: the two TB visits are 2026-01-01 (completed)
  // and one recorded in the current month. Assert per-month only when the
  // current month is not January (so the two never collapse into one bucket).
  if (now.getFullYear() === 2026 && now.getMonth() !== 0) {
    assert.equal(res.monthly[0].cases, 1); // the January TB visit
    assert.equal(res.monthly[now.getMonth()].cases, 1); // the this-month TB visit
  }
});

test('condition options come from the recognised condition list', async () => {
  const { conditions } = await service.getConditionOptions();
  assert.ok(conditions.includes('Tuberculosis'));
  assert.ok(conditions.includes('Dengue'));
  assert.ok(conditions.includes('Hypertension'));
});

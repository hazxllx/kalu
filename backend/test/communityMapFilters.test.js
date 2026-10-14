import assert from 'node:assert/strict';
import test from 'node:test';

import repository from '../src/repositories/index.js';
import { getCommunityMap as getCommunityMapController } from '../src/controllers/analytics.controller.js';
import {
  COMMUNITY_MAP_RISK_LEVELS,
  COMMUNITY_MAP_STATUSES,
  getCommunityMap,
  getHouseholdMap,
  matchesCommunityMapRecord,
} from '../src/services/analytics.service.js';

test('community map supports only consultation workflow statuses and recorded risk categories', () => {
  assert.deepEqual(COMMUNITY_MAP_STATUSES, [
    'draft',
    'submitted',
    'received',
    'in_review',
    'referred',
    'completed',
  ]);
  assert.deepEqual(COMMUNITY_MAP_RISK_LEVELS, ['High', 'Moderate', 'Low', 'Unassessed']);
});

test('community map API rejects barangays outside the approved deployment scope', async () => {
  await assert.rejects(
    () => getCommunityMapController({
      query: { barangay: 'Unknown Barangay' },
      assignedBarangay: null,
      user: { municipalityId: 'municipality-1' },
    }, {}),
    (error) => error.statusCode === 422,
  );
});

test('case filters combine actual condition, supported status, risk and inclusive dates', () => {
  const visit = {
    status: 'completed',
    chiefComplaint: 'Dengue fever',
    visitDate: '2026-05-14T10:00:00.000Z',
    vitals: { bp: '145/95' },
  };
  const filters = {
    condition: 'Dengue',
    status: 'completed',
    riskLevel: 'High',
    fromTs: new Date('2026-05-14T00:00:00.000Z').getTime(),
    toTs: new Date('2026-05-14T23:59:59.999Z').getTime(),
  };

  assert.equal(matchesCommunityMapRecord(visit, filters), true);
  assert.equal(matchesCommunityMapRecord(visit, { ...filters, status: 'submitted' }), false);
  assert.equal(matchesCommunityMapRecord(visit, { ...filters, condition: 'Malaria' }), false);
  assert.equal(matchesCommunityMapRecord(visit, { ...filters, riskLevel: 'Low' }), false);
  assert.equal(matchesCommunityMapRecord(visit, { ...filters, fromTs: filters.toTs + 1 }), false);
});

test('unassessed records match only the explicit Unassessed risk filter', () => {
  const visit = {
    status: 'submitted',
    chiefComplaint: 'Cough',
    visitDate: '2026-05-14T10:00:00.000Z',
    vitals: {},
  };
  assert.equal(matchesCommunityMapRecord(visit, { riskLevel: 'Unassessed' }), true);
  assert.equal(matchesCommunityMapRecord(visit, { riskLevel: 'Low' }), false);
});

test('community map applies filters before producing barangay aggregates', async (t) => {
  const originals = {
    listBarangays: repository.listBarangays,
    listVisits: repository.listVisits,
    listTclEntries: repository.listTclEntries,
    searchResidents: repository.searchResidents,
  };
  repository.listBarangays = async () => [
    { id: 'san-antonio', name: 'San Antonio', municipality_id: 'municipality-1', latitude: 13.5581, longitude: 123.273 },
    { id: 'barangay-1', name: 'San Isidro', municipality_id: 'municipality-1', latitude: 13.55, longitude: 123.27 },
    { id: 'barangay-2', name: 'Old San Roque', municipality_id: 'municipality-1', latitude: 13.56, longitude: 123.28 },
  ];
  repository.listVisits = async () => ({
    rows: [
      {
        id: 'visit-1',
        residentId: 'resident-1',
        chiefComplaint: 'Dengue fever',
        status: 'completed',
        visitDate: '2026-05-14T10:00:00.000Z',
        createdAt: '2026-05-14T10:00:00.000Z',
        updatedAt: '2026-05-14T12:00:00.000Z',
        vitals: { bp: '145/95' },
      },
      {
        id: 'visit-2',
        residentId: 'resident-1',
        chiefComplaint: 'Dengue fever',
        status: 'submitted',
        visitDate: '2026-05-14T11:00:00.000Z',
        createdAt: '2026-05-14T11:00:00.000Z',
        updatedAt: '2026-05-14T11:00:00.000Z',
        vitals: { bp: '118/76' },
      },
      {
        id: 'visit-3',
        residentId: 'resident-2',
        chiefComplaint: 'Dengue fever',
        status: 'completed',
        visitDate: '2026-05-14T10:00:00.000Z',
        createdAt: '2026-05-14T10:00:00.000Z',
        updatedAt: '2026-05-14T10:00:00.000Z',
        vitals: { bp: '145/95' },
      },
    ],
  });
  repository.listTclEntries = async () => ({ rows: [] });
  repository.searchResidents = async () => [
    { id: 'resident-1', barangayId: 'barangay-1', municipalityId: 'municipality-1' },
    { id: 'resident-2', barangayId: 'barangay-2', municipalityId: 'municipality-1' },
  ];
  t.after(() => {
    Object.assign(repository, originals);
  });

  const result = await getCommunityMap({
    municipalityId: 'municipality-1',
    condition: 'Dengue',
    status: 'completed',
    riskLevel: 'High',
    from: '2026-05-14',
    to: '2026-05-14',
  });

  assert.equal(result.summary.totalCases, 2);
  assert.equal(result.latestUpdatedAt, '2026-05-14T12:00:00.000Z');
  assert.equal(result.scopeComplete, true);
  assert.equal(result.barangays.find((row) => row.name === 'San Isidro').caseCount, 1);
  assert.equal(result.barangays.find((row) => row.name === 'San Isidro').riskCounts.High, 1);
  assert.equal(result.barangays.find((row) => row.name === 'San Isidro').statusCounts.completed, 1);
  assert.equal(result.barangays.find((row) => row.name === 'Old San Roque').caseCount, 1);
});

test('MHO map mode counts one resident-condition case and returns filter-matched totals', async (t) => {
  const originals = {
    listBarangays: repository.listBarangays,
    listVisits: repository.listVisits,
    listTclEntries: repository.listTclEntries,
    searchResidents: repository.searchResidents,
  };
  repository.listBarangays = async () => [
    { id: 'barangay-1', name: 'San Antonio', municipality_id: 'municipality-1', latitude: 13.5581, longitude: 123.273 },
    { id: 'barangay-2', name: 'San Isidro', municipality_id: 'municipality-1', latitude: 13.56, longitude: 123.28 },
    { id: 'barangay-3', name: 'Old San Roque', municipality_id: 'municipality-1', latitude: 13.57, longitude: 123.29 },
  ];
  repository.listVisits = async () => ({
    rows: [
      {
        id: 'visit-1',
        residentId: 'resident-1',
        chiefComplaint: 'Cough',
        status: 'completed',
        visitDate: '2026-05-14T10:00:00.000Z',
        createdAt: '2026-05-14T10:00:00.000Z',
      },
      {
        id: 'visit-2',
        residentId: 'resident-1',
        chiefComplaint: 'Cough',
        status: 'completed',
        visitDate: '2026-05-15T10:00:00.000Z',
        createdAt: '2026-05-15T10:00:00.000Z',
      },
      {
        id: 'visit-3',
        residentId: 'resident-1',
        chiefComplaint: 'Dengue fever',
        status: 'completed',
        visitDate: '2026-05-16T10:00:00.000Z',
        createdAt: '2026-05-16T10:00:00.000Z',
      },
      {
        id: 'visit-4',
        residentId: 'resident-2',
        chiefComplaint: 'Dengue fever',
        status: 'completed',
        visitDate: '2026-05-17T10:00:00.000Z',
        createdAt: '2026-05-17T10:00:00.000Z',
      },
    ],
  });

  repository.listTclEntries = async () => ({ rows: [] });
  repository.searchResidents = async () => [
    { id: 'resident-1', barangayId: 'barangay-1', municipalityId: 'municipality-1' },
    { id: 'resident-2', barangayId: 'barangay-1', municipalityId: 'municipality-1' },
  ];
  t.after(() => {
    Object.assign(repository, originals);
  });

  const result = await getCommunityMap({
    municipalityId: 'municipality-1',
    distinctResidents: true,
    from: '2026-05-14',
    to: '2026-05-17',
  });

  assert.equal(result.summary.totalCases, 3);
  assert.equal(result.barangays[0].caseCount, 3);
  assert.deepEqual(result.barangays[0].conditions, [
    { name: 'Dengue', value: 2 },
    { name: 'Respiratory', value: 1 },
  ]);
  assert.equal(result.barangays[0].topCondition.name, 'Dengue');
  assert.equal(result.conditionTotals.find((item) => item.name === 'Dengue').value, 2);
  assert.equal(result.conditionTotals.find((item) => item.name === 'Respiratory').value, 1);
});

test('MHO maps exclude unapproved barangays even when records reference them', async (t) => {
  const originals = {
    listBarangays: repository.listBarangays,
    listVisits: repository.listVisits,
    listTclEntries: repository.listTclEntries,
    searchResidents: repository.searchResidents,
  };
  repository.listBarangays = async () => [
    { id: 'approved', name: 'San Antonio', municipality_id: 'municipality-1' },
    { id: 'approved-2', name: 'San Isidro', municipality_id: 'municipality-1' },
    { id: 'approved-3', name: 'Old San Roque', municipality_id: 'municipality-1' },
    { id: 'legacy', name: 'Legacy Barangay', municipality_id: 'municipality-1', status: 'Inactive' },
  ];
  repository.listVisits = async () => ({
    rows: [
      {
        id: 'approved-visit',
        residentId: 'approved-resident',
        chiefComplaint: 'Dengue',
        status: 'completed',
        visitDate: '2026-05-14T10:00:00.000Z',
      },
      {
        id: 'legacy-visit',
        residentId: 'legacy-resident',
        chiefComplaint: 'Dengue',
        status: 'completed',
        visitDate: '2026-05-14T10:00:00.000Z',
      },
    ],
  });
  repository.listTclEntries = async () => ({ rows: [] });
  repository.searchResidents = async () => [
    { id: 'approved-resident', barangayId: 'approved', municipalityId: 'municipality-1' },
    { id: 'legacy-resident', barangayId: 'legacy', municipalityId: 'municipality-1' },
  ];
  t.after(() => {
    Object.assign(repository, originals);
  });

  const result = await getCommunityMap({ municipalityId: 'municipality-1' });

  assert.equal(result.summary.totalCases, 1);
  assert.deepEqual(result.barangays.map((row) => row.name), ['San Antonio', 'San Isidro', 'Old San Roque']);
  assert.equal(result.barangays.some((row) => row.name === 'Legacy Barangay'), false);
});

test('municipality map returns only registered in-scope approved barangays', async (t) => {
  const originals = {
    listBarangays: repository.listBarangays,
    listVisits: repository.listVisits,
    listTclEntries: repository.listTclEntries,
    searchResidents: repository.searchResidents,
  };
  repository.listBarangays = async () => [
    { id: 'isidro', name: 'San Isidro', municipality_id: 'municipality-1', latitude: 13.56, longitude: 123.27 },
    { id: 'old-san-roque', name: 'Old San Roque', municipality_id: 'municipality-1', latitude: 13.55, longitude: 123.28 },
    { id: 'antonio', name: 'San Antonio', municipality_id: 'municipality-1', status: 'Active' },
  ];
  repository.listVisits = async () => ({ rows: [] });
  repository.listTclEntries = async () => ({ rows: [] });
  repository.searchResidents = async () => [];
  t.after(() => {
    Object.assign(repository, originals);
  });

  const result = await getCommunityMap({ municipalityId: 'municipality-1' });

  assert.deepEqual(result.barangays.map((row) => row.name), ['San Antonio', 'San Isidro', 'Old San Roque']);
  assert.equal(result.barangays.some((row) => row.name === 'Legacy Barangay'), false);
  assert.equal(result.scopeComplete, true);
  assert.deepEqual(result.barangays.map((row) => row.caseCount), [0, 0, 0]);
  assert.equal(result.summary.totalCases, 0);
  assert.equal(result.conditionTotals[0].value, 0);
});

test('registered approved barangays with no cases are returned as verified zeroes', async (t) => {
  const originals = {
    listBarangays: repository.listBarangays,
    listVisits: repository.listVisits,
    listTclEntries: repository.listTclEntries,
    searchResidents: repository.searchResidents,
  };
  repository.listBarangays = async () => [
    { id: 'antonio', name: 'San Antonio', municipality_id: 'municipality-1' },
    { id: 'isidro', name: 'San Isidro', municipality_id: 'municipality-1' },
    { id: 'old-san-roque', name: 'Old San Roque', municipality_id: 'municipality-1' },
  ];
  repository.listVisits = async () => ({ rows: [] });
  repository.listTclEntries = async () => ({ rows: [] });
  repository.searchResidents = async () => [];
  t.after(() => {
    Object.assign(repository, originals);
  });

  const result = await getCommunityMap({ municipalityId: 'municipality-1' });

  assert.equal(result.scopeComplete, true);
  assert.deepEqual(result.barangays.map((row) => row.caseCount), [0, 0, 0]);
  assert.equal(result.summary.totalCases, 0);
});

test('household map aggregates only at stored barangay reference coordinates', async (t) => {
  const originals = {
    listHouseholdsForMap: repository.listHouseholdsForMap,
    listVisits: repository.listVisits,
    listTclEntries: repository.listTclEntries,
    listBarangays: repository.listBarangays,
  };
  repository.listHouseholdsForMap = async () => [{
    id: 'private-household-id',
    barangay: 'San Isidro',
    barangayId: 'barangay-1',
    latitude: 13.123456,
    longitude: 123.654321,
    memberCount: 3,
    residentIds: ['private-resident-id'],
  }];
  repository.listVisits = async () => ({ rows: [] });
  repository.listTclEntries = async () => ({ rows: [] });
  repository.listBarangays = async () => [{
    id: 'barangay-1',
    name: 'San Isidro',
    latitude: 13.5597,
    longitude: 123.272,
  }];
  t.after(() => {
    Object.assign(repository, originals);
  });

  const result = await getHouseholdMap({ municipalityId: 'municipality-1' });

  assert.deepEqual(result.locations, [{
    barangay: 'San Isidro',
    householdCount: 1,
    memberCount: 3,
    activeHouseholds: 0,
    hasCoordinates: true,
    latitude: 13.5597,
    longitude: 123.272,
  }]);
  assert.equal(JSON.stringify(result).includes('private-household-id'), false);
  assert.equal(JSON.stringify(result).includes('private-resident-id'), false);
  assert.equal(JSON.stringify(result).includes('13.123456'), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import repository from '../src/repositories/index.js';
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
    { id: 'barangay-1', name: 'San Isidro', municipality_id: 'municipality-1', latitude: 13.55, longitude: 123.27 },
    { id: 'barangay-2', name: 'San Antonio', municipality_id: 'municipality-1', latitude: 13.56, longitude: 123.28 },
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
  assert.equal(result.barangays[0].caseCount, 1);
  assert.equal(result.barangays[0].riskCounts.High, 1);
  assert.equal(result.barangays[0].statusCounts.completed, 1);
  assert.equal(result.barangays[1].caseCount, 1);
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

import assert from 'node:assert/strict';
import test from 'node:test';

import repository from '../src/repositories/index.js';
import { getResidentDirectoryFilters, listResidents } from '../src/services/residents.service.js';

const municipalityId = 'municipality-pili';
const barangays = [
  { id: 'barangay-a', name: 'San Isidro', status: 'Active', municipality_id: municipalityId },
  { id: 'barangay-b', name: 'San Antonio', status: 'Active', municipality_id: municipalityId },
  { id: 'barangay-other', name: 'Other Municipality', status: 'Active', municipality_id: 'other' },
];

const originalDriver = repository.driver;
const originalListBarangays = repository.listBarangays;
const originalListResidents = repository.listResidents;
const originalZoneOptions = repository.listResidentZoneOptions;

test.after(() => {
  repository.driver = originalDriver;
  repository.listBarangays = originalListBarangays;
  repository.listResidents = originalListResidents;
  repository.listResidentZoneOptions = originalZoneOptions;
});

test('PHN barangay options are restricted to active approved barangays in the assigned municipality', async () => {
  repository.driver = 'supabase';
  repository.listBarangays = async ({ municipalityId: requested }) => barangays.filter((row) => row.municipality_id === requested);

  const result = await getResidentDirectoryFilters({ user: { role: 'phn', municipalityId } });

  assert.equal(result.geography, 'barangay');
  assert.deepEqual(result.barangays.map((row) => row.id), ['barangay-a', 'barangay-b']);
});

test('PHN resident queries filter by barangay ID and remain municipality-scoped', async () => {
  repository.driver = 'supabase';
  repository.listBarangays = async ({ municipalityId: requested }) => barangays.filter((row) => row.municipality_id === requested);
  let query;
  repository.listResidents = async (params) => { query = params; return { rows: [], total: 0 }; };

  await listResidents({ user: { role: 'phn', municipalityId }, barangayId: 'barangay-a', verifiedOnly: false });
  assert.equal(query.barangayId, 'barangay-a');
  assert.equal(query.municipalityId, municipalityId);
});

test('Health Supervisor zone options and list queries are restricted to the assigned barangay', async () => {
  repository.driver = 'supabase';
  repository.listBarangays = async ({ municipalityId: requested }) => barangays.filter((row) => row.municipality_id === requested);
  let optionsScope;
  repository.listResidentZoneOptions = async (scope) => {
    optionsScope = scope;
    return { zones: [1, 3], hasUnassigned: true };
  };
  let query;
  repository.listResidents = async (params) => { query = params; return { rows: [], total: 0 }; };
  const user = { role: 'health_supervisor', municipalityId, barangayId: 'barangay-a', barangay: 'San Isidro' };

  const filters = await getResidentDirectoryFilters({ user });
  await listResidents({ user, zone: '3', verifiedOnly: false });

  assert.equal(optionsScope.barangayId, 'barangay-a');
  assert.deepEqual(filters.zones, [1, 3]);
  assert.equal(filters.hasUnassigned, true);
  assert.equal(query.barangayId, 'barangay-a');
  assert.equal(query.zone, 3);
  assert.equal(query.municipalityId, municipalityId);
});

test('Health Supervisor uses one numeric Zone filter value for resident and household Purok assignments', async () => {
  repository.driver = 'supabase';
  repository.listBarangays = async ({ municipalityId: requested }) => barangays.filter((row) => row.municipality_id === requested);
  let query;
  repository.listResidents = async (params) => { query = params; return { rows: [], total: 0 }; };
  const user = { role: 'health_supervisor', municipalityId, barangayId: 'barangay-a', barangay: 'San Isidro' };

  await listResidents({ user, zone: '5', verifiedOnly: false });

  assert.equal(query.zone, 5);
  assert.equal(query.barangayId, 'barangay-a');
});

test('Health Supervisor cannot request another barangay by changing the filter ID', async () => {
  repository.driver = 'supabase';
  repository.listBarangays = async ({ municipalityId: requested }) => barangays.filter((row) => row.municipality_id === requested);

  await assert.rejects(
    () => listResidents({
      user: { role: 'health_supervisor', municipalityId, barangayId: 'barangay-a', barangay: 'San Isidro' },
      barangayId: 'barangay-b',
    }),
    (error) => error.statusCode === 403,
  );
});

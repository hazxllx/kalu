import assert from 'node:assert/strict';
import test from 'node:test';
import { searchGuardianCandidates } from '../src/services/guardianLinks.service.js';
import { searchResidents as searchIntakeResidents } from '../src/services/intake.service.js';

const resident = (id, barangay) => ({
  id,
  healthRecordNo: `RHU-${id}`,
  firstName: 'Maria',
  lastName: 'Santos',
  birthDate: '1990-01-01',
  barangay,
});

const scopedRepository = (rows) => ({
  async searchResidents({ barangay, municipalityId }) {
    return rows.filter((row) =>
      (!barangay || row.barangay === barangay) &&
      (!municipalityId || row.municipalityId === municipalityId),
    );
  },
  async listResidents({ municipalityId }) {
    return {
      rows: rows.filter((row) => !municipalityId || row.municipalityId === municipalityId),
    };
  },
});

test('BHW and Health Supervisor searches are forced to their assigned barangay', async () => {
  const rows = [
    { ...resident('A', 'Barangay A'), municipalityId: 'mun-1' },
    { ...resident('B', 'Barangay B'), municipalityId: 'mun-1' },
  ];
  const repo = scopedRepository(rows);
  const calls = [];
  repo.searchResidents = async (args) => {
    calls.push(args);
    return rows.filter((row) =>
      (!args.barangay || row.barangay === args.barangay) &&
      (!args.municipalityId || row.municipalityId === args.municipalityId),
    );
  };

  for (const role of ['bhw', 'health_supervisor']) {
    const result = await searchGuardianCandidates({
      user: { role, barangay: 'Barangay A', municipalityId: 'mun-1' },
      q: 'Maria',
      repo,
    });
    assert.deepEqual(result.map((row) => row.id), ['A']);
  }

  assert.deepEqual(calls, [
    { q: 'Maria', limit: 10, barangay: 'Barangay A', municipalityId: 'mun-1' },
    { q: 'Maria', limit: 10, barangay: 'Barangay A', municipalityId: 'mun-1' },
  ]);

  const intakeResult = await searchIntakeResidents({
    user: { role: 'bhw', barangay: 'Barangay A', municipalityId: 'mun-1' },
    q: 'Maria',
    repo,
  });
  assert.deepEqual(intakeResult.map((row) => row.id), ['A']);
});

test('municipality-wide guardian search is constrained to the municipality', async () => {
  const rows = [
    { ...resident('A', 'Barangay A'), municipalityId: 'mun-1' },
    { ...resident('B', 'Barangay B'), municipalityId: 'mun-1' },
    { ...resident('C', 'Barangay C'), municipalityId: 'mun-2' },
  ];
  const calls = [];
  const repo = {
    async searchResidents() {
      throw new Error('municipality-wide search must use scoped directory listing');
    },
    async listResidents(args) {
      calls.push(args);
      return { rows: rows.filter((row) => row.municipalityId === args.municipalityId) };
    },
  };

  const result = await searchGuardianCandidates({
    user: { role: 'phn', municipalityId: 'mun-1' },
    q: 'Maria',
    repo,
  });
  assert.deepEqual(result.map((row) => row.id), ['A', 'B']);
  assert.deepEqual(calls, [{ q: 'Maria', limit: 10, municipalityId: 'mun-1' }]);
});

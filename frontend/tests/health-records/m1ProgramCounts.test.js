import test from 'node:test';
import assert from 'node:assert/strict';
import { loadM1ProgramCounts } from '../../src/services/api/m1ProgramsApi.js';

const programIds = ['prenatal', 'ncd', 'cervical', 'visual', 'oral', 'environmental', 'enrollment'];

test('overview loads actual scoped counts for all seven M1 programs', async () => {
  const calls = [];
  const clients = Object.fromEntries(programIds.map((programId, index) => [programId, {
    list: async (params) => {
      calls.push([programId, params]);
      return { count: { records: index + 1 } };
    },
  }]));
  const params = { period: 'quarterly', year: 2026, quarter: 3 };
  const result = await loadM1ProgramCounts(params, clients);
  assert.deepEqual(result, Object.fromEntries(programIds.map((programId, index) => [programId, index + 1])));
  assert.deepEqual(calls, programIds.map((programId) => [programId, params]));
});

test('overview rejects failed or malformed counts instead of displaying false zeroes', async () => {
  await assert.rejects(loadM1ProgramCounts({}, { enrollment: { list: async () => ({ count: { records: null } }) } }), /Invalid enrollment/);
  await assert.rejects(loadM1ProgramCounts({}, { oral: { list: async () => { throw new Error('Oral store unavailable'); } } }), /Oral store unavailable/);
});

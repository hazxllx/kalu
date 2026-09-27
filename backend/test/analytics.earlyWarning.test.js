import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import repository from '../src/repositories/index.js';
import * as service from '../src/services/analytics.service.js';

/**
 * Early Warning geographic-scope tests.
 *
 * Health Supervisor -> assigned barangay only; MHO -> their municipality only.
 * A barangay string is always additionally constrained by the caller's
 * municipality, so a same-named barangay in another municipality cannot leak.
 */

const STUBBED = ['listVisits', 'listReferrals', 'searchResidents'];
const original = {};

const RESIDENTS = [
  { id: 'r1', barangay: 'San Isidro', municipalityId: 'M1' },
  { id: 'r2', barangay: 'San Antonio', municipalityId: 'M1' },
  { id: 'r3', barangay: 'San Jose', municipalityId: 'M2' },
  { id: 'r4', barangay: 'San Antonio', municipalityId: 'M2' }, // same name, other municipality
];

before(() => {
  for (const k of STUBBED) original[k] = repository[k];
  repository.searchResidents = async () => RESIDENTS.map((r) => ({ ...r }));
  repository.listVisits = async () => ({ rows: [] });
  repository.listReferrals = async () => ({ rows: [] });
});

after(() => { for (const k of STUBBED) repository[k] = original[k]; });

test('Health Supervisor sees only their assigned barangay (and only within their municipality)', async () => {
  const res = await service.getEarlyWarning({ barangay: 'San Antonio', municipalityId: 'M1' });
  // r2 only — r4 is "San Antonio" but in M2 and must not leak.
  assert.equal(res.summary.residents, 1);
});

test('MHO sees every resident in their municipality only', async () => {
  const res = await service.getEarlyWarning({ barangay: null, municipalityId: 'M1' });
  assert.equal(res.summary.residents, 2); // r1 + r2, never r3/r4 (M2)
});

test('MHO does not receive another municipality\'s data', async () => {
  const res = await service.getEarlyWarning({ barangay: null, municipalityId: 'M2' });
  assert.equal(res.summary.residents, 2); // r3 + r4
});

test('a barangay drill-down is constrained to the caller\'s municipality', async () => {
  // An M1 caller asking for "San Jose" (which only exists in M2) gets nothing.
  const res = await service.getEarlyWarning({ barangay: 'San Jose', municipalityId: 'M1' });
  assert.equal(res.summary.residents, 0);
});

test('scope object still reports the requested barangay for the frontend', async () => {
  const res = await service.getEarlyWarning({ barangay: 'San Isidro', municipalityId: 'M1' });
  assert.equal(res.scope.barangay, 'San Isidro');
  assert.equal(res.summary.residents, 1);
});

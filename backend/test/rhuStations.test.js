import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RHU_STATIONS,
  normalizeStations,
  hasStation,
  canTriage,
  canConsult,
  canInitiateCertificate,
} from '../src/config/rhuStations.js';

/**
 * RHU station authorization. Triage and Consultation are separate operational
 * permissions, separate from the account role and barangay assignment.
 */

test('normalizeStations accepts arrays, comma strings and JSON strings', () => {
  assert.deepEqual(normalizeStations(['triage', 'consultation']), ['triage', 'consultation']);
  assert.deepEqual(normalizeStations('triage, consultation'), ['triage', 'consultation']);
  assert.deepEqual(normalizeStations('["triage","consultation"]'), ['triage', 'consultation']);
  assert.deepEqual(normalizeStations('triage,triage'), ['triage']);
  assert.deepEqual(normalizeStations(['triage', 'radiology']), ['triage']);
  assert.deepEqual(normalizeStations(undefined), []);
});

test('RHU Personnel triage requires the Triage station', () => {
  assert.equal(canTriage({ role: 'rhu_personnel', rhuStations: ['triage'] }), true);
  assert.equal(canTriage({ role: 'rhu_personnel', rhuStations: ['consultation'] }), false);
  assert.equal(canTriage({ role: 'rhu_personnel', rhuStations: [] }), false);
});

test('a Health Supervisor retains community intake regardless of station', () => {
  assert.equal(canTriage({ role: 'health_supervisor', rhuStations: [] }), true);
});

test('Consultation requires the Consultation station, except for the PHN', () => {
  assert.equal(canConsult({ role: 'phn', rhuStations: [] }), true);
  assert.equal(canConsult({ role: 'rhu_personnel', rhuStations: ['consultation'] }), true);
  assert.equal(canConsult({ role: 'rhu_personnel', rhuStations: ['triage'] }), false);
  assert.equal(canConsult({ role: 'health_supervisor', rhuStations: ['consultation'] }), true);
  assert.equal(canConsult({ role: 'health_supervisor', rhuStations: [] }), false);
  // Roles that never consult, even with the station set.
  assert.equal(canConsult({ role: 'bhw', rhuStations: ['consultation'] }), false);
  assert.equal(canConsult({ role: 'resident', rhuStations: ['consultation'] }), false);
});

test('a person with both stations may both triage and consult', () => {
  const both = { role: 'rhu_personnel', rhuStations: ['triage', 'consultation'] };
  assert.equal(canTriage(both), true);
  assert.equal(canConsult(both), true);
  assert.equal(hasStation(both, RHU_STATIONS.CONSULTATION), true);
});

test('only a Triage-station RHU Personnel may initiate a certificate request', () => {
  assert.equal(canInitiateCertificate({ role: 'rhu_personnel', rhuStations: ['triage'] }), true);
  assert.equal(canInitiateCertificate({ role: 'rhu_personnel', rhuStations: ['consultation'] }), false);
  assert.equal(canInitiateCertificate({ role: 'health_supervisor', rhuStations: ['triage'] }), false);
  assert.equal(canInitiateCertificate({ role: 'phn', rhuStations: [] }), false);
});

test('access is strictly separated: a station-less RHU account gets neither feature', () => {
  // No legacy both-access: only an explicit station grants a feature.
  const unassigned = { role: 'rhu_personnel', rhuStations: [] };
  assert.equal(canTriage(unassigned), false);
  assert.equal(canConsult(unassigned), false);
  assert.equal(canInitiateCertificate(unassigned), false);

  // The shared consultation queue admits the PHN always; a Health Supervisor
  // only with the Consultation station (their barangay consultation is separate).
  assert.equal(canConsult({ role: 'phn', rhuStations: [] }), true);
  assert.equal(canConsult({ role: 'health_supervisor', rhuStations: [] }), false);
  assert.equal(canConsult({ role: 'health_supervisor', rhuStations: ['consultation'] }), true);
});

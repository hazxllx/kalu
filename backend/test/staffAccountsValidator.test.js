import test from 'node:test';
import assert from 'node:assert/strict';

import { registerPersonnelValidator } from '../src/validators/staffAccounts.validators.js';

/**
 * Registration captures the RHU station assignment. RHU Personnel must pick
 * exactly one station; a Health Supervisor may optionally add Consultation;
 * every other role carries none. The station is normalized server-side and the
 * validator rejects anything else before the request is ever written.
 */

const base = {
  fullName: 'Juan Dela Cruz',
  email: 'juan@example.com',
  password: 'password1',
};

test('RHU Personnel registration requires exactly one station', () => {
  const triage = registerPersonnelValidator({ ...base, role: 'rhu_personnel', rhuStations: ['triage'] });
  assert.equal(triage.error, undefined);
  assert.deepEqual(triage.value.rhuStations, ['triage']);

  const consult = registerPersonnelValidator({ ...base, role: 'rhu_personnel', rhuStations: 'consultation' });
  assert.equal(consult.error, undefined);
  assert.deepEqual(consult.value.rhuStations, ['consultation']);

  const none = registerPersonnelValidator({ ...base, role: 'rhu_personnel', rhuStations: [] });
  assert.ok(none.error?.rhuStations);

  const both = registerPersonnelValidator({
    ...base,
    role: 'rhu_personnel',
    rhuStations: ['triage', 'consultation'],
  });
  assert.ok(both.error?.rhuStations);
});

test('a Health Supervisor may only (optionally) hold the Consultation station', () => {
  const withConsult = registerPersonnelValidator({
    ...base,
    role: 'health_supervisor',
    barangay: 'San Isidro',
    rhuStations: ['consultation'],
  });
  assert.equal(withConsult.error, undefined);
  assert.deepEqual(withConsult.value.rhuStations, ['consultation']);

  const noStation = registerPersonnelValidator({
    ...base,
    role: 'health_supervisor',
    barangay: 'San Isidro',
    rhuStations: [],
  });
  assert.equal(noStation.error, undefined);
  assert.deepEqual(noStation.value.rhuStations, []);

  const triage = registerPersonnelValidator({
    ...base,
    role: 'health_supervisor',
    barangay: 'San Isidro',
    rhuStations: ['triage'],
  });
  assert.ok(triage.error?.rhuStations);
});

test('a role that is not station-assigned cannot carry a station', () => {
  const bhw = registerPersonnelValidator({
    ...base,
    role: 'bhw',
    barangay: 'San Isidro',
    rhuStations: ['triage'],
  });
  assert.ok(bhw.error?.rhuStations);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { registerPersonnelValidator } from '../src/validators/staffAccounts.validators.js';

/**
 * Registration captures the RHU station assignment and the applicant's contact
 * number. RHU Personnel must pick exactly one station; every other role carries
 * none (the former optional Health Supervisor "RHU Consultation" opt-in has been
 * removed). The contact number must be an exact 11-digit PH mobile. The
 * validator is server-authoritative and rejects anything else before a request
 * is ever written.
 */

const base = {
  fullName: 'Juan Dela Cruz',
  email: 'juan@example.com',
  phone: '09171234567',
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

test('a Health Supervisor can no longer carry an RHU station (optional field removed)', () => {
  const noStation = registerPersonnelValidator({
    ...base,
    role: 'health_supervisor',
    barangay: 'San Isidro',
    rhuStations: [],
  });
  assert.equal(noStation.error, undefined);
  assert.deepEqual(noStation.value.rhuStations, []);

  // The removed "RHU Consultation (optional)" opt-in must now be rejected if a
  // crafted request still tries to send it.
  const consult = registerPersonnelValidator({
    ...base,
    role: 'health_supervisor',
    barangay: 'San Isidro',
    rhuStations: ['consultation'],
  });
  assert.ok(consult.error?.rhuStations);

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

test('contact number must be an exact 11-digit PH mobile', () => {
  const valid = registerPersonnelValidator({ ...base, role: 'bhw', barangay: 'San Isidro' });
  assert.equal(valid.error, undefined);
  assert.equal(valid.value.phone, '09171234567');
});

test('contact number is required', () => {
  const missing = registerPersonnelValidator({
    ...base,
    phone: '',
    role: 'bhw',
    barangay: 'San Isidro',
  });
  assert.ok(missing.error?.phone);
});

test('contact number rejects letters and special characters', () => {
  for (const bad of ['0917abc4567', '0917-123-4567', '0917 123 4567', '+639171234567']) {
    const result = registerPersonnelValidator({
      ...base,
      phone: bad,
      role: 'bhw',
      barangay: 'San Isidro',
    });
    assert.ok(result.error?.phone, `expected "${bad}" to be rejected`);
  }
});

test('contact number rejects excess digits without silently truncating', () => {
  const tooLong = registerPersonnelValidator({
    ...base,
    phone: '091712345670000',
    role: 'bhw',
    barangay: 'San Isidro',
  });
  // The whole request is rejected; the over-long value is NOT cut down to 11
  // digits and accepted.
  assert.ok(tooLong.error?.phone);
  assert.equal(tooLong.value, undefined);
});

test('contact number rejects fewer than 11 digits and non-09 prefixes', () => {
  for (const bad of ['0917123456', '08171234567', '12345678901']) {
    const result = registerPersonnelValidator({
      ...base,
      phone: bad,
      role: 'bhw',
      barangay: 'San Isidro',
    });
    assert.ok(result.error?.phone, `expected "${bad}" to be rejected`);
  }
});

test('staff assignments accept only approved barangays', () => {
  for (const barangay of ['San Antonio', 'San Isidro', 'Old San Roque']) {
    const result = registerPersonnelValidator({
      ...base,
      role: 'bhw',
      barangay,
    });
    assert.equal(result.error, undefined, `${barangay} should be accepted`);
  }

  const rejected = registerPersonnelValidator({
    ...base,
    role: 'bhw',
    barangay: 'Unknown Barangay',
  });
  assert.ok(rejected.error?.barangay);
});

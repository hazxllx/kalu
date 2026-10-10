import assert from 'node:assert/strict';
import test from 'node:test';

// Keep the service module import (used by the validator) inert.
import env from '../src/config/env.js';
env.isSupabaseConfigured = false;

import { createServiceValidator } from '../src/validators/healthServices.validators.js';

const base = {
  name: 'Prenatal',
  category: 'Maternal',
  municipalityWide: true,
  startDate: '2026-11-02',
  startTime: '09:00',
  endTime: '12:00',
};

test('schedule: a valid same-day schedule is accepted and end_date defaults to start_date', () => {
  const { value, error } = createServiceValidator(base);
  assert.equal(error, undefined);
  assert.equal(value.startDate, '2026-11-02');
  assert.equal(value.startTime, '09:00');
  assert.equal(value.endDate, '2026-11-02', 'a one-day service ends on its start date');
  assert.equal(value.endTime, '12:00');
  assert.equal(value.registrationDeadline, null);
});

test('schedule: start date, start time and end time are required', () => {
  const { error } = createServiceValidator({ name: 'X', municipalityWide: true });
  assert.ok(error.startDate, 'start date required');
  assert.ok(error.startTime, 'start time required');
  assert.ok(error.endTime, 'end time required');
});

test('schedule: end before start is rejected', () => {
  const { error } = createServiceValidator({ ...base, endTime: '08:00' });
  assert.ok(error.endTime, 'end time earlier than start time is rejected');
});

test('schedule: an end date earlier than the start date is rejected', () => {
  const { error } = createServiceValidator({ ...base, endDate: '2026-11-01', endTime: '13:00' });
  assert.ok(error.endTime);
});

test('schedule: a multi-day service with a later end date is accepted', () => {
  const { value, error } = createServiceValidator({ ...base, endDate: '2026-11-03', endTime: '08:00' });
  assert.equal(error, undefined);
  assert.equal(value.endDate, '2026-11-03');
});

test('schedule: a registration deadline after the start is rejected', () => {
  const { error } = createServiceValidator({ ...base, registrationDeadline: '2026-11-02T10:00' });
  assert.ok(error.registrationDeadline);
});

test('schedule: a registration deadline at/before the start is accepted', () => {
  const { value, error } = createServiceValidator({ ...base, registrationDeadline: '2026-11-01T17:00' });
  assert.equal(error, undefined);
  assert.equal(value.registrationDeadline, '2026-11-01T17:00');
});

test('schedule: malformed date/time values are rejected', () => {
  assert.ok(createServiceValidator({ ...base, startDate: '11/02/2026' }).error.startDate);
  assert.ok(createServiceValidator({ ...base, startTime: '9am' }).error.startTime);
  assert.ok(createServiceValidator({ ...base, registrationDeadline: '2026-11-01 17:00' }).error.registrationDeadline);
});

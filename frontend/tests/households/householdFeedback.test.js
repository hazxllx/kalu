import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHouseholdField as validate, householdFieldErrors, safeHouseholdError } from '../../src/features/households/lib/householdFeedback.js';

test('required and optional fields retain their different validation rules', () => {
  for (const field of ['headName', 'purok', 'streetAddress']) assert.ok(validate(field, '  '));
  assert.equal(validate('contact', ''), '');
  assert.equal(validate('birthday', '', { member: true }), '');
  assert.ok(validate('relationship', '', { member: true, adding: true }));
  assert.equal(validate('relationship', '', { member: true }), '');
});
test('numeric, phone and calendar validation matches permitted input formats', () => {
  assert.ok(validate('families', 0)); assert.ok(validate('families', 1.5));
  assert.equal(validate('families', 50), ''); assert.ok(validate('families', 51));
  assert.ok(validate('age', 121)); assert.equal(validate('age', 0), '');
  assert.ok(validate('monthlyIncome', -1)); assert.equal(validate('monthlyIncome', 0), '');
  assert.equal(validate('contact', '+63 912-345-6789'), ''); assert.ok(validate('contact', '123'));
  assert.ok(validate('visitDate', '2026-02-30')); assert.ok(validate('visitDate', ''));
  assert.equal(validate('visitDate', '2024-02-29'), ''); assert.ok(validate('visitReason', ''));
});
test('API field keys normalize to editable household/member/visit fields', () => {
  assert.deepEqual(householdFieldErrors({ status: 422, payload: { error: { errors: { 'members[0]': 'Name is required.', 'members[0].contact': 'Invalid phone.', 'visit.visitDate': 'Invalid date.' } } } }), { name: 'Name is required.', contact: 'Invalid phone.', visitDate: 'Invalid date.' });
  assert.deepEqual(householdFieldErrors({ status: 500, payload: { error: { details: { name: 'private data' } } } }), {});
});
test('technical failures never expose backend internals while safe action guidance survives', () => {
  const fallback = 'Please retry.';
  assert.equal(safeHouseholdError({ status: 500, message: 'SQL stack trace' }, fallback), fallback);
  assert.equal(safeHouseholdError({ status: 422, message: 'constraint failed in schema' }, fallback), fallback);
  assert.equal(safeHouseholdError({ status: 403, message: 'Only the supervisor may approve.' }, fallback), 'Only the supervisor may approve.');
});

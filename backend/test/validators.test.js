import test from 'node:test';
import assert from 'node:assert/strict';

import validate, { signInValidator } from '../src/validators/auth.validators.js';
import { registerResidentValidator } from '../src/validators/registration.validators.js';
import {
  approveValidator,
  decisionValidator,
  rejectValidator,
  requestResubmissionValidator,
  verificationIdParamValidator,
  verificationRefParamValidator,
} from '../src/validators/verification.validators.js';
import {
  createHouseholdValidator,
  householdParamsValidator,
  updateHouseholdValidator,
  householdMemberValidator,
} from '../src/validators/household.validators.js';
import validateMw from '../src/middleware/validate.js';
import ApiError from '../src/utils/apiError.js';

const next = () => {};

test('signInValidator rejects empty email/password', () => {
  const result = signInValidator({});
  assert.equal(result.error.email, 'Email is required.');
  assert.equal(result.error.password, 'Password is required.');
});

test('signInValidator rejects malformed email', () => {
  const result = signInValidator({ email: 'not-an-email', password: 'x' });
  assert.equal(result.error.email, 'Please enter a valid email address.');
});

test('registerResidentValidator requires core fields and rejects future DOB / bad phone', () => {
  const blank = registerResidentValidator({ resident: {} });
  assert.ok(blank.error);
  assert.ok(blank.error.firstName);
  assert.ok(blank.error.cellphoneNo);

  const future = registerResidentValidator({
    resident: { firstName: 'A', lastName: 'B', birthDate: '2999-01-01', sex: 'Male', civilStatus: 'Single', cellphoneNo: '09171234567', barangay: 'X', currentAddress: 'Y' },
  });
  assert.equal(future.error.birthDate, 'Date of birth cannot be in the future.');

  const badPhone = registerResidentValidator({
    resident: { firstName: 'A', lastName: 'B', birthDate: '1990-01-01', sex: 'Male', civilStatus: 'Single', cellphoneNo: '123', barangay: 'X', currentAddress: 'Y' },
  });
  assert.equal(badPhone.error.cellphoneNo, 'Contact number must be a valid PH mobile number (e.g. 0917 123 4567).');
});

test('registerResidentValidator accepts valid input and normalizes fields', () => {
  const result = registerResidentValidator({
    resident: { firstName: 'A', lastName: 'B', birthDate: '1990-01-01', sex: 'Male', civilStatus: 'Single', cellphoneNo: '0917 123 4567', barangay: 'X', currentAddress: 'Y' },
  });
  assert.ok(result.value);
  assert.equal(result.value.resident.firstName, 'A');
  assert.equal(result.value.resident.lastName, 'B');
  assert.equal(result.value.resident.permanentAddress, 'Y');
});

test('verification param validators require ids and reject unsafe characters', () => {
  const empty = verificationIdParamValidator({});
  assert.equal(empty.error.id, 'A resident reference is required.');

  const bad = verificationIdParamValidator({ id: '../etc/passwd' });
  assert.equal(bad.error.id, 'The resident reference is not valid.');

  const ok = verificationRefParamValidator({ ref: 'RES-000001' });
  assert.equal(ok.value.ref, 'RES-000001');
});

test('approve/reject/requestResubmission enforce reason rules', () => {
  assert.equal(approveValidator({}).value.remarks, '');

  assert.ok(rejectValidator({ reason: '   ' }).error);
  assert.equal(rejectValidator({ reason: '   ' }).error.reason, 'Please provide a reason for rejection.');
  assert.ok(rejectValidator({ reason: 'ab' }).error);
  assert.equal(rejectValidator({ reason: 'ab' }).error.reason, 'Please provide a more specific reason (at least 5 characters).');

  const ok = rejectValidator({ reason: 'Invalid information' });
  assert.equal(ok.value.reason, 'Invalid information');

  assert.ok(requestResubmissionValidator({ reason: '' }).error);
  assert.equal(requestResubmissionValidator({}).error.reason, 'Please provide a reason for requesting resubmission.');
});

test('decisionValidator delegates to approve/reject after validating decision', () => {
  const bad = decisionValidator({ decision: 'maybe' });
  assert.equal(bad.error.decision, 'Decision must be "approved" or "rejected".');

  const ok = decisionValidator({ decision: 'approved' });
  assert.equal(ok.value.decision, 'approved');
});

test('household validators enforce required fields, enums, numbers, contact and member rules', () => {
  const blank = createHouseholdValidator({});
  assert.ok(blank.error.headName);
  assert.ok(blank.error.purok);
  assert.ok(blank.error.barangay);

  const badContact = createHouseholdValidator({ household: { headName: 'A', purok: 'P1', streetAddress: 'S', barangay: 'B', contact: 'abc' } });
  assert.equal(badContact.error.contact, 'Contact number must be a valid PH mobile number.');

  const badIncome = createHouseholdValidator({ household: { headName: 'A', purok: 'P1', streetAddress: 'S', barangay: 'B', monthlyIncome: -5 } });
  assert.equal(badIncome.error.monthlyIncome, 'Monthly income must be zero or a positive number.');

  const updatePartial = updateHouseholdValidator({ household: { monthlyIncome: -1 } });
  assert.equal(updatePartial.error.monthlyIncome, 'Monthly income must be zero or a positive number.');
});

test('household member validator rejects invalid age/sex/philhealth', () => {
  const result = householdMemberValidator({ member: { name: 'A', relationship: 'Head', sex: 'X', age: -1, philhealth: 'maybe' } });
  assert.equal(result.error.sex, 'Member 1: sex must be "Male" or "Female".');
  assert.equal(result.error.age, 'Member 1: age must be between 0 and 120.');
  assert.equal(result.error.philhealth, 'Member 1: PhilHealth value is invalid.');
});

test('householdParamsValidator validates id and optional memberId', () => {
  const bad = householdParamsValidator({});
  assert.equal(bad.error.id, 'A household id is required.');

  const ok = householdParamsValidator({ id: 'HH-001', memberId: 'M1' });
  assert.equal(ok.value.id, 'HH-001');
  assert.equal(ok.value.memberId, 'M1');
});

test('validate middleware forwards field errors via next(ApiError)', () => {
  const calls = [];
  const next = (err) => calls.push(err);
  validateMw(() => ({ error: { email: 'Email is required.' } }))({ body: {} }, {}, next);
  assert.equal(calls.length, 1);
  const err = calls[0];
  assert.equal(err.statusCode, 400);
  assert.deepEqual(err.details, { email: 'Email is required.' });
});

test('validate middleware assigns value on success', () => {
  const req = { body: {} };
  validateMw(() => ({ value: { email: 'a@b.c' } }))(req, { status: () => ({ json: () => {} }) }, () => {});
  assert.deepEqual(req.body, { email: 'a@b.c' });
});

test('validate middleware wraps thrown errors in 400 via next', () => {
  const calls = [];
  const next = (err) => calls.push(err);
  validateMw(() => { throw new Error('kaboom'); })({ body: {} }, {}, next);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].statusCode, 400);
  assert.equal(calls[0].message, 'kaboom');
});

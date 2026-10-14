import assert from 'node:assert/strict';
import test from 'node:test';

import { createHouseholdValidator } from '../src/validators/household.validators.js';
import { registerResidentValidator } from '../src/validators/registration.validators.js';
import { registerPersonnelValidator } from '../src/validators/staffAccounts.validators.js';

const staffInput = {
  fullName: 'Juan Dela Cruz',
  email: 'juan@example.com',
  phone: '09171234567',
  password: 'password1',
  role: 'bhw',
};

test('registration, personnel, and household APIs reject unapproved barangays', () => {
  const resident = registerResidentValidator({ barangay: 'San Jose' });
  const staff = registerPersonnelValidator({ ...staffInput, barangay: 'San Jose' });
  const household = createHouseholdValidator({
    headName: 'Juan Dela Cruz',
    purok: 'Zone 1',
    streetAddress: 'Purok 1',
    barangay: 'San Jose',
  });

  assert.ok(resident.error?.barangay);
  assert.ok(staff.error?.barangay);
  assert.ok(household.error?.barangay);
});

test('registration, personnel, and household APIs accept each approved barangay', () => {
  for (const barangay of ['San Antonio', 'San Isidro', 'Old San Roque']) {
    const resident = registerResidentValidator({ barangay });
    const staff = registerPersonnelValidator({ ...staffInput, barangay });
    const household = createHouseholdValidator({
      headName: 'Juan Dela Cruz',
      purok: 'Zone 1',
      streetAddress: 'Purok 1',
      barangay,
    });

    assert.equal(resident.error?.barangay, undefined, `${barangay}: resident`);
    assert.equal(staff.error?.barangay, undefined, `${barangay}: personnel`);
    assert.equal(household.error?.barangay, undefined, `${barangay}: household`);
  }
});

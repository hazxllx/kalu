import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildStaffResidentPayload,
  calcStaffRegistrationAge,
  composeStaffResidentAddress,
  parsePurokZone,
  validateStaffResidentForm,
} from '../../src/features/registration/lib/staffResidentRegistration.js';

test('P0-1: calcStaffRegistrationAge computes accurate Manila-calendar age from YYYY-MM-DD DOB', () => {
  const ref = new Date(Date.UTC(2026, 5, 15)); // 2026-06-15
  assert.equal(calcStaffRegistrationAge('2000-06-14', ref), '26');
  assert.equal(calcStaffRegistrationAge('2000-06-16', ref), '25');
  assert.equal(calcStaffRegistrationAge('', ref), '');
  assert.equal(calcStaffRegistrationAge('invalid', ref), '');
});

test('P0-1: parsePurokZone parses "Purok 5", "Zone 3", and numeric strings without NaN', () => {
  assert.equal(parsePurokZone('Purok 5'), 5);
  assert.equal(parsePurokZone('Zone 3'), 3);
  assert.equal(parsePurokZone('7'), 7);
  assert.equal(parsePurokZone('Purok Centro'), undefined);
  assert.equal(parsePurokZone('99'), undefined);
  assert.equal(parsePurokZone(''), undefined);
});

test('P0-1: composeStaffResidentAddress persists houseNo, street, purok, and barangay', () => {
  assert.equal(
    composeStaffResidentAddress({
      houseNo: '42-B',
      street: 'Rizal St.',
      purok: '5',
      barangay: 'San Jose',
    }),
    '42-B, Rizal St., Purok 5, San Jose, Pili, Camarines Sur',
  );
  assert.equal(
    composeStaffResidentAddress({
      houseNo: '10',
      purok: 'Purok 2',
      barangay: 'Anayan',
    }),
    '10, Purok 2, Anayan, Pili, Camarines Sur',
  );
});

test('P0-1: validateStaffResidentForm accepts valid inputs and flags invalid fields cleanly', () => {
  const valid = validateStaffResidentForm({
    firstName: 'Maria',
    middleName: 'Santos',
    lastName: 'Reyes',
    dob: '1995-05-10',
    gender: 'Female',
    civilStatus: 'Single',
    barangay: 'San Jose',
    contact: '09171234567',
    createAccount: true,
    email: 'maria@example.com',
  });
  assert.deepEqual(valid, {});

  const invalid = validateStaffResidentForm({
    firstName: '',
    middleName: '123Invalid',
    lastName: 'Reyes',
    dob: '2099-01-01',
    gender: '',
    civilStatus: '',
    barangay: '',
    contact: '0917',
    createAccount: true,
    email: 'bad-email',
  });
  assert.match(invalid.firstName, /required/i);
  assert.match(invalid.middleName, /letters/i);
  assert.match(invalid.dob, /future/i);
  assert.match(invalid.gender, /required/i);
  assert.match(invalid.civilStatus, /required/i);
  assert.match(invalid.barangay, /required/i);
  assert.match(invalid.contact, /valid PH mobile/i);
  assert.match(invalid.email, /valid email/i);
});

test('contact number remains optional and accepts supported PH mobile formats', () => {
  const base = { firstName: 'Maria', lastName: 'Reyes', dob: '1995-05-10', gender: 'Female', civilStatus: 'Single', barangay: 'San Jose' };
  assert.deepEqual(validateStaffResidentForm({ ...base, contact: '' }), {});
  for (const contact of ['09171234567', '+639171234567', '+63 917-123-4567']) {
    assert.equal(validateStaffResidentForm({ ...base, contact }).contact, undefined);
  }
  for (const contact of ['0917123456', '091712345678', '08171234567', '9171234567', '09AB1234567']) {
    assert.match(validateStaffResidentForm({ ...base, contact }).contact, /valid PH mobile/i);
  }
});

test('staff registration rejects invalid date, name symbols, and unrecognized option values', () => {
  const base = { firstName: 'Maria', lastName: 'Reyes', dob: '1995-05-10', gender: 'Female', civilStatus: 'Single', barangay: 'San Jose' };
  assert.match(validateStaffResidentForm({ ...base, firstName: 'Maria.' }).firstName, /letters/i);
  assert.match(validateStaffResidentForm({ ...base, middleName: 'Santos_Lee' }).middleName, /letters/i);
  assert.match(validateStaffResidentForm({ ...base, dob: '2000-02-30' }).dob, /invalid/i);
  assert.match(validateStaffResidentForm({ ...base, gender: 'Other' }).gender, /valid sex/i);
  assert.match(validateStaffResidentForm({ ...base, civilStatus: 'Unknown' }).civilStatus, /valid civil status/i);
});

test('zone, house number, and hidden email follow existing optional-field rules', () => {
  const base = {
    firstName: 'Maria',
    lastName: 'Reyes',
    dob: '1995-05-10',
    gender: 'Female',
    civilStatus: 'Single',
    barangay: 'San Jose',
  };
  assert.equal(validateStaffResidentForm({ ...base, purok: 'Zone 8', houseNo: '42-B' }).purok, undefined);
  assert.match(validateStaffResidentForm({ ...base, purok: 'Zone 9' }).purok, /1 to 8/i);
  assert.match(validateStaffResidentForm({ ...base, houseNo: 'House @ 4' }).houseNo, /letters/i);
  assert.deepEqual(validateStaffResidentForm({ ...base, createAccount: false, email: 'malformed' }), {});
  assert.match(validateStaffResidentForm({ ...base, createAccount: true, email: '' }).email, /required/i);
});

test('P0-1: buildStaffResidentPayload builds canonical resident create payload with houseNo and zone', () => {
  const payload = buildStaffResidentPayload({
    firstName: ' Maria ',
    middleName: ' Santos ',
    lastName: ' Reyes ',
    suffix: '',
    dob: '1995-05-10',
    gender: 'Female',
    civilStatus: 'Single',
    barangay: 'San Jose',
    purok: 'Purok 4',
    street: 'Mabini St.',
    houseNo: '88',
    contact: '09171234567',
    createAccount: false,
  });

  assert.equal(payload.firstName, 'Maria');
  assert.equal(buildStaffResidentPayload({
    firstName: 'Maria',
    lastName: 'Reyes',
    dob: '1995-05-10',
    gender: 'Female',
    civilStatus: 'Single',
    barangay: 'San Jose',
    contact: '+63 917-123-4567',
  }).cellphoneNo, '09171234567');
  assert.equal(payload.zone, 4);
  assert.match(payload.currentAddress, /^88, Mabini St\., Purok 4, San Jose/);
  assert.equal(payload.permanentAddress, payload.currentAddress);
  assert.equal(payload.createLoginAccount, false);
});

test('P0-1: StaffResidentRegistration defaults isOpen=true, handles route close, and calls residentsApi.create', () => {
  const src = fs.readFileSync(
    path.resolve('src/features/registration/pages/StaffResidentRegistration.jsx'),
    'utf8',
  );
  assert.match(src, /isOpen\s*=\s*true/);
  assert.match(src, /residentsApi\.create\(\{\s*resident:\s*payload\s*\}\)/);
  assert.match(src, /disabled=\{Boolean\(assignedBarangay\)\}/);
  assert.doesNotMatch(src, /Age.*Optional/);
  assert.doesNotMatch(src, /residentsApi\.createResident/);
  assert.doesNotMatch(src, /Card\s*\}/);
});

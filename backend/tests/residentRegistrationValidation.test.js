import assert from 'node:assert/strict';
import test from 'node:test';
import { registerResidentValidator } from '../src/validators/registration.validators.js';

const payload = (cellphoneNo) => ({
  firstName: 'Maria',
  lastName: 'Reyes',
  birthDate: '1995-05-10',
  sex: 'Female',
  civilStatus: 'Single',
  cellphoneNo,
  barangay: 'San Antonio',
  zone: 1,
  currentAddress: 'Pili, Camarines Sur',
});

test('resident registration accepts only the exact 09 plus nine digit format', () => {
  assert.equal(registerResidentValidator(payload('09171234567')).error, undefined);
  for (const value of ['0917123456', '091712345678', '08171234567', '9171234567', '09AB1234567', '+639171234567']) {
    const result = registerResidentValidator(payload(value));
    assert.match(result.error.cellphoneNo, /09XXXXXXXXX/);
  }
});

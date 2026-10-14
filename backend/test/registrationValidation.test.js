import assert from 'node:assert/strict';
import test from 'node:test';

import { registerResidentValidator } from '../src/validators/registration.validators.js';

const VALID_RESIDENT = {
  firstName: '  María-José ',
  middleName: '',
  lastName: " O'Neil ",
  suffix: 'Jr.',
  birthDate: '1990-05-20',
  sex: 'Female',
  civilStatus: 'Single',
  currentAddress: '1 Main Street',
  cellphoneNo: '09123456789',
  barangay: 'San Isidro',
  zone: 1,
};

test('resident registration validator trims names and accepts valid personal information', () => {
  const result = registerResidentValidator({ resident: VALID_RESIDENT });

  assert.equal(result.error, undefined);
  assert.equal(result.value.resident.firstName, 'María-José');
  assert.equal(result.value.resident.middleName, '');
  assert.equal(result.value.resident.lastName, "O'Neil");
});

test('resident registration validator rejects blank required personal fields', () => {
  const result = registerResidentValidator({});

  assert.match(result.error.firstName, /required/i);
  assert.match(result.error.lastName, /required/i);
  assert.match(result.error.birthDate, /required/i);
  assert.match(result.error.sex, /required/i);
  assert.match(result.error.civilStatus, /required/i);
});

test('resident registration validator rejects invalid names and optional name content', () => {
  for (const [field, value] of [
    ['firstName', 'Anne2'],
    ['middleName', 'Middle2'],
    ['lastName', 'Dela_Cruz'],
  ]) {
    const result = registerResidentValidator({ resident: { ...VALID_RESIDENT, [field]: value } });
    assert.match(result.error[field], /letters/i);
  }
});

test('resident registration validator rejects invalid and future birth dates', () => {
  const invalidDate = registerResidentValidator({
    resident: { ...VALID_RESIDENT, birthDate: '2000-02-30' },
  });
  assert.match(invalidDate.error.birthDate, /invalid/i);

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const futureDate = registerResidentValidator({
    resident: { ...VALID_RESIDENT, birthDate: tomorrow.toISOString().slice(0, 10) },
  });
  assert.match(futureDate.error.birthDate, /future/i);
});

test('resident registration validator requires valid sex, civil status, and suffix options', () => {
  const result = registerResidentValidator({
    resident: {
      ...VALID_RESIDENT,
      sex: 'Other',
      civilStatus: 'Unknown',
      suffix: 'X',
    },
  });

  assert.match(result.error.sex, /Male.*Female/i);
  assert.match(result.error.civilStatus, /valid/i);
  assert.match(result.error.suffix, /Jr\./i);
});

test('registration service revalidates names before persisting', async () => {
  process.env.SUPABASE_URL = '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';
  const repository = (await import('../src/repositories/index.js')).default;
  const { registerResident } = await import('../src/services/registration.service.js');
  const originalGetByAuthId = repository.getResidentByAuthUserId;
  const originalInsert = repository.insertResident;
  let inserted = false;
  repository.getResidentByAuthUserId = async () => null;
  repository.insertResident = async () => {
    inserted = true;
    return {};
  };

  try {
    await assert.rejects(
      () => registerResident({
        user: { id: '11111111-1111-4111-8111-111111111111', role: 'resident' },
        payload: { ...VALID_RESIDENT, firstName: 'Anne2' },
      }),
      (error) => error.statusCode === 422
        && error.details.some((message) => /first name.*letters/i.test(message)),
    );
    assert.equal(inserted, false);
  } finally {
    repository.getResidentByAuthUserId = originalGetByAuthId;
    repository.insertResident = originalInsert;
  }
});

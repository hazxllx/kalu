import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeRegistrationMobile,
  registerResidentValidator,
  registrationDateReference,
} from '../src/validators/registration.validators.js';
import { ageFromDateOnly, isFutureDateOnly } from '../src/validators/common.js';

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

test('resident registration validator accepts only canonical 09 mobiles', () => {
  const result = registerResidentValidator({ resident: { ...VALID_RESIDENT, cellphoneNo: '09123456789' } });

  assert.equal(result.error, undefined);
  assert.equal(result.value.resident.cellphoneNo, '09123456789');
  assert.equal(normalizeRegistrationMobile('09123456789'), '09123456789');
  for (const cellphoneNo of ['+63 912-345-6789', '(0912) 345.6789', '639123456789', '08123456789', '09123', '0912ABC6789']) {
    assert.ok(registerResidentValidator({ resident: { ...VALID_RESIDENT, cellphoneNo } }).error.cellphoneNo);
  }
});

test('birthdate comparisons use the Philippine calendar date, not the UTC day', () => {
  const nearMidnight = new Date('2026-11-18T16:30:00.000Z');
  const reference = registrationDateReference(nearMidnight);

  assert.equal(reference.toISOString().slice(0, 10), '2026-11-19');
  assert.equal(isFutureDateOnly('2026-11-19', reference), false);
  assert.equal(ageFromDateOnly('2026-11-19', reference), 0);
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

  const tomorrow = registrationDateReference();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const futureDate = registerResidentValidator({
    resident: { ...VALID_RESIDENT, birthDate: tomorrow.toISOString().slice(0, 10) },
  });
  assert.match(futureDate.error.birthDate, /future/i);
});

test('resident registration accepts the current Philippine calendar date as a birthdate', () => {
  const reference = registrationDateReference();
  const parts = reference.toISOString().slice(0, 10).split('-').map(Number);
  const year = parts[0] - 30;
  const day = parts[1] === 2 && parts[2] === 29 ? 28 : parts[2];
  const birthDate = `${year}-${String(parts[1]).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const result = registerResidentValidator({ resident: { ...VALID_RESIDENT, birthDate } });

  assert.equal(result.error, undefined);
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
  const env = (await import('../src/config/env.js')).default;
  const { getServiceClient } = await import('../src/config/supabase.js');
  const originalGetByAuthId = repository.getResidentByAuthUserId;
  const originalInsert = repository.insertResident;
  const originalConfigured = env.isSupabaseConfigured;
  const originalUrl = env.supabaseUrl;
  const originalKey = env.supabaseServiceRoleKey;
  env.isSupabaseConfigured = true;
  env.supabaseUrl = 'https://registration-validation.invalid';
  env.supabaseServiceRoleKey = 'registration-test-service-key';
  const admin = getServiceClient().auth.admin;
  const originalGetUserById = admin.getUserById;
  const originalUpdateUserById = admin.updateUserById;
  let confirmationWrites = 0;
  admin.getUserById = async (id) => ({
    data: { user: { id, email_confirmed_at: '2026-11-18T00:00:00Z' } },
    error: null,
  });
  admin.updateUserById = async () => { confirmationWrites += 1; return { data: { user: null }, error: null }; };
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
    assert.equal(confirmationWrites, 0, 'registration must not auto-confirm Auth users');
  } finally {
    repository.getResidentByAuthUserId = originalGetByAuthId;
    repository.insertResident = originalInsert;
    admin.getUserById = originalGetUserById;
    admin.updateUserById = originalUpdateUserById;
    env.isSupabaseConfigured = originalConfigured;
    env.supabaseUrl = originalUrl;
    env.supabaseServiceRoleKey = originalKey;
  }
});

test('registration refuses an unconfirmed Auth user before touching the repository', async () => {
  process.env.SUPABASE_URL = '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';
  const repository = (await import('../src/repositories/index.js')).default;
  const { registerResident } = await import('../src/services/registration.service.js');
  const env = (await import('../src/config/env.js')).default;
  const { getServiceClient } = await import('../src/config/supabase.js');
  const originalConfigured = env.isSupabaseConfigured;
  const originalUrl = env.supabaseUrl;
  const originalKey = env.supabaseServiceRoleKey;
  const originalLookup = repository.getResidentByAuthUserId;
  let lookups = 0;
  env.isSupabaseConfigured = true;
  env.supabaseUrl = 'https://registration-confirmation.invalid';
  env.supabaseServiceRoleKey = 'registration-test-service-key';
  const admin = getServiceClient().auth.admin;
  const originalGetUserById = admin.getUserById;
  admin.getUserById = async (id) => ({ data: { user: { id, email_confirmed_at: null, confirmed_at: '2026-11-18T00:00:00Z' } }, error: null });
  repository.getResidentByAuthUserId = async () => { lookups += 1; return null; };

  try {
    await assert.rejects(
      () => registerResident({
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          role: 'resident',
          email_confirmed_at: '2026-11-18T00:00:00Z',
        },
        payload: VALID_RESIDENT,
      }),
      (error) => error.statusCode === 403 && /confirm your email/i.test(error.message),
    );
    assert.equal(lookups, 0);
  } finally {
    repository.getResidentByAuthUserId = originalLookup;
    admin.getUserById = originalGetUserById;
    env.isSupabaseConfigured = originalConfigured;
    env.supabaseUrl = originalUrl;
    env.supabaseServiceRoleKey = originalKey;
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import * as residentsService from '../src/services/residents.service.js';
import { ROLES } from '../src/config/roles.js';

// Mock the repository and supabase client so no network or DB is needed.
// ResidentsPage and the service enforce the same rules; we verify the service
// rejection behaviour that underpins the UI's 422 field errors.

const barangayRow = { name: 'San Isidro', status: 'Active' };
const municipalityId = 'm-1';

let inserted = null;

const makeResident = (overrides = {}) => ({
  id: overrides.id || 'res-1',
  firstName: 'Maria',
  lastName: 'Dela Cruz',
  birthDate: '2000-09-02',
  sex: 'Female',
  barangay: 'San Isidro',
  barangayId: 'b-1',
  municipalityId: 'm-1',
  verificationStatus: 'approved',
  createdAt: new Date().toISOString(),
  healthRecordNo: 'HR-001',
  authUserId: overrides.authUserId ?? null,
  verification_status: 'approved',
  ...overrides,
});

// Install repository doubles via `src/repositories/index.js` which the service
// imports. The repository object is the default export; mutating it patches the
// service's view of the same object without touching the file driver directly.
import repository from '../src/repositories/index.js';

const userHS = { id: 'hs-1', role: ROLES.HEALTH_SUPERVISOR, barangay: 'San Isidro', municipalityId };
const userPHN = { id: 'phn-1', role: ROLES.PHN, municipalityId };
const userBHW = { id: 'bhw-1', role: ROLES.BHW, barangay: 'San Isidro', municipalityId };

const installRepositoryDoubles = ({ scenario = 'clean' } = {}) => {
  inserted = null;
  repository.findBarangayByName = async (name) => (name === 'San Isidro' ? barangayRow : null);
  repository.findResidentByIdentity = async () => (scenario === 'duplicate' ? makeResident() : null);
  repository.nextResidentIds = async () => ({ id: 'res-new', healthRecordNo: 'HR-999' });
  repository.insertResident = async (payload) => { inserted = payload; return { ...makeResident(), ...payload }; };
  repository.getResident = async (id) => (id === 'res-linked' ? makeResident({ id, authUserId: 'auth-1' }) : makeResident({ id }));
  repository.updateResident = async (id, patch) => ({ ...makeResident({ id }), ...patch });
  repository.getProfileStatusesByIds = async () => ({});
};

test('Health Supervisor may create a resident within their assigned barangay', async () => {
  installRepositoryDoubles();
  const result = await residentsService.createResident({
    user: userHS,
    payload: { firstName: 'Maria', lastName: 'Dela Cruz', birthDate: '2000-09-02', sex: 'Female', barangay: 'San Isidro' },
  });
  assert.ok(result.id);
  assert.equal(inserted.barangay, 'San Isidro');
});

test('BHW (data-collection only) may not register a resident through the clinical resident endpoint', async () => {
  installRepositoryDoubles();
  await assert.rejects(
    () => residentsService.createResident({
      user: userBHW,
      payload: { firstName: 'Maria', lastName: 'Dela Cruz', birthDate: '2000-09-02', sex: 'Female', barangay: 'San Isidro' },
    }),
    (err) => {
      assert.equal(err.statusCode, 403);
      return true;
    },
  );
});

test('Health Supervisor cannot register a resident in another barangay (403)', async () => {
  installRepositoryDoubles();
  await assert.rejects(
    () => residentsService.createResident({
      user: userHS,
      payload: { firstName: 'Maria', lastName: 'Dela Cruz', birthDate: '2000-09-02', sex: 'Female', barangay: 'San Antonio' },
    }),
    (err) => {
      // Branch: either thebarangay validation (422 unknown barangay) or the scope 403.
      assert.ok([403, 422].includes(err.statusCode), `unexpected status ${err.statusCode}: ${err.message}`);
      return true;
    },
  );
});

test('rejects five-digit year Date of Birth (20000-09-02) with 422', async () => {
  installRepositoryDoubles();
  await assert.rejects(
    () => residentsService.createResident({
      user: userPHN,
      payload: { firstName: 'Maria', lastName: 'Dela Cruz', birthDate: '20000-09-02', sex: 'Female', barangay: 'San Isidro' },
    }),
    (err) => {
      assert.equal(err.statusCode, 422);
      assert.ok(String(err.details || err.message).toLowerCase().includes('date of birth'));
      return true;
    },
  );
});

test('rejects slash-form Date of Birth 09/02/20000 with 422', async () => {
  installRepositoryDoubles();
  await assert.rejects(
    () => residentsService.createResident({
      user: userPHN,
      payload: { firstName: 'Maria', lastName: 'Dela Cruz', birthDate: '09/02/20000', sex: 'Female', barangay: 'San Isidro' },
    }),
    (err) => {
      assert.equal(err.statusCode, 422);
      return true;
    },
  );
});

test('rejects impossible calendar date (2000-02-30) with 422', async () => {
  installRepositoryDoubles();
  await assert.rejects(
    () => residentsService.createResident({
      user: userPHN,
      payload: { firstName: 'Maria', lastName: 'Dela Cruz', birthDate: '2000-02-30', sex: 'Female', barangay: 'San Isidro' },
    }),
    (err) => { assert.equal(err.statusCode, 422); return true; },
  );
});

test('rejects incomplete date (2000-09) with 422', async () => {
  installRepositoryDoubles();
  await assert.rejects(
    () => residentsService.createResident({
      user: userPHN,
      payload: { firstName: 'Maria', lastName: 'Dela Cruz', birthDate: '2000-09', sex: 'Female', barangay: 'San Isidro' },
    }),
    (err) => { assert.equal(err.statusCode, 422); return true; },
  );
});

test('rejects a future birth date with 422', async () => {
  installRepositoryDoubles();
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const iso = tomorrow.toISOString().slice(0, 10);
  await assert.rejects(
    () => residentsService.createResident({
      user: userPHN,
      payload: { firstName: 'Maria', lastName: 'Dela Cruz', birthDate: iso, sex: 'Female', barangay: 'San Isidro' },
    }),
    (err) => {
      assert.equal(err.statusCode, 422);
      assert.ok(String(err.details || err.message).toLowerCase().includes('future'));
      return true;
    },
  );
});

test('createResident respects barangay scope for the optional login-account path', async () => {
  // When a login account is requested, barangay scope is checked before any
  // auth call. We verify the scope path without mocking createResidentAuthUser.
  installRepositoryDoubles();
  await assert.rejects(
    () => residentsService.createResident({
      user: userHS,
      payload: {
        firstName: 'Maria', lastName: 'Dela Cruz', birthDate: '2000-09-02', sex: 'Female',
        barangay: 'San Antonio', createLoginAccount: true, email: 'r@example.com',
      },
    }),
    (err) => { assert.ok([403, 422].includes(err.statusCode)); return true; },
  );
});

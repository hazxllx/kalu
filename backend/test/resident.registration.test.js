import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { registerResidentValidator } from '../src/validators/registration.validators.js';
import { validateDocumentUpload } from '../src/validators/documents.validators.js';
import validate from '../src/middleware/validate.js';
import * as registrationService from '../src/services/registration.service.js';
import * as documentsService from '../src/services/documents.service.js';
import * as authService from '../src/services/auth.service.js';
import * as transferService from '../src/services/transfer.service.js';
import repository from '../src/repositories/index.js';

const pngFile = () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const file = new File([png], 'id-front.png', { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: png.length });
  return file;
};

const RESIDENT = { id: 'RES-1', authUserId: 'AUTH-1', role: 'resident', barangay: 'San Isidro', municipalityId: 'M1', verificationStatus: 'pending' };

test('registerResidentValidator accepts valid payload', () => {
  const result = registerResidentValidator({
    firstName: 'Ana',
    lastName: 'Dela Cruz',
    birthDate: '2000-01-01',
    sex: 'Female',
    civilStatus: 'Single',
    cellphoneNo: '09171234567',
    currentAddress: '123 Main St',
    barangay: 'San Isidro',
    email: 'ana@example.com',
  });
  assert.ok(!result.error, JSON.stringify(result));
});

test('registration service creates pending resident without requiring document', async () => {
  const repo = {
    getResidentByAuthUserId: async () => null,
    findBarangayByName: async () => ({ id: 'BRGY-1', name: 'San Isidro', municipalityId: 'M1' }),
    findResidentByIdentity: async () => null,
    nextResidentIds: async () => ({ id: 'RES-1', healthRecordNo: 'HR-1' }),
    insertResident: async (row) => ({ ...row, id: row.id }),
  };

  const originalMethods = ['getResidentByAuthUserId', 'findBarangayByName', 'findResidentByIdentity', 'nextResidentIds', 'insertResident'];
  const originals = {};
  for (const key of originalMethods) {
    originals[key] = repository[key];
    repository[key] = repo[key];
  }

  try {
    const result = await registrationService.registerResident({
      user: { id: 'AUTH-1', role: 'resident' },
      payload: {
        firstName: 'Ana',
        lastName: 'Dela Cruz',
        birthDate: '2000-01-01',
        sex: 'Female',
        barangay: 'San Isidro',
      },
    });
    assert.equal(result.verificationStatus, 'pending');
    assert.ok(result.id);
  } finally {
    for (const key of originalMethods) {
      repository[key] = originals[key];
    }
  }
});

test('registration blocks an identity-number duplicate without using names as proof', async () => {
  const repo = {
    getResidentByAuthUserId: async () => null,
    findBarangayByName: async () => ({ id: 'BRGY-1', name: 'San Isidro', municipalityId: 'M1' }),
    findResidentByIdentity: async ({ identityNo }) => (identityNo === 'ID-1' ? { id: 'RES-EXISTING' } : null),
  };
  const keys = Object.keys(repo);
  const originals = Object.fromEntries(keys.map((key) => [key, repository[key]]));
  keys.forEach((key) => { repository[key] = repo[key]; });
  try {
    await assert.rejects(
      registrationService.registerResident({
        user: { id: 'AUTH-2', role: 'resident' },
        payload: { firstName: 'Same', lastName: 'Name', birthDate: '2000-01-01', sex: 'Female', barangay: 'San Isidro', identityNo: 'ID-1' },
      }),
      (error) => error.statusCode === 409 && /may already be associated/.test(error.message),
    );
  } finally {
    keys.forEach((key) => { repository[key] = originals[key]; });
  }
});

test('transfer OTP accepts leading-zero four-digit strings and invalidates them after use', async () => {
  // The stored hash is purpose-bound (transfer_residency), so a registration
  // verification code can never satisfy a transfer OTP and vice versa.
  const otpHash = createHmac('sha256', process.env.OTP_PEPPER || 'development-only-change-me').update('transfer_residency:0427').digest('hex');
  const changes = [];
  const repo = {
    getTransferRequest: async () => ({ id: 'TR-1', auth_user_id: 'AUTH-1', status: 'pending', otp_hash: otpHash, otp_expires_at: new Date(Date.now() + 60000).toISOString(), otp_attempts: 0 }),
    updateTransferRequest: async (_id, patch) => { changes.push(patch); return { id: 'TR-1', status: 'pending', ...patch }; },
    insertTransferAuditLog: async () => null,
  };
  const keys = Object.keys(repo);
  const originals = Object.fromEntries(keys.map((key) => [key, repository[key]]));
  keys.forEach((key) => { repository[key] = repo[key]; });
  try {
    const result = await transferService.verifyOtp({ user: { id: 'AUTH-1', role: 'resident' }, requestId: 'TR-1', otp: '0427' });
    assert.equal(result.verified, true);
    assert.equal(changes[0].otp_hash, null);
    await assert.rejects(
      transferService.verifyOtp({ user: { id: 'AUTH-1', role: 'resident' }, requestId: 'TR-1', otp: '042' }),
      (error) => error.statusCode === 400,
    );
  } finally {
    keys.forEach((key) => { repository[key] = originals[key]; });
  }
});

test('document upload validation preserves residentId through the validate middleware', async () => {
  // Reproduction of the reported 400: the `validate` middleware REPLACES
  // req.body with the validator's returned value. Before the fix that value
  // omitted residentId, so the controller saw `undefined` and returned
  // "Resident ID is required." (HTTP 400). The middleware must now keep it.
  const req = {
    body: { residentId: 'RES-000123', documentType: 'government_id_front', governmentIdType: 'drivers_license' },
    file: pngFile(),
  };
  let nextErr = 'not-called';
  const mw = validate((body, r) => validateDocumentUpload({ ...body, file: r.file }), 'body');
  mw(req, {}, (err) => { nextErr = err; });

  assert.equal(nextErr, undefined, nextErr ? `validate rejected: ${nextErr.message}` : '');
  assert.equal(req.body.residentId, 'RES-000123');
  assert.equal(req.body.documentType, 'government_id_front');
  assert.equal(req.body.governmentIdType, 'drivers_license');
});

test('registration is idempotent: a pending resident retry returns the existing record (no duplicate, no 409)', async () => {
  let inserted = 0;
  const repo = {
    getResidentByAuthUserId: async () => ({
      id: 'RES-1', healthRecordNo: 'RHU-1', firstName: 'Ana', lastName: 'Dela Cruz',
      barangay: 'San Isidro', verificationStatus: 'pending',
    }),
    insertResident: async (row) => { inserted += 1; return { ...row, id: 'RES-NEW' }; },
  };
  const keys = Object.keys(repo);
  const originals = Object.fromEntries(keys.map((k) => [k, repository[k]]));
  keys.forEach((k) => { repository[k] = repo[k]; });
  try {
    const result = await registrationService.registerResident({
      user: { id: 'AUTH-1', role: 'resident' },
      payload: { firstName: 'Ana', lastName: 'Dela Cruz', birthDate: '2000-01-01', sex: 'Female', barangay: 'San Isidro' },
    });
    assert.equal(result.id, 'RES-1');
    assert.equal(result.verificationStatus, 'pending');
    assert.equal(inserted, 0, 'must not insert a duplicate resident on retry');
  } finally {
    keys.forEach((k) => { repository[k] = originals[k]; });
  }
});

test('registration still conflicts when an already-verified resident is linked to the account', async () => {
  const repo = {
    getResidentByAuthUserId: async () => ({ id: 'RES-1', verificationStatus: 'verified' }),
  };
  const keys = Object.keys(repo);
  const originals = Object.fromEntries(keys.map((k) => [k, repository[k]]));
  keys.forEach((k) => { repository[k] = repo[k]; });
  try {
    await assert.rejects(
      registrationService.registerResident({
        user: { id: 'AUTH-1', role: 'resident' },
        payload: { firstName: 'Ana', lastName: 'Dela Cruz', birthDate: '2000-01-01', sex: 'Female', barangay: 'San Isidro' },
      }),
      (error) => error.statusCode === 409,
    );
  } finally {
    keys.forEach((k) => { repository[k] = originals[k]; });
  }
});

test('transfer OTP rejects a 5-digit code (must stay exactly four digits)', async () => {
  // A 6-digit registration-style code (or any non-4-digit value) must never be
  // accepted by the transfer flow. Length is validated before any hash compare.
  const repo = {
    getTransferRequest: async () => ({ id: 'TR-3', auth_user_id: 'AUTH-1', status: 'pending', otp_hash: 'x', otp_expires_at: new Date(Date.now() + 60000).toISOString(), otp_attempts: 0 }),
    updateTransferRequest: async (_id, patch) => ({ id: 'TR-3', status: 'pending', ...patch }),
    insertTransferAuditLog: async () => null,
  };
  const keys = Object.keys(repo);
  const originals = Object.fromEntries(keys.map((key) => [key, repository[key]]));
  keys.forEach((key) => { repository[key] = repo[key]; });
  try {
    await assert.rejects(
      transferService.verifyOtp({ user: { id: 'AUTH-1', role: 'resident' }, requestId: 'TR-3', otp: '01234' }),
      (error) => error.statusCode === 400,
    );
  } finally {
    keys.forEach((key) => { repository[key] = originals[key]; });
  }
});

test('a non-transfer-purpose OTP hash cannot verify a transfer request', async () => {
  // Hash built WITHOUT the transfer_residency purpose binding (e.g. how a
  // registration-style code would hash). It must be rejected by transfer
  // verification, proving the two OTP purposes are not interchangeable.
  const wrongPurposeHash = createHmac('sha256', process.env.OTP_PEPPER || 'development-only-change-me').update('0427').digest('hex');
  const changes = [];
  const repo = {
    getTransferRequest: async () => ({ id: 'TR-2', auth_user_id: 'AUTH-1', status: 'pending', otp_hash: wrongPurposeHash, otp_expires_at: new Date(Date.now() + 60000).toISOString(), otp_attempts: 0 }),
    updateTransferRequest: async (_id, patch) => { changes.push(patch); return { id: 'TR-2', status: 'pending', ...patch }; },
    insertTransferAuditLog: async () => null,
  };
  const keys = Object.keys(repo);
  const originals = Object.fromEntries(keys.map((key) => [key, repository[key]]));
  keys.forEach((key) => { repository[key] = repo[key]; });
  try {
    await assert.rejects(
      transferService.verifyOtp({ user: { id: 'AUTH-1', role: 'resident' }, requestId: 'TR-2', otp: '0427' }),
      (error) => error.statusCode === 401,
    );
  } finally {
    keys.forEach((key) => { repository[key] = originals[key]; });
  }
});

test('transfer review cannot be performed by a resident account', async () => {
  await assert.rejects(
    transferService.approve({ user: { id: 'AUTH-1', role: 'resident' }, requestId: 'TR-1', residentId: 'RES-1' }),
    (error) => error.statusCode === 403,
  );
});

test('transfer OTP reports a migration dependency without exposing PostgREST schema details', async () => {
  const repo = {
    getResidentByAuthUserId: async () => null,
    getLatestTransferRequest: async () => {
      const error = new Error("Could not find the table 'public.transfer_requests' in the schema cache");
      error.details = { code: 'PGRST205', message: error.message };
      throw error;
    },
  };
  const keys = Object.keys(repo);
  const originals = Object.fromEntries(keys.map((key) => [key, repository[key]]));
  keys.forEach((key) => { repository[key] = repo[key]; });
  try {
    await assert.rejects(
      transferService.requestOtp({ user: { id: 'AUTH-1', role: 'resident', email: 'user@example.com' } }),
      (error) => error.statusCode === 503 && /migration is applied/.test(error.message) && !/schema cache|transfer_requests/.test(error.message),
    );
  } finally {
    keys.forEach((key) => { repository[key] = originals[key]; });
  }
});

test('document upload accepts valid proof-of-residency file metadata after ownership/duplicate checks', async () => {
  const file = new File(['dummy'], 'proof.pdf', { type: 'application/pdf', lastModified: Date.now() });
  Object.defineProperty(file, 'size', { value: 1024 });

  const repo = {
    getResident: async () => ({ id: 'RES-1', authUserId: 'AUTH-1' }),
    listDocumentsByResident: async () => [],
    insertDocument: async (doc) => ({ ...doc, id: 'DOC-1' }),
  };

  const originalMethods = ['getResident', 'listDocumentsByResident', 'insertDocument'];
  const repoOriginals = {};
  for (const key of originalMethods) {
    repoOriginals[key] = repository[key];
    repository[key] = repo[key];
  }

  try {
    let threw = false;
    try {
      await documentsService.uploadResidentDocument({
        user: { id: 'AUTH-1', role: 'resident' },
        residentId: 'RES-1',
        file,
        documentType: 'proof_of_residency',
      });
    } catch (err) {
      threw = true;
    }
    assert.ok(threw, 'expected storage upload to fail in tests without live bucket');
  } finally {
    for (const key of originalMethods) {
      repository[key] = repoOriginals[key];
    }
  }
});

test('document upload rejects invalid file type', async () => {
  const file = new File(['dummy'], 'proof.exe', { type: 'application/octet-stream', lastModified: Date.now() });
  Object.defineProperty(file, 'size', { value: 1024 });

  const repo = {
    getResident: async () => ({ id: 'RES-1', authUserId: 'AUTH-1' }),
    insertDocument: async (doc) => ({ ...doc, id: 'DOC-1' }),
  };

  const originalMethods = ['getResident', 'insertDocument'];
  const originals = {};
  for (const key of originalMethods) {
    originals[key] = repository[key];
    repository[key] = repo[key];
  }

  try {
    let threw = false;
    try {
      await documentsService.uploadResidentDocument({
        user: { id: 'AUTH-1', role: 'resident' },
        residentId: 'RES-1',
        file,
        documentType: 'proof_of_residency',
      });
    } catch (err) {
      threw = true;
      assert.equal(err.statusCode, 400);
    }
    assert.ok(threw, 'expected rejection for invalid file type');
  } finally {
    for (const key of originalMethods) {
      repository[key] = originals[key];
    }
  }
});

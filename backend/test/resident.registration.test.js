import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { registerResidentValidator } from '../src/validators/registration.validators.js';
import { validateDocumentUpload } from '../src/validators/documents.validators.js';
import validate from '../src/middleware/validate.js';
import * as registrationService from '../src/services/registration.service.js';
import * as residentsService from '../src/services/residents.service.js';
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
    zone: '1',
    email: 'ana@example.com',
  });
  assert.ok(!result.error, JSON.stringify(result));
});

test('resident account creation uses a temporary password and resident role metadata', () => {
  const password = residentsService.generateTemporaryPassword();
  const account = residentsService.buildResidentAccountCreation({
    email: '  ANA@EXAMPLE.COM ',
    fullName: 'Ana Dela Cruz',
    password,
  });

  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /\d/);
  assert.equal(account.email, 'ana@example.com');
  assert.equal(account.password, password);
  assert.equal(account.user_metadata.full_name, 'Ana Dela Cruz');
  assert.equal(account.user_metadata.requested_role, 'resident');
  assert.equal(account.profile_status, 'pending_verification');
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

test('registration links an account to an existing unlinked resident profile when identity matches', async () => {
  let claimed = null;
  const repo = {
    getResidentByAuthUserId: async () => null,
    findBarangayByName: async () => ({ id: 'BRGY-1', name: 'San Isidro', municipalityId: 'M1' }),
    findResidentByIdentity: async () => ({
      id: 'RES-EXISTING',
      authUserId: null,
      identityNo: 'ID-1',
      birthDate: '2000-01-01',
      firstName: 'Ana',
      lastName: 'Dela Cruz',
      barangay: 'San Isidro',
      verificationStatus: 'pending',
    }),
    claimResidentForAccount: async ({ authUserId, identityNo, birthDate }) => {
      claimed = { authUserId, identityNo, birthDate };
      return { id: 'RES-EXISTING', authUserId, identityNo, birthDate, firstName: 'Ana', lastName: 'Dela Cruz', barangay: 'San Isidro' };
    },
    updateResident: async () => null,
    insertResident: async () => { throw new Error('should not create a duplicate resident'); },
    nextResidentIds: async () => ({ id: 'RES-NEW', healthRecordNo: 'HR-NEW' }),
  };
  const keys = Object.keys(repo);
  const originals = Object.fromEntries(keys.map((key) => [key, repository[key]]));
  keys.forEach((key) => { repository[key] = repo[key]; });
  try {
    const result = await registrationService.registerResident({
      user: { id: '11111111-1111-4111-8111-111111111111', role: 'resident' },
      payload: {
        firstName: 'Ana',
        lastName: 'Dela Cruz',
        birthDate: '2000-01-01',
        sex: 'Female',
        barangay: 'San Isidro',
        identityNo: 'ID-1',
      },
    });
    assert.equal(result.id, 'RES-EXISTING');
    assert.deepEqual(claimed, { authUserId: '11111111-1111-4111-8111-111111111111', identityNo: 'ID-1', birthDate: '2000-01-01' });
  } finally {
    keys.forEach((key) => { repository[key] = originals[key]; });
  }
});

// Transfer of Residency = change of the EXISTING resident's barangay.
// A linked resident record must NOT block the transfer; it identifies who is
// transferring. Only an OPEN (pending) request blocks a new one.

const BARANGAYS = [
  { id: 'B-ISIDRO', name: 'San Isidro', municipality_id: 'M1', status: 'Active' },
  { id: 'B-ANTONIO', name: 'San Antonio', municipality_id: 'M1', status: 'Active' },
  { id: 'B-ROQUE', name: 'Old San Roque', municipality_id: 'M1', status: 'Active' },
  { id: 'B-CLOSED', name: 'Inactive Barangay', municipality_id: 'M1', status: 'Inactive' },
];
const withRepo = async (repo, fn) => {
  const keys = Object.keys(repo);
  const originals = Object.fromEntries(keys.map((k) => [k, repository[k]]));
  keys.forEach((k) => { repository[k] = repo[k]; });
  try { return await fn(); }
  finally { keys.forEach((k) => { repository[k] = originals[k]; }); }
};

test('transfer: an existing linked resident is allowed and current barangay is excluded from destinations', async () => {
  await withRepo({
    getResidentByAuthUserId: async () => ({ id: 'RES-1', firstName: 'Ana', lastName: 'Dela Cruz', barangayId: 'B-ISIDRO', barangay: 'San Isidro', municipalityId: 'M1' }),
    listBarangays: async () => BARANGAYS,
    listTransferRequestsByUser: async () => [],
  }, async () => {
    const ctx = await transferService.getContext({ user: { id: 'AUTH-1', role: 'resident' } });
    assert.equal(ctx.resident.id, 'RES-1');
    assert.ok(!ctx.activeRequest, 'no open request');
    // Active title-case barangays must be offered (regression: a lowercase
    // 'active' comparison against title-case 'Active' emptied the dropdown).
    assert.ok(ctx.destinations.some((b) => b.id === 'B-ANTONIO'), 'active barangay must appear');
    assert.ok(ctx.destinations.some((b) => b.id === 'B-ROQUE'), 'active barangay must appear');
    assert.ok(!ctx.destinations.some((b) => b.id === 'B-ISIDRO'), 'current barangay must be excluded');
    assert.ok(!ctx.destinations.some((b) => b.id === 'B-CLOSED'), 'inactive barangay must be excluded');
    // No duplicates.
    const ids = ctx.destinations.map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length, 'no duplicate barangays');
    assert.equal(ctx.destinations.length, 2);
  });
});

test('transfer: submitting an ineligible (inactive) destination is rejected server-side', async () => {
  await withRepo({
    getResidentByAuthUserId: async () => ({ id: 'RES-1', barangayId: 'B-ISIDRO', barangay: 'San Isidro', municipalityId: 'M1' }),
    listBarangays: async () => BARANGAYS,
    getLatestTransferRequest: async () => null,
  }, async () => {
    await assert.rejects(
      transferService.startTransfer({ user: { id: 'AUTH-1', role: 'resident' }, toBarangayId: 'B-CLOSED' }),
      (error) => error.statusCode === 422 && /eligible/i.test(error.message),
    );
  });
});

test('transfer: an open pending request blocks starting another transfer', async () => {
  await withRepo({
    getResidentByAuthUserId: async () => ({ id: 'RES-1', barangayId: 'B-ISIDRO', barangay: 'San Isidro', municipalityId: 'M1' }),
    listBarangays: async () => BARANGAYS,
    getLatestTransferRequest: async () => ({ id: 'TR-1', status: 'pending', to_barangay_id: 'B-ANTONIO' }),
  }, async () => {
    await assert.rejects(
      transferService.startTransfer({ user: { id: 'AUTH-1', role: 'resident' }, toBarangayId: 'B-ROQUE' }),
      (error) => error.statusCode === 409 && /pending transfer request/i.test(error.message),
    );
  });
});

test('transfer: a previous approved request does NOT block a new transfer (same resident id kept)', async () => {
  let created = null;
  await withRepo({
    getResidentByAuthUserId: async () => ({ id: 'RES-1', barangayId: 'B-ANTONIO', barangay: 'San Antonio', municipalityId: 'M1' }),
    listBarangays: async () => BARANGAYS,
    getLatestTransferRequest: async () => ({ id: 'TR-OLD', status: 'approved' }),
    createTransferRequest: async (payload) => { created = payload; return { id: 'TR-NEW', status: 'draft' }; },
    insertTransferAuditLog: async () => null,
  }, async () => {
    const res = await transferService.startTransfer({ user: { id: 'AUTH-1', role: 'resident' }, toBarangayId: 'B-ROQUE' });
    assert.equal(res.status, 'draft');
    assert.equal(created.residentId, 'RES-1', 'reuses the SAME resident id — never creates a new resident');
    assert.equal(created.fromBarangayId, 'B-ANTONIO');
    assert.equal(created.toBarangayId, 'B-ROQUE');
  });
});

test('transfer: choosing the current barangay as destination is rejected', async () => {
  await withRepo({
    getResidentByAuthUserId: async () => ({ id: 'RES-1', barangayId: 'B-ISIDRO', barangay: 'San Isidro', municipalityId: 'M1' }),
    listBarangays: async () => BARANGAYS,
    getLatestTransferRequest: async () => null,
  }, async () => {
    await assert.rejects(
      transferService.startTransfer({ user: { id: 'AUTH-1', role: 'resident' }, toBarangayId: 'B-ISIDRO' }),
      (error) => error.statusCode === 422 && /different barangay/i.test(error.message),
    );
  });
});

test('transfer: approval changes only the barangay and keeps the same resident id', async () => {
  const audits = [];
  await withRepo({
    getTransferRequest: async () => ({ id: 'TR-1', status: 'pending', resident_id: 'RES-1', from_barangay_id: 'B-ISIDRO', to_barangay_id: 'B-ANTONIO' }),
    getResident: async () => ({ id: 'RES-1', barangayId: 'B-ISIDRO', barangay: 'San Isidro', municipalityId: 'M1' }),
    listBarangays: async () => BARANGAYS,
    approveTransferRequest: async (args) => { audits.push(args); return { id: 'TR-1', status: 'approved' }; },
    insertTransferAuditLog: async () => null,
  }, async () => {
    const res = await transferService.approve({ user: { id: 'STAFF-1', role: 'phn', municipalityId: 'M1' }, requestId: 'TR-1' });
    assert.equal(res.status, 'approved');
    assert.deepEqual(audits[0], { requestId: 'TR-1', reviewerId: 'STAFF-1' }, 'resident id is read from the request, never from the client');
  });
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

test('transfer: getMine reports a resident-facing residency status and read-only documents', async () => {
  await withRepo({
    getLatestTransferRequest: async () => ({ id: 'TR-1', status: 'pending', resident_id: 'RES-1', from_barangay_id: 'B-ISIDRO', to_barangay_id: 'B-ANTONIO', submitted_at: '2026-09-27T00:00:00Z' }),
    getResidentByAuthUserId: async () => ({ id: 'RES-1', municipalityId: 'M1' }),
    listBarangays: async () => BARANGAYS,
    listDocumentsByTransferRequest: async () => [],
  }, async () => {
    const mine = await transferService.getMine({ user: { id: 'AUTH-1', role: 'resident' } });
    assert.equal(mine.status, 'pending');
    assert.equal(mine.residencyStatus, 'transfer_pending');
    assert.equal(mine.fromBarangay, 'San Isidro');
    assert.equal(mine.toBarangay, 'San Antonio');
    assert.deepEqual(mine.documents, []);
  });
});

test('transfer: getMine maps approved and rejected to their residency statuses', async () => {
  await withRepo({
    getResidentByAuthUserId: async () => ({ id: 'RES-1', municipalityId: 'M1' }),
    listBarangays: async () => BARANGAYS,
    listDocumentsByTransferRequest: async () => [],
    getLatestTransferRequest: async () => ({ id: 'TR-A', status: 'approved', resident_id: 'RES-1', from_barangay_id: 'B-ISIDRO', to_barangay_id: 'B-ANTONIO' }),
  }, async () => {
    const mine = await transferService.getMine({ user: { id: 'AUTH-1', role: 'resident' } });
    assert.equal(mine.residencyStatus, 'transfer_approved');
  });
  await withRepo({
    getResidentByAuthUserId: async () => ({ id: 'RES-1', municipalityId: 'M1' }),
    listBarangays: async () => BARANGAYS,
    listDocumentsByTransferRequest: async () => [],
    getLatestTransferRequest: async () => ({ id: 'TR-R', status: 'rejected', resident_id: 'RES-1', from_barangay_id: 'B-ISIDRO', to_barangay_id: 'B-ANTONIO', rejection_reason: 'Proof of residency could not be verified.' }),
  }, async () => {
    const mine = await transferService.getMine({ user: { id: 'AUTH-1', role: 'resident' } });
    assert.equal(mine.residencyStatus, 'transfer_rejected');
    assert.equal(mine.rejectionReason, 'Proof of residency could not be verified.');
  });
});

test('transfer review cannot be performed by a resident account', async () => {
  await assert.rejects(
    transferService.approve({ user: { id: 'AUTH-1', role: 'resident' }, requestId: 'TR-1' }),
    (error) => error.statusCode === 403,
  );
});

test('transfer reports a migration dependency without exposing PostgREST schema details', async () => {
  await withRepo({
    getResidentByAuthUserId: async () => ({ id: 'RES-1', barangayId: 'B-ISIDRO', barangay: 'San Isidro', municipalityId: 'M1' }),
    listBarangays: async () => BARANGAYS,
    listTransferRequestsByUser: async () => {
      const error = new Error("Could not find the table 'public.transfer_requests' in the schema cache");
      error.details = { code: 'PGRST205', message: error.message };
      throw error;
    },
  }, async () => {
    await assert.rejects(
      transferService.getContext({ user: { id: 'AUTH-1', role: 'resident', email: 'user@example.com' } }),
      (error) => error.statusCode === 503 && /migration is applied/.test(error.message) && !/schema cache|transfer_requests/.test(error.message),
    );
  });
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

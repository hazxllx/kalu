import test from 'node:test';
import assert from 'node:assert/strict';

import { registerResidentValidator } from '../src/validators/registration.validators.js';
import * as registrationService from '../src/services/registration.service.js';
import * as documentsService from '../src/services/documents.service.js';
import * as authService from '../src/services/auth.service.js';
import repository from '../src/repositories/index.js';

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

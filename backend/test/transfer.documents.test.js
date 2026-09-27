import test from 'node:test';
import assert from 'node:assert/strict';

import { planDocumentWrite } from '../src/services/transfer.service.js';

// The transfer document rules, unit-tested through the pure planDocumentWrite
// helper (no storage / no db):
//   - the supporting proof-of-address is a single slot (re-upload REPLACES),
//   - existing health records are supplementary and may be uploaded in any
//     number, and re-selecting the exact same file (name + size) is a DUPLICATE
//     that must not create a second copy.

const HEALTH = 'transfer_previous_health_record';
const SUPPORTING = 'transfer_proof_of_address';

const doc = (over) => ({
  id: 'DOC',
  documentType: HEALTH,
  fileName: 'file.pdf',
  sizeBytes: 1024,
  storagePath: 'transfer-documents/REQ-1/DOC.pdf',
  verificationStatus: 'pending',
  ...over,
});

test('supporting proof-of-address is a single slot: a new upload replaces the previous one', () => {
  const existing = [doc({ id: 'SUP-1', documentType: SUPPORTING, fileName: 'Proof_v1.pdf', sizeBytes: 1024 })];
  const plan = planDocumentWrite({
    existing,
    documentType: SUPPORTING,
    documentMeta: { fileName: 'Proof_v2.pdf', sizeBytes: 2048 },
  });
  assert.equal(plan.replace?.id, 'SUP-1', 'the previous supporting doc is replaced');
  assert.equal(plan.duplicate, null, 'a supporting doc is never treated as a duplicate');
});

test('a first supporting upload has nothing to replace', () => {
  const plan = planDocumentWrite({
    existing: [],
    documentType: SUPPORTING,
    documentMeta: { fileName: 'Proof.pdf', sizeBytes: 1024 },
  });
  assert.equal(plan.replace, null);
  assert.equal(plan.duplicate, null);
});

test('distinct health records are all kept (no replace, no duplicate)', () => {
  const existing = [doc({ id: 'HR-1', fileName: 'Medical_Record.pdf', sizeBytes: 2048 })];
  const plan = planDocumentWrite({
    existing,
    documentType: HEALTH,
    documentMeta: { fileName: 'Laboratory_Result.pdf', sizeBytes: 4096 },
  });
  assert.equal(plan.replace, null, 'health records never replace one another');
  assert.equal(plan.duplicate, null, 'a different file is not a duplicate');
});

test('an exact health-record re-upload (same name + size) is a duplicate', () => {
  const existing = [
    doc({ id: 'HR-1', fileName: 'Medical_Record.pdf', sizeBytes: 2048 }),
    doc({ id: 'HR-2', fileName: 'Laboratory_Result.pdf', sizeBytes: 4096 }),
  ];
  const plan = planDocumentWrite({
    existing,
    documentType: HEALTH,
    documentMeta: { fileName: 'Medical_Record.pdf', sizeBytes: 2048 },
  });
  assert.equal(plan.duplicate?.id, 'HR-1', 'the matching stored copy is returned');
  assert.equal(plan.replace, null, 'a duplicate never replaces');
});

test('same name but different size is NOT a duplicate', () => {
  const existing = [doc({ id: 'HR-1', fileName: 'Medical_Record.pdf', sizeBytes: 2048 })];
  const plan = planDocumentWrite({
    existing,
    documentType: HEALTH,
    documentMeta: { fileName: 'Medical_Record.pdf', sizeBytes: 9999 },
  });
  assert.equal(plan.duplicate, null);
});

test('a non-pending health record does not block a new upload of the same file', () => {
  const existing = [doc({ id: 'HR-1', fileName: 'Medical_Record.pdf', sizeBytes: 2048, verificationStatus: 'rejected' })];
  const plan = planDocumentWrite({
    existing,
    documentType: HEALTH,
    documentMeta: { fileName: 'Medical_Record.pdf', sizeBytes: 2048 },
  });
  assert.equal(plan.duplicate, null, 'only pending copies are de-duplicated');
});

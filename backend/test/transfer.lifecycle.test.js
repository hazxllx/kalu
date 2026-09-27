import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import store from '../src/repositories/fileStore.js';
import repository from '../src/repositories/index.js';
import fileRepository from '../src/repositories/fileRepository.js';
import * as transferService from '../src/services/transfer.service.js';

// End-to-end transfer-of-residency lifecycle against the real file driver.
//
// Verifies the full workflow the product requires:
//   pending blocks a new request -> approval changes ONLY the barangay and
//   unlocks the form -> the resolved current barangay is excluded from the
//   destinations -> a repeat transfer works -> rejection also unlocks the form.
// The same resident id (and therefore all health records keyed on it) is kept
// throughout; no duplicate resident is ever created.

// Redirect the file store to a throwaway temp file so the test never touches
// the developer's local data store, and start from an empty dataset.
const tempFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kalusagap-transfer-')), 'store.json');
store.filePath = tempFile;
store.data = {
  meta: { version: 1, driver: 'file' },
  counters: { residents: 0, submissions: 0, referrals: 0 },
  residents: [],
  visits: [],
  referrals: [],
  verifications: [],
  residentVerificationLogs: [],
  transferRequests: [],
  transferRequestAuditLogs: [],
};

// The service talks to the env-selected repository (Supabase in this suite).
// Drive the lifecycle against the real FILE driver instead by pointing every
// repository method the service uses at the file-driver implementation, backed
// by the throwaway store above. Restored after the test.
const patched = {};
for (const key of Object.keys(fileRepository)) {
  if (typeof fileRepository[key] === 'function') {
    patched[key] = repository[key];
    repository[key] = fileRepository[key];
  }
}

// The file driver's listDocumentsByTransferRequest is a stub that always returns
// [], so submit() (which requires a pending supporting document) could never
// pass. Simulate the uploaded supporting document without a live storage bucket.
repository.listDocumentsByTransferRequest = async () => ([
  { id: 'DOC-SUP', documentType: 'transfer_proof_of_address', verificationStatus: 'pending' },
]);

test.after(() => {
  for (const key of Object.keys(patched)) repository[key] = patched[key];
  try { fs.rmSync(path.dirname(tempFile), { recursive: true, force: true }); } catch { /* ignore */ }
});

const RESIDENT = {
  id: 'RES-JULISO',
  authUserId: 'AUTH-JULISO',
  firstName: 'Juliso',
  lastName: 'Turon',
  barangay: 'San Isidro',
  barangayId: null,
  municipalityId: null,
  verificationStatus: 'verified',
  healthRecordNo: 'HR-JULISO',
};

const resident = () => store.residents.find((r) => r.id === RESIDENT.id);
const asResident = { id: RESIDENT.authUserId, role: 'resident' };
const asReviewer = { id: 'STAFF-1', role: 'mho' };

const barangayId = async (name) => {
  const rows = await repository.listBarangays();
  return rows.find((b) => b.name === name).id;
};

test('transfer lifecycle: pending blocks, approval updates barangay + unlocks, repeat works, rejection unlocks', async () => {
  // Seed the existing resident (created once at registration; never recreated).
  await repository.insertResident({ ...RESIDENT });
  const sanAntonio = await barangayId('San Antonio');
  const oldSanRoque = await barangayId('Old San Roque');

  // STEP 1 — submit San Isidro -> San Antonio, becomes Pending Review.
  const draft1 = await transferService.startTransfer({ user: asResident, toBarangayId: sanAntonio });
  assert.equal(draft1.status, 'draft');
  const submitted1 = await transferService.submit({ user: asResident, requestId: draft1.requestId });
  assert.equal(submitted1.status, 'pending', 'first request is Pending Review');

  // STEP 2 — a second transfer is blocked while the first is pending.
  await assert.rejects(
    transferService.startTransfer({ user: asResident, toBarangayId: oldSanRoque }),
    (error) => error.statusCode === 409 && /pending transfer request/i.test(error.message),
    'a pending request must block another transfer',
  );

  // While pending the resident sees the in-progress lock (activeRequest set),
  // never the destination form.
  const pendingCtx = await transferService.getContext({ user: asResident });
  assert.ok(pendingCtx.activeRequest, 'pending request is exposed as activeRequest (lock screen)');
  assert.equal(pendingCtx.activeRequest.status, 'pending');

  // STEP 3 — health personnel approves. Only the barangay changes.
  const approved = await transferService.approve({ user: asReviewer, requestId: draft1.requestId });
  assert.equal(approved.status, 'approved');
  assert.equal(resident().id, RESIDENT.id, 'same resident id — no duplicate resident created');
  assert.equal(resident().healthRecordNo, 'HR-JULISO', 'health record number unchanged');
  assert.equal(resident().barangay, 'San Antonio', 'current barangay is the NAME, not the raw id');

  // STEP 4/5 — reopening shows the NORMAL form: no lock, current = San Antonio,
  // and San Antonio is excluded from the destination options.
  const afterApproval = await transferService.getContext({ user: asResident });
  assert.equal(afterApproval.activeRequest, null, 'resolved request does not lock the form');
  assert.equal(afterApproval.resident.barangay, 'San Antonio', 'current barangay updated to San Antonio');
  const destNames = afterApproval.destinations.map((b) => b.name);
  assert.ok(!destNames.includes('San Antonio'), 'current barangay excluded from destinations');
  assert.ok(destNames.includes('Old San Roque'), 'other eligible barangays are offered');
  assert.ok(destNames.includes('San Isidro'), 'the former barangay is a valid destination again');
  // History is retained (the approved request), and never blocks a new transfer.
  assert.equal(afterApproval.history.length, 1);
  assert.equal(afterApproval.history[0].status, 'approved');

  // STEP 6 — a repeat transfer San Antonio -> Old San Roque succeeds.
  const draft2 = await transferService.startTransfer({ user: asResident, toBarangayId: oldSanRoque });
  assert.equal(draft2.status, 'draft');
  const submitted2 = await transferService.submit({ user: asResident, requestId: draft2.requestId });
  assert.equal(submitted2.status, 'pending', 'the repeat transfer is created successfully');
  assert.notEqual(draft2.requestId, draft1.requestId, 'a new request row, not a reused one');

  // Still the SAME resident row throughout (never duplicated).
  assert.equal(store.residents.filter((r) => r.authUserId === RESIDENT.authUserId).length, 1);

  // Reject the repeat request; the current barangay is unchanged and the form
  // unlocks so the resident may try again.
  const rejected = await transferService.reject({
    user: asReviewer, requestId: draft2.requestId, reason: 'Proof of address could not be verified.',
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(resident().barangay, 'San Antonio', 'a rejection leaves the current barangay unchanged');

  const afterRejection = await transferService.getContext({ user: asResident });
  assert.equal(afterRejection.activeRequest, null, 'a rejected request does not lock the form');
  assert.equal(afterRejection.history.length, 2, 'all historical requests are retained');

  // A new transfer is allowed after the rejection resolved the lock.
  const draft3 = await transferService.startTransfer({ user: asResident, toBarangayId: oldSanRoque });
  assert.equal(draft3.status, 'draft', 'a resolved (rejected) request never blocks a future transfer');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import env from '../src/config/env.js';
import repository from '../src/repositories/index.js';
import {
  approve,
  reject,
  requestResubmission,
  submit,
} from '../src/services/transfer.service.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
const openStatuses = ['pending', 'under_review'];

const mockWorkflow = (t, initialStatus = 'pending') => {
  const originalSupabaseFlag = env.isSupabaseConfigured;
  env.isSupabaseConfigured = false;
  t.after(() => { env.isSupabaseConfigured = originalSupabaseFlag; });

  const state = {
    request: {
      id: 'transfer-1',
      auth_user_id: 'resident-auth',
      resident_id: 'resident-1',
      from_barangay_id: 'barangay-origin',
      to_barangay_id: 'barangay-destination',
      status: initialStatus,
      rejection_reason: '',
      resubmission_instructions: '',
    },
    resident: {
      id: 'resident-1',
      authUserId: null,
      healthRecordNo: 'HRN-001',
      barangayId: 'barangay-origin',
    },
    documents: [{
      id: 'proof-1',
      documentType: 'transfer_proof_of_address',
      verificationStatus: 'pending',
      storagePath: 'transfer-documents/transfer-1/proof-1.pdf',
    }],
    audit: [],
  };
  const originals = new Map();
  const replace = (key, value) => {
    originals.set(key, repository[key]);
    repository[key] = value;
  };

  replace('getTransferRequest', async (id, authUserId = null) => (
    id === state.request.id && (!authUserId || authUserId === state.request.auth_user_id)
      ? copy(state.request)
      : null
  ));
  replace('getResident', async (id) => id === state.resident.id ? copy(state.resident) : null);
  replace('approveTransferRequest', async ({ requestId, reviewerId }) => {
    if (requestId !== state.request.id || !openStatuses.includes(state.request.status)) return null;
    state.request.from_barangay_id = state.resident.barangayId;
    state.resident.barangayId = state.request.to_barangay_id;
    state.request.status = 'approved';
    state.request.reviewed_by = reviewerId;
    state.request.reviewed_at = new Date().toISOString();
    return copy(state.request);
  });
  replace('updateTransferRequestForReview', async (id, patch) => {
    if (id !== state.request.id || !openStatuses.includes(state.request.status)) return null;
    Object.assign(state.request, patch);
    return copy(state.request);
  });
  replace('updateTransferRequestForSubmission', async (id, patch) => {
    if (id !== state.request.id || !['draft', 'resubmission_required'].includes(state.request.status)) return null;
    Object.assign(state.request, patch);
    return copy(state.request);
  });
  replace('insertTransferAuditLog', async (entry) => {
    const row = { ...copy(entry), createdAt: new Date().toISOString() };
    state.audit.push(row);
    return row;
  });
  replace('listTransferAuditLogs', async (id) => state.audit.filter((row) => row.transferRequestId === id).map(copy));
  replace('listDocumentsByTransferRequest', async (id) => id === state.request.id ? copy(state.documents) : []);
  replace('listActiveHealthSupervisorsByBarangay', async () => []);

  t.after(() => {
    for (const [key, original] of originals) repository[key] = original;
  });
  return state;
};

test('approval moves the existing resident once and preserves their record identity', async (t) => {
  const state = mockWorkflow(t);
  const user = { id: 'receiving-reviewer', role: 'health_supervisor', barangayId: 'barangay-destination' };
  const outcomes = await Promise.allSettled([
    approve({ user, requestId: state.request.id }),
    approve({ user, requestId: state.request.id }),
  ]);
  const approved = outcomes.find((outcome) => outcome.status === 'fulfilled').value;

  assert.equal(approved.status, 'approved');
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);
  assert.equal(state.resident.barangayId, 'barangay-destination');
  assert.equal(state.resident.id, 'resident-1');
  assert.equal(state.resident.healthRecordNo, 'HRN-001');
  assert.equal(state.request.reviewed_by, user.id);
  assert.equal(state.audit.filter((row) => row.action === 'transfer_request_approved').length, 1);
  assert.equal(state.audit.filter((row) => row.action === 'transfer_request_approved').length, 1);
  await assert.rejects(approve({ user, requestId: state.request.id }), /no longer awaiting review/i);
});

test('the sending barangay supervisor cannot decide a transfer', async (t) => {
  const state = mockWorkflow(t);
  const user = { id: 'origin-reviewer', role: 'health_supervisor', barangayId: 'barangay-origin' };

  await assert.rejects(approve({ user, requestId: state.request.id }), /receiving barangay/i);
  await assert.rejects(reject({ user, requestId: state.request.id, reason: 'Not eligible' }), /receiving barangay/i);
  await assert.rejects(requestResubmission({ user, requestId: state.request.id, instructions: 'Please fix this' }), /receiving barangay/i);
  assert.equal(state.request.status, 'pending');
  assert.equal(state.resident.barangayId, 'barangay-origin');
  assert.equal(state.audit.length, 0);
});

test('approval is blocked when required proof of address is missing or invalid', async (t) => {
  const state = mockWorkflow(t);
  const user = { id: 'receiving-reviewer', role: 'health_supervisor', barangayId: 'barangay-destination' };

  state.documents = [];
  await assert.rejects(approve({ user, requestId: state.request.id }), /proof-of-address document/i);
  state.documents = [{
    id: 'rejected-proof',
    documentType: 'transfer_proof_of_address',
    verificationStatus: 'rejected',
    storagePath: 'transfer-documents/transfer-1/rejected-proof.pdf',
  }];
  await assert.rejects(approve({ user, requestId: state.request.id }), /proof-of-address document/i);
  assert.equal(state.request.status, 'pending');
  assert.equal(state.resident.barangayId, 'barangay-origin');
  assert.equal(state.audit.length, 0);
});

test('rejection requires a meaningful reason and never changes residency', async (t) => {
  const state = mockWorkflow(t);
  const user = { id: 'receiving-reviewer', role: 'health_supervisor', barangayId: 'barangay-destination' };

  await assert.rejects(reject({ user, requestId: state.request.id, reason: '   ' }), /meaningful rejection reason/i);
  await assert.rejects(reject({ user, requestId: state.request.id, reason: 'no' }), /meaningful rejection reason/i);
  const result = await reject({ user, requestId: state.request.id, reason: 'The address document does not show the destination barangay.' });

  assert.equal(result.status, 'rejected');
  assert.equal(state.request.rejection_reason, 'The address document does not show the destination barangay.');
  assert.equal(state.request.reviewed_by, user.id);
  assert.equal(state.resident.barangayId, 'barangay-origin');
  assert.equal(state.audit[0].metadata.reason, state.request.rejection_reason);
  await assert.rejects(approve({ user, requestId: state.request.id }), /no longer awaiting review/i);
  assert.equal(state.resident.barangayId, 'barangay-origin');
});

test('resubmission requires instructions, retains documents, and returns to pending on resident resubmit', async (t) => {
  const state = mockWorkflow(t);
  const reviewer = { id: 'receiving-reviewer', role: 'health_supervisor', barangayId: 'barangay-destination' };
  const resident = { id: 'resident-auth', role: 'resident' };

  await assert.rejects(requestResubmission({ user: reviewer, requestId: state.request.id, instructions: '   ' }), /meaningful resubmission instructions/i);
  await requestResubmission({
    user: reviewer,
    requestId: state.request.id,
    instructions: 'Upload an address document showing your new barangay.',
  });
  assert.equal(state.request.status, 'resubmission_required');
  assert.equal(state.request.reviewed_by, reviewer.id);
  assert.equal(state.request.resubmission_instructions, 'Upload an address document showing your new barangay.');
  assert.deepEqual(state.documents.map((doc) => doc.id), ['proof-1']);

  const submitted = await submit({ user: resident, requestId: state.request.id });
  assert.equal(submitted.status, 'pending');
  assert.equal(state.request.resubmission_instructions, '');
  assert.deepEqual(state.documents.map((doc) => doc.id), ['proof-1']);
  assert.ok(state.audit.some((row) => row.action === 'transfer_request_resubmitted'));
  await assert.rejects(submit({ user: resident, requestId: state.request.id }), /already been submitted/i);
});

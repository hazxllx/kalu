import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planDocumentWrite,
  residencyStatusFrom,
  transferInReviewerScope,
  canDecideTransfer,
} from '../src/services/transfer.service.js';

const request = { from_barangay_id: 'bgy-origin', to_barangay_id: 'bgy-dest' };

// --------------------------------------------------------------------------
// Reviewer VISIBILITY (list / open) — origin OR destination barangay.
// --------------------------------------------------------------------------
test('transferInReviewerScope: municipality-wide roles see every request', () => {
  for (const role of ['admin', 'mho', 'phn']) {
    assert.equal(transferInReviewerScope({ role }, request), true);
  }
});

test('transferInReviewerScope: health supervisor sees origin or destination only', () => {
  assert.equal(transferInReviewerScope({ role: 'health_supervisor', barangayId: 'bgy-origin' }, request), true);
  assert.equal(transferInReviewerScope({ role: 'health_supervisor', barangayId: 'bgy-dest' }, request), true);
  assert.equal(transferInReviewerScope({ role: 'health_supervisor', barangayId: 'bgy-other' }, request), false);
});

test('transferInReviewerScope: a supervisor with no barangay, or a non-reviewer role, sees nothing', () => {
  assert.equal(transferInReviewerScope({ role: 'health_supervisor', barangayId: null }, request), false);
  assert.equal(transferInReviewerScope({ role: 'resident' }, request), false);
  assert.equal(transferInReviewerScope(null, request), false);
});

// --------------------------------------------------------------------------
// Decision AUTHORITY (approve / reject / request resubmission) — the authorized
// RECEIVING supervisor (destination barangay) only.
// --------------------------------------------------------------------------
test('canDecideTransfer: only the receiving (destination) supervisor may decide', () => {
  assert.equal(canDecideTransfer({ role: 'health_supervisor', barangayId: 'bgy-dest' }, request), true);
  // The LOSING (origin) barangay supervisor can observe but NOT decide.
  assert.equal(canDecideTransfer({ role: 'health_supervisor', barangayId: 'bgy-origin' }, request), false);
  assert.equal(canDecideTransfer({ role: 'health_supervisor', barangayId: 'bgy-other' }, request), false);
});

test('canDecideTransfer: municipality-wide roles may decide; residents never', () => {
  for (const role of ['admin', 'mho', 'phn']) {
    assert.equal(canDecideTransfer({ role }, request), true);
  }
  assert.equal(canDecideTransfer({ role: 'resident', barangayId: 'bgy-dest' }, request), false);
  assert.equal(canDecideTransfer({ role: 'bhw', barangayId: 'bgy-dest' }, request), false);
});

// --------------------------------------------------------------------------
// Resident-facing residency status mapping (incl. resubmission).
// --------------------------------------------------------------------------
test('residencyStatusFrom: maps each lifecycle state to the resident-facing status', () => {
  assert.equal(residencyStatusFrom('pending'), 'transfer_pending');
  assert.equal(residencyStatusFrom('under_review'), 'transfer_pending');
  assert.equal(residencyStatusFrom('resubmission_required'), 'transfer_resubmission');
  assert.equal(residencyStatusFrom('approved'), 'transfer_approved');
  assert.equal(residencyStatusFrom('rejected'), 'transfer_rejected');
  assert.equal(residencyStatusFrom('draft'), 'verified');
  assert.equal(residencyStatusFrom('cancelled'), 'verified');
});

// --------------------------------------------------------------------------
// Document write planning (supporting slot vs supplementary health records).
// --------------------------------------------------------------------------
test('planDocumentWrite: the supporting proof-of-address is a single replaceable slot', () => {
  const existing = [
    { id: 'd1', documentType: 'transfer_proof_of_address', verificationStatus: 'pending', fileName: 'a.pdf', sizeBytes: 10 },
  ];
  const plan = planDocumentWrite({
    existing,
    documentType: 'transfer_proof_of_address',
    documentMeta: { fileName: 'b.pdf', sizeBytes: 20 },
  });
  assert.equal(plan.replace?.id, 'd1');
  assert.equal(plan.duplicate, null);
});

test('planDocumentWrite: an exact health-record re-upload is treated as a duplicate', () => {
  const existing = [
    { id: 'h1', documentType: 'transfer_previous_health_record', verificationStatus: 'pending', fileName: 'rec.pdf', sizeBytes: 100 },
  ];
  const dup = planDocumentWrite({
    existing,
    documentType: 'transfer_previous_health_record',
    documentMeta: { fileName: 'rec.pdf', sizeBytes: 100 },
  });
  assert.equal(dup.duplicate?.id, 'h1');
  assert.equal(dup.replace, null);

  const fresh = planDocumentWrite({
    existing,
    documentType: 'transfer_previous_health_record',
    documentMeta: { fileName: 'other.pdf', sizeBytes: 101 },
  });
  assert.equal(fresh.duplicate, null);
  assert.equal(fresh.replace, null);
});

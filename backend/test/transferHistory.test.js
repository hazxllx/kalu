import assert from 'node:assert/strict';
import test from 'node:test';
import env from '../src/config/env.js';
import { getServiceClient } from '../src/config/supabase.js';
import repository from '../src/repositories/index.js';
import { getContext, getMine, uploadDocument, removeDocument } from '../src/services/transfer.service.js';

const user = { id: 'resident-auth', role: 'resident' };
const fixture = (t, status = 'approved') => {
  const request = { id: 'old-request', auth_user_id: user.id, resident_id: 'same-resident', status,
    from_barangay_id: 'origin', to_barangay_id: 'destination', submitted_at: '2026-09-10T01:00:00Z', reviewed_at: '2026-09-11T01:00:00Z' };
  t.mock.method(repository, 'getTransferRequest', async (id, owner) => id === request.id && owner === user.id ? request : null);
  t.mock.method(repository, 'getLatestTransferRequest', async () => ({ ...request, id: 'new-request', status: 'pending' }));
  t.mock.method(repository, 'getResidentByAuthUserId', async () => ({ id: 'same-resident', barangayId: 'destination' }));
  t.mock.method(repository, 'listBarangays', async () => [{ id: 'origin', name: 'San Isidro' }, { id: 'destination', name: 'San Antonio' }]);
  return request;
};

test('historical detail uses the owned request rather than the latest request and signs read-only documents', async (t) => {
  const request = fixture(t);
  const saved = { isSupabaseConfigured: env.isSupabaseConfigured, supabaseUrl: env.supabaseUrl, supabaseServiceRoleKey: env.supabaseServiceRoleKey };
  Object.assign(env, { isSupabaseConfigured: true, supabaseUrl: 'http://127.0.0.1:54321', supabaseServiceRoleKey: 'test-service-key' });
  t.after(() => Object.assign(env, saved));
  const signed = [];
  t.mock.method(getServiceClient().storage, 'from', (bucket) => ({ createSignedUrl: async (path, seconds) => {
    signed.push({ bucket, path, seconds });
    return { data: { signedUrl: 'https://storage.example.test/signed-read-only' }, error: null };
  } }));
  t.mock.method(repository, 'listDocumentsByTransferRequest', async (id) => {
    assert.equal(id, request.id);
    return [{ id: 'old-proof', storagePath: 'private/old-proof.pdf', fileName: 'old-proof.pdf', documentType: 'transfer_proof_of_address' }];
  });
  const detail = await getMine({ user, requestId: request.id });
  assert.equal(detail.id, request.id);
  assert.equal(detail.status, 'approved');
  assert.equal(detail.fromBarangay, 'San Isidro');
  assert.equal(detail.toBarangay, 'San Antonio');
  assert.equal(detail.reviewedAt, request.reviewed_at);
  assert.equal(detail.documents[0].readOnly, true);
  assert.equal(detail.documents[0].url, 'https://storage.example.test/signed-read-only');
  assert.equal(detail.documents[0].storagePath, undefined);
  assert.deepEqual(signed, [{ bucket: 'documents', path: 'private/old-proof.pdf', seconds: 3600 }]);
});

test('historical detail rejects another owner and staff before reading or signing documents', async (t) => {
  fixture(t);
  const docs = t.mock.method(repository, 'listDocumentsByTransferRequest', async () => { throw new Error('must not read documents'); });
  await assert.rejects(getMine({ user: { ...user, id: 'other-owner' }, requestId: 'old-request' }), (error) => error.statusCode === 404);
  await assert.rejects(getMine({ user: { ...user, role: 'phn' }, requestId: 'old-request' }), (error) => error.statusCode === 403);
  assert.equal(docs.mock.callCount(), 0);
});

test('context retains all submitted outcomes and excludes working drafts', async (t) => {
  const request = fixture(t);
  t.mock.method(repository, 'listTransferRequestsByUser', async (owner) => {
    assert.equal(owner, user.id);
    return ['draft', 'pending', 'approved', 'rejected', 'resubmission_required', 'cancelled'].map((status) => ({ ...request, id: status, status }));
  });
  const context = await getContext({ user });
  assert.deepEqual(context.history.map((row) => row.status), ['pending', 'approved', 'rejected', 'resubmission_required', 'cancelled']);
  assert.equal(context.activeRequest.status, 'pending');
});

for (const status of ['pending', 'under_review', 'approved', 'rejected', 'cancelled']) {
  test(`${status} document uploads and deletions are blocked before any storage access`, async (t) => {
    fixture(t, status);
    const docs = t.mock.method(repository, 'listDocumentsByTransferRequest', async () => { throw new Error('must not read documents'); });
    await assert.rejects(uploadDocument({ user, requestId: 'old-request', documentType: 'transfer_proof_of_address' }), (error) => error.statusCode === 403);
    await assert.rejects(removeDocument({ user, requestId: 'old-request', documentId: 'proof' }), (error) => error.statusCode === 403);
    assert.equal(docs.mock.callCount(), 0);
  });
}

for (const status of ['draft', 'resubmission_required']) {
  test(`${status} permits document editing after ownership validation`, async (t) => {
    fixture(t, status);
    // An allowed edit reaches the document lookup; no actual storage mutation is needed.
    t.mock.method(repository, 'listDocumentsByTransferRequest', async () => []);
    await assert.rejects(removeDocument({ user, requestId: 'old-request', documentId: 'missing' }), (error) => error.statusCode === 404);
    await assert.rejects(uploadDocument({ user, requestId: 'old-request', documentType: 'invalid' }), (error) => error.statusCode === 400);
  });
}

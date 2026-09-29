import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import repository from '../src/repositories/index.js';
import * as transfer from '../src/services/transfer.service.js';

/**
 * BUG-005 — transfer-request staff review must be barangay-scoped.
 *
 * A Health Supervisor may only list / open / reject / approve a transfer request
 * whose ORIGIN or DESTINATION barangay is their own assigned barangay. MHO/PHN
 * stay municipality-wide. Repository is stubbed in-memory.
 */

const STUBBED = [
  'listTransferRequests', 'getTransferRequest', 'getResident', 'listBarangays',
  'listDocumentsByTransferRequest', 'insertTransferAuditLog', 'updateTransferRequest',
];
const original = {};

const HS_A = { id: 'hs-a', role: 'health_supervisor', barangayId: 'brgy-a', barangay: 'San Isidro', municipalityId: 'mun-1' };
const MHO = { id: 'mho-1', role: 'mho', municipalityId: 'mun-1' };

// A request from brgy-b -> brgy-c (does NOT touch brgy-a).
const OUT_OF_SCOPE = {
  id: 'TR-OUT', status: 'pending', resident_id: 'RES-2',
  from_barangay_id: 'brgy-b', to_barangay_id: 'brgy-c', reason: '',
};
// A request touching brgy-a (origin).
const IN_SCOPE = {
  id: 'TR-IN', status: 'pending', resident_id: 'RES-1',
  from_barangay_id: 'brgy-a', to_barangay_id: 'brgy-c', reason: '',
};

let requests;

beforeEach(() => {
  for (const k of STUBBED) original[k] = repository[k];
  requests = new Map([[IN_SCOPE.id, { ...IN_SCOPE }], [OUT_OF_SCOPE.id, { ...OUT_OF_SCOPE }]]);
  repository.listTransferRequests = async ({ status = null } = {}) => {
    const rows = [...requests.values()].filter((r) => !status || r.status === status);
    return { rows, total: rows.length };
  };
  repository.getTransferRequest = async (id) => requests.get(id) || null;
  repository.getResident = async (id) => ({ id, municipalityId: 'mun-1' });
  repository.listBarangays = async () => ([
    { id: 'brgy-a', name: 'San Isidro' }, { id: 'brgy-b', name: 'San Jose' }, { id: 'brgy-c', name: 'Old San Roque' },
  ]);
  repository.listDocumentsByTransferRequest = async () => [];
  repository.insertTransferAuditLog = async () => ({});
  repository.updateTransferRequest = async (id, patch) => { const n = { ...requests.get(id), ...patch }; requests.set(id, n); return n; };
});

afterEach(() => { for (const k of STUBBED) repository[k] = original[k]; });

test('BUG-005: HS queue only contains requests touching their barangay', async () => {
  const result = await transfer.listQueue({ user: HS_A, status: 'pending' });
  const ids = result.rows.map((r) => r.id);
  assert.ok(ids.includes('TR-IN'));
  assert.ok(!ids.includes('TR-OUT'));
});

test('BUG-005: MHO (municipality-wide) sees every request', async () => {
  const result = await transfer.listQueue({ user: MHO, status: 'pending' });
  assert.equal(result.rows.length, 2);
});

test('BUG-005: HS cannot open an out-of-barangay request (404)', async () => {
  await assert.rejects(() => transfer.getForReview({ user: HS_A, requestId: 'TR-OUT' }), (e) => e.statusCode === 404);
});

test('BUG-005: HS can open an in-scope request', async () => {
  const view = await transfer.getForReview({ user: HS_A, requestId: 'TR-IN' });
  assert.equal(view.request.id, 'TR-IN');
});

test('BUG-005: HS cannot reject an out-of-barangay request (404)', async () => {
  await assert.rejects(
    () => transfer.reject({ user: HS_A, requestId: 'TR-OUT', reason: 'no' }),
    (e) => e.statusCode === 404,
  );
});

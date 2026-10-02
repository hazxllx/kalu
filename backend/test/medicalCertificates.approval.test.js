import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as certs from '../src/services/medicalCertificates.service.js';
import authorize from '../src/middleware/authorize.js';
import { FEATURE_ROLES } from '../src/config/roles.js';

/**
 * Medical certificate approval rule tests.
 *
 * BUSINESS RULE: the MHO is the authorized signatory/approver. Only the MHO may
 * move a certificate to "Approved", a certificate can never be Issued before it
 * is Approved, and no electronic-signature mechanism is involved — approval is
 * recorded as the approving MHO's id + timestamp. The Supabase client is
 * injected as an in-memory stub so no live database is required.
 */

const PHN = { id: 'phn-1', role: 'phn', municipalityId: 'mun-1' };
const MHO = { id: 'mho-1', role: 'mho', municipalityId: 'mun-1' };
const RHU = { id: 'rhu-1', role: 'rhu_personnel', municipalityId: 'mun-1' };

let certRow;
let logs;

const makeSupabase = () => ({
  from(table) {
    const builder = {
      _table: table,
      _op: 'select',
      _payload: null,
      select() { return this; },
      insert(payload) { this._op = 'insert'; this._payload = payload; return this; },
      update(payload) { this._op = 'update'; this._payload = payload; return this; },
      eq() { return this; },
      like() { return this; },
      order() {
        // loadAudit ordering — resolve to the recorded logs.
        return Promise.resolve({ data: logs, error: null });
      },
      maybeSingle() {
        if (table === 'medical_certificates') return Promise.resolve({ data: certRow, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      single() {
        if (this._op === 'update' && table === 'medical_certificates') {
          certRow = { ...certRow, ...this._payload };
          return Promise.resolve({ data: certRow, error: null });
        }
        return Promise.resolve({ data: this._payload, error: null });
      },
      then(resolve) {
        // insert paths (writeLog / writeAudit) are awaited directly.
        if (this._op === 'insert' && table === 'medical_certificate_logs') logs.push(this._payload);
        return resolve({ data: null, error: null });
      },
    };
    return builder;
  },
});

beforeEach(() => {
  logs = [];
  certRow = {
    id: 'cert-1',
    reference_no: 'MC-2026-0001',
    certificate_number: 'MC-2026-0001',
    resident_id: 'RES-1',
    status: 'For Review',
    municipality_id: 'mun-1',
    barangay_id: 'brgy-1',
    findings: 'Fit to work',
    medical_officer: 'Dr. Maria Santos',
    resident: { id: 'RES-1', auth_user_id: null, municipality_id: 'mun-1' },
  };
});

test('a PHN cannot approve a certificate (MHO-only signatory step) — 403', async () => {
  const supabase = makeSupabase();
  await assert.rejects(
    () => certs.approve({ user: PHN, id: 'cert-1', supabase }),
    (err) => err.statusCode === 403,
  );
  assert.equal(certRow.status, 'For Review');
});

test('an MHO can approve a For Review certificate; approver id + timestamp recorded', async () => {
  const supabase = makeSupabase();
  const result = await certs.approve({ user: MHO, id: 'cert-1', supabase });
  assert.equal(result.status, 'Approved');
  assert.equal(certRow.status, 'Approved');
  assert.equal(certRow.reviewed_by, 'mho-1');
  assert.ok(certRow.reviewed_at, 'approval timestamp is recorded');
});

test('a certificate cannot be Issued before it is Approved — 409', async () => {
  const supabase = makeSupabase();
  await assert.rejects(
    () => certs.issue({ user: MHO, id: 'cert-1', supabase }),
    (err) => err.statusCode === 409,
  );
  assert.equal(certRow.status, 'For Review');
});

test('after MHO approval the certificate can be Issued', async () => {
  const supabase = makeSupabase();
  await certs.approve({ user: MHO, id: 'cert-1', supabase });
  const issued = await certs.issue({ user: MHO, id: 'cert-1', supabase });
  assert.equal(issued.status, 'Issued');
  assert.ok(certRow.date_issued, 'issuance date stamped');
});

test('a PHN may submit a Draft for review but never approve it', async () => {
  const supabase = makeSupabase();
  certRow.status = 'Draft';
  const result = await certs.submitForReview({ user: PHN, id: 'cert-1', supabase });
  assert.equal(result.status, 'For Review');
});

test('RHU Personnel is denied by the shared certificate API gate and create service', async () => {
  assert.equal(FEATURE_ROLES.certificates.includes('rhu_personnel'), false);

  let routeError;
  authorize(FEATURE_ROLES.certificates)({ user: RHU }, {}, (error) => { routeError = error; });
  assert.equal(routeError?.statusCode, 403);

  await assert.rejects(
    () => certs.create({ user: RHU, payload: { residentId: 'RES-1' }, supabase: makeSupabase() }),
    (error) => error.statusCode === 403,
  );
});

test('an authorized MHO can edit a certificate while it is awaiting review', async () => {
  const supabase = makeSupabase();
  const result = await certs.update({
    user: MHO,
    id: 'cert-1',
    payload: { findings: 'Updated findings', medicalOfficer: 'Dr. Maria Santos' },
    supabase,
  });

  assert.equal(result.findings, 'Updated findings');
  assert.equal(certRow.findings, 'Updated findings');
  assert.ok(logs.some((entry) => entry.action === 'Updated'));
});

test('an approved certificate cannot be edited after the approval decision', async () => {
  certRow.status = 'Approved';
  await assert.rejects(
    () => certs.update({ user: MHO, id: 'cert-1', payload: { findings: 'Changed after approval' }, supabase: makeSupabase() }),
    (error) => error.statusCode === 409,
  );
  assert.equal(certRow.findings, 'Fit to work');
});

test('RHU Personnel cannot edit a certificate through the service', async () => {
  await assert.rejects(
    () => certs.update({ user: { id: 'rhu-1', role: 'rhu_personnel', municipalityId: 'mun-1' }, id: 'cert-1', payload: { findings: 'Changed' }, supabase: makeSupabase() }),
    (error) => error.statusCode === 403,
  );
});

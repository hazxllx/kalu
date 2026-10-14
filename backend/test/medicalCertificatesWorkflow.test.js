import assert from 'node:assert/strict';
import test from 'node:test';

import env from '../src/config/env.js';
env.isSupabaseConfigured = false;

import {
  CERT_STATUS,
  changeStatus,
  create,
  list,
} from '../src/services/medicalCertificates.service.js';

const CERTIFICATE_ID = '11111111-1111-4111-8111-111111111111';
const RESIDENT_ID = 'resident-1';
const RESIDENT = {
  id: RESIDENT_ID,
  first_name: 'Ari',
  middle_name: '',
  last_name: 'Santos',
  barangay: 'San Isidro',
  barangay_id: 'barangay-1',
  municipality_id: 'municipality-1',
  auth_user_id: null,
  sex: 'Female',
  birth_date: '1990-01-01',
  civil_status: 'Single',
  current_address: 'San Isidro',
};

const userFor = (role, id = `user-${role}`) => ({
  id,
  name: `${role} reviewer`,
  role,
  municipalityId: 'municipality-1',
});

const initialCertificate = (status = CERT_STATUS.FOR_REVIEW) => ({
  id: CERTIFICATE_ID,
  reference_no: 'MC-2026-0001',
  certificate_number: 'MC-2026-0001',
  resident_id: RESIDENT_ID,
  municipality_id: 'municipality-1',
  barangay_id: 'barangay-1',
  status,
  date_of_examination: '2026-10-01',
  findings: 'Medical impression',
  civil_status: 'Single',
  recommendation: 'Rest',
  remarks: 'Routine',
  created_by: 'creator-1',
  created_at: '2026-10-01T08:00:00.000Z',
  resident: RESIDENT,
  creator: { full_name: 'Certificate Creator', role: 'phn' },
  reviewed_by: null,
  reviewed_at: null,
  issued_at: null,
  issued_by: null,
  review_remarks: '',
});

const makeSupabase = ({ certificate = null } = {}) => {
  let current = certificate ? { ...certificate } : null;
  const logs = [];
  const calls = { updates: [], inserts: [], selects: [] };

  const from = (table) => {
    const ctx = { table, op: 'select', filters: {}, payload: null };
    const resolve = () => {
      if (table === 'residents') return { data: RESIDENT, error: null };
      if (table === 'profiles') {
        if (ctx.filters.in) {
          return {
            data: ctx.filters.in.values.map((id) => ({
              id,
              full_name: id === 'creator-1' || id.startsWith('user-')
                ? 'Certificate Creator'
                : 'Authorized Reviewer',
              role: id.startsWith('user-') ? id.slice('user-'.length) : 'phn',
              email: '',
            })),
            error: null,
          };
        }
        return {
          data: { id: ctx.filters.id, full_name: 'Authorized Reviewer', role: 'phn', position: 'Public Health Nurse', license_no: 'LIC-1' },
          error: null,
        };
      }
      if (table === 'medical_certificates') {
        if (ctx.op === 'update') {
          calls.updates.push({ payload: ctx.payload, filters: { ...ctx.filters } });
          if (!current || current.id !== ctx.filters.id || current.status !== ctx.filters.status) {
            return { data: null, error: null };
          }
          current = { ...current, ...ctx.payload };
          return { data: current, error: null };
        }
        if (ctx.op === 'insert') {
          calls.inserts.push(ctx.payload);
          current = {
            ...ctx.payload,
            id: CERTIFICATE_ID,
            municipality_id: 'municipality-1',
            barangay_id: 'barangay-1',
            created_at: '2026-10-01T08:00:00.000Z',
            resident: RESIDENT,
            creator: { full_name: 'Certificate Creator', role: 'phn' },
          };
          return { data: current, error: null };
        }
        if (ctx.filters.like) return { data: [], error: null };
        return { data: current ? [current] : [], error: null };
      }
      if (table === 'medical_certificate_logs') {
        if (ctx.op === 'insert') {
          logs.push({
            ...ctx.payload,
            created_at: '2026-10-01T09:00:00.000Z',
            actor: { full_name: 'Authorized Reviewer', role: 'phn' },
          });
          return { data: null, error: null };
        }
        return { data: logs, error: null };
      }
      if (table === 'health_audit_logs') {
        calls.inserts.push(ctx.payload);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };

    const chain = {
      select(columns) { calls.selects.push({ table, columns }); return chain; },
      insert(payload) { ctx.op = 'insert'; ctx.payload = payload; return chain; },
      update(payload) { ctx.op = 'update'; ctx.payload = payload; return chain; },
      eq(column, value) { ctx.filters[column] = value; return chain; },
      in(column, values) { ctx.filters.in = { column, values }; return chain; },
      like(column, value) { ctx.filters.like = { column, value }; return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle() {
        const result = resolve();
        return Promise.resolve({
          data: Array.isArray(result.data) ? result.data[0] || null : result.data,
          error: result.error,
        });
      },
      single() {
        const result = resolve();
        return Promise.resolve({
          data: Array.isArray(result.data) ? result.data[0] || null : result.data,
          error: result.error,
        });
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(resolve()).then(onFulfilled, onRejected);
      },
    };
    return chain;
  };

  return {
    client: { from },
    calls,
    getCurrent: () => current,
    getLogs: () => logs,
  };
};

for (const role of ['mho', 'phn']) {
  test(`${role} can prepare, submit, and approve-and-issue within their municipality`, async () => {
    const { client, getCurrent, getLogs, calls } = makeSupabase();
    const user = userFor(role);
    const draft = await create({
      user,
      supabase: client,
      payload: {
        residentId: RESIDENT_ID,
        dateOfExamination: '2026-10-01',
        findings: 'Medical impression',
      },
    });
    assert.equal(draft.status, CERT_STATUS.DRAFT);
    assert.equal(draft.preparedBy, 'Certificate Creator');

    await changeStatus({ user, id: CERTIFICATE_ID, status: CERT_STATUS.FOR_REVIEW, supabase: client });
    const issued = await changeStatus({
      user,
      id: CERTIFICATE_ID,
      status: CERT_STATUS.ISSUED,
      supabase: client,
    });

    assert.equal(issued.status, CERT_STATUS.ISSUED);
    assert.equal(getCurrent().reviewed_by, user.id);
    assert.equal(getCurrent().issued_by, user.id);
    assert.ok(getCurrent().reviewed_at);
    assert.ok(getCurrent().issued_at);
    assert.equal(getLogs().filter((entry) => entry.new_status === CERT_STATUS.ISSUED).length, 1);
    assert.equal(getLogs().at(-1).action, 'Approved and Issued');
    assert.ok(calls.selects
      .filter((selection) => selection.table === 'medical_certificates')
      .every((selection) => !selection.columns.includes('profiles')));
  });

  test(`${role} can record an approval decision`, async () => {
    const { client, getCurrent } = makeSupabase({ certificate: initialCertificate() });
    const user = userFor(role);
    await changeStatus({ user, id: CERTIFICATE_ID, status: CERT_STATUS.APPROVED, supabase: client });
    assert.equal(getCurrent().status, CERT_STATUS.APPROVED);
    assert.equal(getCurrent().reviewed_by, user.id);
    assert.ok(getCurrent().reviewed_at);
  });
}

test('certificate register loads profile attribution without PostgREST profile embeds', async () => {
  const { client, calls } = makeSupabase({ certificate: initialCertificate() });
  const certificates = await list({ user: userFor('mho'), supabase: client });

  assert.equal(certificates.length, 1);
  assert.equal(certificates[0].preparedBy, 'Certificate Creator');
  assert.ok(calls.selects
    .filter((selection) => selection.table === 'medical_certificates')
    .every((selection) => !selection.columns.includes('profiles')));
});

test('rejection requires a reason and persists the reason with the decision', async () => {
  const { client, getCurrent } = makeSupabase({ certificate: initialCertificate() });
  const user = userFor('phn');

  await assert.rejects(
    () => changeStatus({ user, id: CERTIFICATE_ID, status: CERT_STATUS.REJECTED, supabase: client }),
    (error) => error.statusCode === 422,
  );
  assert.equal(getCurrent().status, CERT_STATUS.FOR_REVIEW);

  await changeStatus({
    user,
    id: CERTIFICATE_ID,
    status: CERT_STATUS.REJECTED,
    notes: 'Please correct the examination date.',
    supabase: client,
  });
  assert.equal(getCurrent().status, CERT_STATUS.REJECTED);
  assert.equal(getCurrent().review_remarks, 'Please correct the examination date.');
});

test('reviewers cannot approve or issue a certificate outside their municipality', async () => {
  const certificate = initialCertificate();
  certificate.municipality_id = 'another-municipality';
  const { client } = makeSupabase({ certificate });

  await assert.rejects(
    () => changeStatus({ user: userFor('mho'), id: CERTIFICATE_ID, status: CERT_STATUS.ISSUED, supabase: client }),
    (error) => error.statusCode === 404,
  );
});

test('non-reviewer roles cannot alter certificate status', async () => {
  const { client, calls } = makeSupabase({ certificate: initialCertificate() });
  await assert.rejects(
    () => changeStatus({
      user: { id: 'supervisor-1', role: 'health_supervisor', barangayId: 'barangay-1', municipalityId: 'municipality-1' },
      id: CERTIFICATE_ID,
      status: CERT_STATUS.ISSUED,
      supabase: client,
    }),
    (error) => error.statusCode === 403,
  );
  assert.equal(calls.updates.length, 0);
});

test('a repeated issue request is idempotent and does not create another issuance record', async () => {
  const alreadyIssued = initialCertificate(CERT_STATUS.ISSUED);
  alreadyIssued.reviewed_by = 'user-phn';
  alreadyIssued.issued_by = 'user-phn';
  alreadyIssued.reviewed_at = '2026-10-01T09:00:00.000Z';
  alreadyIssued.issued_at = '2026-10-01T09:01:00.000Z';
  const { client, calls, getCurrent } = makeSupabase({ certificate: alreadyIssued });

  const result = await changeStatus({
    user: userFor('phn'),
    id: CERTIFICATE_ID,
    status: CERT_STATUS.ISSUED,
    supabase: client,
  });

  assert.equal(result.status, CERT_STATUS.ISSUED);
  assert.equal(calls.updates.length, 0);
  assert.equal(getCurrent().issued_at, alreadyIssued.issued_at);
});

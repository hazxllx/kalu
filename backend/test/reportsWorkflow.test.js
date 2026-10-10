import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  REPORT_RECIPIENT_ROLES,
  REPORT_ROUTES,
  assertNoDuplicateSubmission,
  list,
  resolveRecipientRole,
} from '../src/services/reports.service.js';

const migrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/20261010000000_report_recipient_and_duplicate_guards.sql',
  import.meta.url,
));

const duplicateQuery = (data, error = null) => {
  const chain = {
    from() { return chain; },
    select() { return chain; },
    eq() { return chain; },
    neq() { return chain; },
    maybeSingle: async () => ({ data, error }),
  };
  return chain;
};

test('report routes include RHU recipients without allowing RHU submissions', () => {
  assert.deepEqual(REPORT_ROUTES.health_supervisor, ['rhu_personnel']);
  assert.ok(REPORT_RECIPIENT_ROLES.includes('rhu_personnel'));
  assert.throws(() => resolveRecipientRole('rhu_personnel'), /not authorized to submit reports/);
});

test('duplicate submitted reports are rejected before persistence', async () => {
  const supabase = duplicateQuery({ id: 'existing-report' });
  await assert.rejects(
    () => assertNoDuplicateSubmission(supabase, {
      created_by: 'sender',
      report_type: 'M1',
      report_period: '2026-09',
      recipient_role: 'rhu_personnel',
    }),
    (error) => error.statusCode === 409 && /already been submitted/.test(error.message),
  );
});

test('report recipient migration includes RHU RLS access and duplicate protection', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /profile_role\(\) = 'rhu_personnel'/);
  assert.match(sql, /recipient_role = 'rhu_personnel'/);
  assert.match(sql, /reports_submitted_duplicate_idx/);
  assert.match(sql, /where status <> 'Draft'/);
});

/**
 * Thenable Supabase query stub: every builder method records its filter and
 * returns the same chain; awaiting the chain resolves to { data, error }. This
 * lets the outgoing/incoming list queries be asserted without a live database.
 */
const listQueryStub = (data, error = null) => {
  const calls = { eq: {}, in: {}, neq: {} };
  const chain = {
    calls,
    from() { return chain; },
    select() { return chain; },
    order() { return chain; },
    limit() { return chain; },
    eq(col, val) { calls.eq[col] = val; return chain; },
    in(col, val) { calls.in[col] = val; return chain; },
    neq(col, val) { calls.neq[col] = val; return chain; },
    then(resolve) { return Promise.resolve({ data, error }).then(resolve); },
  };
  return chain;
};

test('outgoing reports are scoped to the signed-in sender and mapped for the UI', async () => {
  const supabase = listQueryStub([
    {
      id: 'r1', report_type: 'Follow-up Report', report_period: '2026-09', title: 'Follow-up Report',
      created_by: 'hs-1', sender_role: 'health_supervisor', recipient_role: 'rhu_personnel',
      status: 'Submitted', municipality_id: 'm1', barangay_id: 'b1', barangay: { name: 'San Antonio' },
      submitted_at: '2026-09-30T00:00:00Z', created_at: '2026-09-30T00:00:00Z',
    },
  ]);
  const rows = await list({
    user: { id: 'hs-1', role: 'health_supervisor', municipalityId: 'm1', barangayId: 'b1' },
    box: 'outgoing',
    supabase,
  });
  // Outgoing is restricted to the caller's own reports.
  assert.equal(supabase.calls.eq.created_by, 'hs-1');
  // Response is mapped to the shape the Reports page consumes.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reportType, 'Follow-up Report');
  assert.equal(rows[0].barangay, 'San Antonio');
  assert.equal(rows[0].status, 'Submitted');
});

test('a Health Supervisor with no barangay assignment gets no incoming reports', async () => {
  const supabase = listQueryStub([{ id: 'should-not-be-returned' }]);
  const rows = await list({
    user: { id: 'hs-2', role: 'health_supervisor', municipalityId: 'm1', barangayId: null },
    box: 'incoming',
    supabase,
  });
  assert.deepEqual(rows, []);
});

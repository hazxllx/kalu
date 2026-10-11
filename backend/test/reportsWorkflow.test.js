import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  REPORT_RECIPIENT_ROLES,
  REPORT_ROUTES,
  REPORT_CONTENT_SCHEMA_VERSION,
  assertNoDuplicateSubmission,
  create,
  getById,
  list,
  resolveRecipientRole,
} from '../src/services/reports.service.js';
import { createReportValidator } from '../src/validators/reports.validators.js';
import { FEATURE_ROLES, ROLES } from '../src/config/roles.js';

const migrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/20261010000000_report_recipient_and_duplicate_guards.sql',
  import.meta.url,
));

const snapshotMigrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/20261019000000_reports_content_snapshot.sql',
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

/* ------------------------------------------------------------------------- */
/* Report content snapshot — persistence, retrieval, authorization            */
/* ------------------------------------------------------------------------- */

/**
 * Stub that records the inserted row, resolves the duplicate pre-check to "no
 * existing report", returns the inserted row from the insert().select().single()
 * chain, and returns an empty recipient list from the profiles query so the
 * best-effort notification step is a no-op.
 */
const createStub = () => {
  const state = { inserted: null, selects: [] };
  const make = (table) => {
    const ctx = { table, insert: null };
    const chain = {
      select(cols) { state.selects.push({ table, cols }); return chain; },
      insert(row) { ctx.insert = row; state.inserted = row; return chain; },
      eq() { return chain; },
      neq() { return chain; },
      in() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => {
        if (ctx.insert) {
          return { data: { id: 'report-1', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...ctx.insert }, error: null };
        }
        return { data: null, error: null };
      },
      then(resolve) {
        const data = table === 'profiles' ? [] : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return chain;
  };
  return { from: (table) => make(table), _state: state };
};

const SAMPLE_CONTENT = {
  schemaVersion: 1,
  reportType: 'Follow-up Report',
  reportPeriod: '2026-09',
  summary: { total: 2, byStatus: { Completed: 1, Pending: 1 }, periodFiltered: true },
  columns: [{ label: 'Resident', badge: false }, { label: 'Status', badge: true }],
  rows: [['Juan Dela Cruz', 'Completed'], ['Maria Santos', 'Pending']],
};

test('submitting a report persists the content snapshot atomically with the row', async () => {
  const supabase = createStub();
  const result = await create({
    user: { id: 'hs-1', role: 'health_supervisor', municipalityId: 'm1', barangayId: 'b1' },
    payload: { reportType: 'Follow-up Report', reportPeriod: '2026-09', title: 'Follow-up Report', content: SAMPLE_CONTENT },
    supabase,
  });
  // The snapshot and its schema version are written in the SAME insert as the
  // routing/metadata — one atomic row, so a submission can never lack content.
  assert.deepEqual(supabase._state.inserted.content, SAMPLE_CONTENT);
  assert.equal(supabase._state.inserted.content_schema_version, REPORT_CONTENT_SCHEMA_VERSION);
  assert.equal(supabase._state.inserted.status, 'Submitted');
  // The persisted snapshot is returned to the caller and flagged present.
  assert.deepEqual(result.content, SAMPLE_CONTENT);
  assert.equal(result.hasContent, true);
});

test('an oversized content snapshot is rejected before persistence', async () => {
  const supabase = createStub();
  const huge = { blob: 'x'.repeat(1_000_001) };
  await assert.rejects(
    () => create({
      user: { id: 'hs-1', role: 'health_supervisor', municipalityId: 'm1', barangayId: 'b1' },
      payload: { reportType: 'Follow-up Report', reportPeriod: '2026-09', content: huge },
      supabase,
    }),
    (error) => error.statusCode === 422 && /too large/i.test(error.message),
  );
  assert.equal(supabase._state.inserted, null);
});

test('getById requests the content column while list does not', async () => {
  const detail = {
    id: 'r1', report_type: 'Follow-up Report', report_period: '2026-09', created_by: 'hs-1',
    sender_role: 'health_supervisor', recipient_role: 'rhu_personnel', status: 'Submitted',
    municipality_id: 'm1', barangay_id: 'b1', content: SAMPLE_CONTENT, content_schema_version: 1,
  };
  const detailStub = () => {
    const state = { selects: [] };
    const chain = {
      state,
      from() { return chain; },
      select(cols) { state.selects.push(cols); return chain; },
      eq() { return chain; },
      neq() { return chain; },
      in() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle: async () => ({ data: detail, error: null }),
      then(resolve) { return Promise.resolve({ data: [detail], error: null }).then(resolve); },
    };
    return chain;
  };

  const g = detailStub();
  const record = await getById({
    user: { id: 'rhu-1', role: 'rhu_personnel', municipalityId: 'm1', barangayId: null },
    id: 'r1',
    supabase: g,
  });
  assert.ok(g.state.selects.some((c) => /\bcontent\b/.test(c)), 'detail select must include content');
  assert.deepEqual(record.content, SAMPLE_CONTENT);
  assert.equal(record.hasContent, true);

  const l = detailStub();
  await list({ user: { id: 'rhu-1', role: 'rhu_personnel', municipalityId: 'm1', barangayId: null }, box: 'incoming', supabase: l });
  assert.ok(l.state.selects.every((c) => !/,\s*content\b/.test(c)), 'list select must not include the content snapshot');
});

test('a legacy report row with no snapshot reports content unavailable', async () => {
  const legacy = {
    id: 'r-old', report_type: 'Referral Report', report_period: '2026-01', created_by: 'hs-1',
    sender_role: 'health_supervisor', recipient_role: 'rhu_personnel', status: 'Reviewed',
    municipality_id: 'm1', barangay_id: 'b1', content: null, content_schema_version: null,
  };
  const stub = {
    from() { return stub; },
    select() { return stub; },
    eq() { return stub; },
    maybeSingle: async () => ({ data: legacy, error: null }),
  };
  const record = await getById({
    user: { id: 'hs-1', role: 'health_supervisor', municipalityId: 'm1', barangayId: 'b1' },
    id: 'r-old',
    supabase: stub,
  });
  assert.equal(record.content, null);
  assert.equal(record.hasContent, false);
});

test('createReportValidator accepts an object snapshot and rejects bad shapes/sizes', () => {
  const ok = createReportValidator({ reportType: 'Follow-up Report', content: SAMPLE_CONTENT });
  assert.ok(ok.value, 'a valid payload returns { value }');
  assert.deepEqual(ok.value.content, SAMPLE_CONTENT);

  const arrayContent = createReportValidator({ reportType: 'Follow-up Report', content: [1, 2, 3] });
  assert.ok(arrayContent.error, 'an array snapshot is rejected');
  assert.ok(arrayContent.error.content);

  const oversized = createReportValidator({ reportType: 'Follow-up Report', content: { blob: 'x'.repeat(1_000_001) } });
  assert.ok(oversized.error, 'an oversized snapshot is rejected');
  assert.ok(oversized.error.content);

  // Content is optional: a submission with no snapshot is still valid.
  const noContent = createReportValidator({ reportType: 'Follow-up Report' });
  assert.ok(noContent.value);
  assert.equal(noContent.value.content, undefined);
});

test('RHU Personnel are authorized to use the reports feature (as recipients)', () => {
  assert.ok(FEATURE_ROLES.reports.includes(ROLES.RHU_PERSONNEL));
  // Still never a sender: resolving a recipient for RHU throws.
  assert.throws(() => resolveRecipientRole(ROLES.RHU_PERSONNEL), /not authorized to submit reports/);
});

test('the snapshot migration adds immutable content columns', () => {
  const sql = fs.readFileSync(snapshotMigrationPath, 'utf8');
  assert.match(sql, /add column if not exists content jsonb/);
  assert.match(sql, /add column if not exists content_schema_version integer/);
  // Snapshot immutability is enforced by the review guard.
  assert.match(sql, /new\.content is distinct from old\.content/);
  // Additive + backward compatible: no destructive column changes.
  assert.doesNotMatch(sql, /drop column/i);
});


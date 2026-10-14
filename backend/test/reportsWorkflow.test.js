import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  REPORT_RECIPIENT_ROLES,
  REPORT_ROUTES,
  REPORT_TRANSITIONS,
  REPORT_CONTENT_SCHEMA_VERSION,
  assertNoDuplicateSubmission,
  create,
  getById,
  list,
  review,
  resubmit,
  submitDraft,
  resolveRecipientRole,
} from '../src/services/reports.service.js';
import {
  createReportValidator,
  reviewReportValidator,
  resubmitReportValidator,
  submitReportValidator,
} from '../src/validators/reports.validators.js';
import { FEATURE_ROLES, ROLES } from '../src/config/roles.js';

const migrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/20261010000000_report_recipient_and_duplicate_guards.sql',
  import.meta.url,
));

const snapshotMigrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/20261019000000_reports_content_snapshot.sql',
  import.meta.url,
));
const reportHistoryMigrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/20261028000000_report_review_history.sql',
  import.meta.url,
));
const reportFacilityMigrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/20261029000000_report_drafts_and_rhu_facility_scope.sql',
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

test('RHU incoming reports and report details are bound to the assigned facility', async () => {
  const report = {
    id: 'r1', report_type: 'Follow-up Report', report_period: '2026-09', title: 'Follow-up Report',
    created_by: 'hs-1', sender_role: 'health_supervisor', recipient_role: 'rhu_personnel',
    recipient_facility_id: 'facility-1', municipality_id: 'm1', barangay_id: 'b1',
    status: 'Submitted', submitted_at: '2026-09-30T00:00:00Z', created_at: '2026-09-30T00:00:00Z',
  };
  const incomingStub = listQueryStub([report]);
  await list({
    user: { id: 'rhu-1', role: 'rhu_personnel', municipalityId: 'm1', facilityId: 'facility-1' },
    box: 'incoming',
    supabase: incomingStub,
  });
  assert.equal(incomingStub.calls.eq.recipient_facility_id, 'facility-1');

  const detailStub = {
    from() { return this; },
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    maybeSingle: async () => ({ data: report, error: null }),
  };
  await assert.rejects(
    () => getById({
      user: { id: 'rhu-other', role: 'rhu_personnel', municipalityId: 'm1', facilityId: 'facility-2' },
      id: 'r1',
      supabase: detailStub,
    }),
    (error) => error.statusCode === 404,
  );
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

test('a generated report is saved as a draft and only submitDraft marks it submitted', async () => {
  const supabase = createStub();
  const draft = await create({
    user: { id: 'hs-1', role: 'health_supervisor', municipalityId: 'm1', barangayId: 'b1' },
    payload: {
      reportType: 'Follow-up Report',
      reportPeriod: '2026-09',
      title: 'Follow-up Report',
      status: 'Draft',
      content: SAMPLE_CONTENT,
    },
    supabase,
  });
  assert.equal(draft.status, 'Draft');
  assert.equal(supabase._state.inserted.submitted_at, null);
  assert.equal(supabase._state.inserted.recipient_facility_id, 'facility-1');

  const state = {
    row: {
      ...supabase._state.inserted,
      id: 'draft-1',
      created_at: '2026-09-30T00:00:00.000Z',
      updated_at: '2026-09-30T00:00:00.000Z',
      sender: { full_name: 'Health Supervisor' },
    },
    update: null,
  };
  const updateClient = {
    from() {
      const chain = {
        select() { return chain; },
        update(value) { state.update = value; return chain; },
        eq() { return chain; },
        in() { return chain; },
        maybeSingle: async () => ({
          data: state.update ? { ...state.row, ...state.update } : state.row,
          error: null,
        }),
        then(resolve) { return Promise.resolve({ data: [{ id: 'rhu-1' }], error: null }).then(resolve); },
      };
      return chain;
    },
  };
  const submitted = await submitDraft({
    user: { id: 'hs-1', role: 'health_supervisor', municipalityId: 'm1', barangayId: 'b1' },
    id: 'draft-1',
    supabase: updateClient,
  });
  assert.equal(state.update.status, 'Submitted');
  assert.ok(state.update.submitted_at);
  assert.equal(submitted.status, 'Submitted');
  assert.deepEqual(submitted.content, SAMPLE_CONTENT);
});

test('report recipient migration includes RHU RLS access and duplicate protection', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /profile_role\(\) = 'rhu_personnel'/);
  assert.match(sql, /recipient_role = 'rhu_personnel'/);
  assert.match(sql, /reports_submitted_duplicate_idx/);
  assert.match(sql, /where status <> 'Draft'/);
});

test('report facility migration scopes RHU reads, inserts, updates, and review history', () => {
  const sql = fs.readFileSync(reportFacilityMigrationPath, 'utf8');
  assert.match(sql, /recipient_facility_id uuid/);
  assert.match(sql, /recipient_facility_id = public\.profile_facility_id\(\)/);
  assert.match(sql, /content is not null/);
  assert.match(sql, /old\.status in \('Draft', 'Needs Revision'\)/);
  assert.match(sql, /new\.status = 'Submitted'/);
  assert.match(sql, /only personnel at the addressed RHU may review this report/);
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
        const data = table === 'profiles'
          ? [{ id: 'rhu-1' }]
          : table === 'facilities'
            ? [{ id: 'facility-1', municipality_id: 'm1', barangay_id: 'b1' }]
            : [];
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
  generatedAt: '2026-09-30T00:00:00.000Z',
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
  assert.equal(supabase._state.inserted.recipient_facility_id, 'facility-1');
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
    recipient_facility_id: 'facility-1',
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
    user: { id: 'rhu-1', role: 'rhu_personnel', municipalityId: 'm1', facilityId: 'facility-1', barangayId: null },
    id: 'r1',
    supabase: g,
  });
  assert.ok(g.state.selects.some((c) => /\bcontent\b/.test(c)), 'detail select must include content');
  assert.deepEqual(record.content, SAMPLE_CONTENT);
  assert.equal(record.hasContent, true);

  const l = detailStub();
  await list({ user: { id: 'rhu-1', role: 'rhu_personnel', municipalityId: 'm1', facilityId: 'facility-1', barangayId: null }, box: 'incoming', supabase: l });
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
    order() { return stub; },
    maybeSingle: async () => ({ data: legacy, error: null }),
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
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
  const ok = createReportValidator({
    reportType: 'Follow-up Report',
    reportPeriod: '2026-09',
    content: SAMPLE_CONTENT,
  });
  assert.ok(ok.value, 'a valid payload returns { value }');
  assert.deepEqual(ok.value.content, SAMPLE_CONTENT);

  const arrayContent = createReportValidator({
    reportType: 'Follow-up Report',
    reportPeriod: '2026-09',
    content: [1, 2, 3],
  });
  assert.ok(arrayContent.error, 'an array snapshot is rejected');
  assert.ok(arrayContent.error.content);

  const oversized = createReportValidator({
    reportType: 'Follow-up Report',
    reportPeriod: '2026-09',
    content: { blob: 'x'.repeat(1_000_001) },
  });
  assert.ok(oversized.error, 'an oversized snapshot is rejected');
  assert.ok(oversized.error.content);

  const noContent = createReportValidator({ reportType: 'Follow-up Report', reportPeriod: '2026-09' });
  assert.ok(noContent.error);
  assert.ok(noContent.error.content);

  const invalidSummary = createReportValidator({
    reportType: 'Follow-up Report',
    reportPeriod: '2026-09',
    content: { ...SAMPLE_CONTENT, summary: { ...SAMPLE_CONTENT.summary, total: 3 } },
  });
  assert.ok(invalidSummary.error?.content);
  assert.ok(submitReportValidator({}).value);
  assert.ok(submitReportValidator({ status: 'Reviewed' }).error);
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

test('report status transitions require receipt before decision and keep terminal states final', () => {
  assert.deepEqual(REPORT_TRANSITIONS.Submitted, ['Received']);
  assert.deepEqual(REPORT_TRANSITIONS.Draft, ['Submitted']);
  assert.deepEqual(REPORT_TRANSITIONS.Received, ['Reviewed', 'Needs Revision', 'Rejected']);
  assert.deepEqual(REPORT_TRANSITIONS['Needs Revision'], ['Submitted']);
  assert.deepEqual(REPORT_TRANSITIONS.Reviewed, []);
  assert.deepEqual(REPORT_TRANSITIONS.Rejected, []);
});

const reviewStub = (existing) => {
  const state = { update: null };
  const chain = {
    from() { return chain; },
    select() { return chain; },
    eq() { return chain; },
    maybeSingle: async () => ({ data: existing, error: null }),
    update(row) { state.update = row; return chain; },
    single: async () => ({ data: { ...existing, ...state.update }, error: null }),
  };
  return { supabase: chain, state };
};

test('only the addressed MHO can acknowledge and decide municipal reports', async () => {
  const existing = {
    id: 'r1',
    created_by: 'phn-1',
    report_type: 'Monthly Report',
    recipient_role: ROLES.MHO,
    municipality_id: 'm1',
    status: 'Received',
    remarks: '',
  };
  const { supabase, state } = reviewStub(existing);
  const report = await review({
    user: { id: 'mho-1', role: ROLES.MHO, municipalityId: 'm1' },
    id: 'r1',
    status: 'Reviewed',
    supabase,
  });
  assert.equal(state.update.status, 'Reviewed');
  assert.equal(state.update.reviewed_by, 'mho-1');
  assert.equal(report.status, 'Reviewed');

  const oversight = reviewStub({ ...existing, recipient_role: ROLES.RHU_PERSONNEL });
  await assert.rejects(
    () => review({
      user: { id: 'mho-1', role: ROLES.MHO, municipalityId: 'm1' },
      id: 'r1',
      status: 'Reviewed',
      supabase: oversight.supabase,
    }),
    (error) => error.statusCode === 403,
  );
});

test('MHO cannot decide an unreceived or draft report; rejection requires an explanation', async () => {
  for (const status of ['Submitted', 'Draft']) {
    const stub = reviewStub({
      id: 'r1', created_by: 'phn-1', report_type: 'Monthly Report',
      recipient_role: ROLES.MHO, municipality_id: 'm1', status, remarks: '',
    });
    await assert.rejects(
      () => review({
        user: { id: 'mho-1', role: ROLES.MHO, municipalityId: 'm1' },
        id: 'r1',
        status: 'Reviewed',
        supabase: stub.supabase,
      }),
      (error) => error.statusCode === 409,
    );
  }
  assert.ok(reviewReportValidator({ status: 'Rejected' }).error.remarks);
  assert.ok(reviewReportValidator({ status: 'Needs Revision' }).error.remarks);
  assert.equal(
    reviewReportValidator({ status: 'Rejected', remarks: 'Please correct the period totals.' }).value.remarks,
    'Please correct the period totals.',
  );
  assert.equal(
    reviewReportValidator({ status: 'Needs Revision', remarks: 'Please correct the period totals.' }).value.status,
    'Needs Revision',
  );
  assert.ok(resubmitReportValidator({ content: [] }).error.content);
});

test('sender can resubmit a report marked Needs Revision with a new snapshot', async () => {
  const original = {
    id: 'r1',
    created_by: 'hs-1',
    report_type: 'Follow-up Report',
    report_period: '2026-09',
    recipient_role: ROLES.RHU_PERSONNEL,
    municipality_id: 'm1',
    barangay_id: 'b1',
    status: 'Needs Revision',
    remarks: 'Correct the reporting period totals.',
  };
  const state = { update: null };
  const make = (table) => {
    const chain = {
      from() { return chain; },
      select() { return chain; },
      eq() { return chain; },
      in() { return chain; },
      maybeSingle: async () => ({ data: table === 'reports' ? original : null, error: null }),
      update(row) { state.update = row; return chain; },
      single: async () => ({ data: { ...original, ...state.update }, error: null }),
      then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
    };
    return chain;
  };
  const supabase = { from: make };
  const nextContent = {
    ...SAMPLE_CONTENT,
    summary: { ...SAMPLE_CONTENT.summary, total: 3 },
    rows: [...SAMPLE_CONTENT.rows, ['Pedro Reyes', 'Pending']],
  };
  const result = await resubmit({
    user: { id: 'hs-1', role: ROLES.HEALTH_SUPERVISOR, municipalityId: 'm1', barangayId: 'b1' },
    id: 'r1',
    content: nextContent,
    supabase,
  });
  assert.equal(state.update.status, 'Submitted');
  assert.deepEqual(state.update.content, nextContent);
  assert.equal(state.update.remarks, '');
  assert.equal(state.update.reviewed_by, null);
  assert.equal(result.status, 'Submitted');
});

test('only the report sender can resubmit a Needs Revision report', async () => {
  const chain = {
    from() { return chain; },
    select() { return chain; },
    eq() { return chain; },
    maybeSingle: async () => ({
      data: { id: 'r1', created_by: 'other', status: 'Needs Revision' },
      error: null,
    }),
  };
  await assert.rejects(
    () => resubmit({
      user: { id: 'hs-1', role: ROLES.HEALTH_SUPERVISOR, municipalityId: 'm1', barangayId: 'b1' },
      id: 'r1',
      content: { summary: {} },
      supabase: { from: () => chain },
    }),
    (error) => error.statusCode === 404,
  );
});

test('a report sender cannot review their own MHO-routed submission', async () => {
  const ownReport = reviewStub({
    id: 'r1', created_by: 'mho-1', report_type: 'Monthly Report',
    recipient_role: ROLES.MHO, municipality_id: 'm1', status: 'Received', remarks: '',
  });
  await assert.rejects(
    () => review({
      user: { id: 'mho-1', role: ROLES.MHO, municipalityId: 'm1' },
      id: 'r1',
      status: 'Reviewed',
      supabase: ownReport.supabase,
    }),
    (error) => error.statusCode === 403,
  );
});

test('report history migration records status changes and restricts updates to the routed role', () => {
  const sql = fs.readFileSync(reportHistoryMigrationPath, 'utf8');
  assert.match(sql, /create table if not exists public\.report_status_history/);
  assert.match(sql, /create trigger reports_status_history/);
  assert.match(sql, /only the MHO may decide reports addressed to the MHO/i);
  assert.match(sql, /senders cannot review their own submissions/i);
  assert.match(sql, /invalid status transition/);
  assert.match(sql, /a revision or rejection explanation is required/);
});

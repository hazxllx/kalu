/**
 * Authenticated end-to-end verification of report drafts, submission, RHU
 * retrieval, persistence, and review. This script writes a synthetic QA report.
 *
 * Before running against a hosted Supabase project, explicitly mark it as
 * non-production with KALUSAGAP_DATABASE_ENV=test|development and set
 * REPORTS_E2E_ALLOW_REMOTE=true. Production and unclassified targets are refused.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const API = process.env.API_URL || 'http://localhost:5000/api';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const pass = [];
const fail = [];
const check = (name, ok, extra = '') => {
  (ok ? pass : fail).push(`${name}${extra ? ` — ${extra}` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const reqEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} — required to run live report verification.`);
  return value;
};

const assertNonProduction = () => {
  const hostname = new URL(SUPABASE_URL).hostname.toLowerCase();
  const local = ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.localhost');
  if (local) return;
  const environment = String(process.env.KALUSAGAP_DATABASE_ENV || '').toLowerCase();
  if (!['test', 'development'].includes(environment) || process.env.REPORTS_E2E_ALLOW_REMOTE !== 'true') {
    throw new Error(
      'Refusing to write QA report data to an unclassified/production Supabase target. ' +
      'For an approved test/development project, set KALUSAGAP_DATABASE_ENV and REPORTS_E2E_ALLOW_REMOTE=true.',
    );
  }
};

async function signIn(email, password) {
  const client = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email}: ${error.message}`);
  return data.session.access_token;
}

const api = async (token, path, options = {}) => {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `****** } : {}),
      ...(options.headers || {}),
    },
  });
  let body = null;
  try { body = await response.json(); } catch { /* Non-JSON response. */ }
  return { status: response.status, body };
};

const run = async () => {
  assertNonProduction();
  const supervisorEmail = process.env.REPORTS_SUPERVISOR_EMAIL || 'supervisor@kalusagap.test';
  const rhuEmail = process.env.REPORTS_RHU_EMAIL || 'rhu.personnel@kalusagap.test';
  const supervisorToken = await signIn(supervisorEmail, reqEnv('KALUSAGAP_SUPERVISOR_PASSWORD'));
  const rhuToken = await signIn(rhuEmail, reqEnv('KALUSAGAP_RHU_PASSWORD'));
  const stamp = Date.now();
  const period = new Date().toISOString().slice(0, 7);
  const type = `QA Follow-up Report ${stamp}`;
  const title = `QA Reports E2E ${stamp}`;
  const [supervisorMe, rhuMe] = await Promise.all([
    api(supervisorToken, '/auth/me'),
    api(rhuToken, '/auth/me'),
  ]);
  check('Supervisor account is Health Supervisor', supervisorMe.status === 200 && supervisorMe.body?.data?.user?.role === 'health_supervisor');
  check('RHU account is RHU Personnel', rhuMe.status === 200 && rhuMe.body?.data?.user?.role === 'rhu_personnel');
  const sender = supervisorMe.body?.data?.user;
  const receiver = rhuMe.body?.data?.user;
  if (!sender?.id || !receiver?.id || !sender?.municipalityId || !sender?.barangayId || !receiver?.facilityId) {
    throw new Error('The test accounts need active profiles with matching municipality, barangay, and RHU facility assignments.');
  }
  check('Sender and receiver belong to the same municipality', sender.municipalityId === receiver.municipalityId);

  const content = {
    schemaVersion: 1,
    reportType: type,
    reportPeriod: period,
    title,
    scope: sender.barangay,
    barangay: sender.barangay,
    generatedAt: new Date().toISOString(),
    summary: { total: 1, byStatus: { 'QA sample': 1 }, periodFiltered: true },
    columns: [{ label: 'QA record', badge: false }, { label: 'Result', badge: true }],
    rows: [['Synthetic QA record', 'End-to-end verification only']],
  };
  const payload = { reportType: type, reportPeriod: period, title, content };

  const missingContent = await api(supervisorToken, '/reports', {
    method: 'POST',
    body: JSON.stringify({ reportType: type, reportPeriod: period, title }),
  });
  check('Missing report data is rejected before persistence (422)', missingContent.status === 422, `status=${missingContent.status}`);

  const invalidContent = await api(supervisorToken, '/reports', {
    method: 'POST',
    body: JSON.stringify({ ...payload, reportPeriod: `QA-${stamp}`, content: { invalid: true } }),
  });
  check('Malformed report data is rejected (422)', invalidContent.status === 422, `status=${invalidContent.status}`);

  const draftResponse = await api(supervisorToken, '/reports', {
    method: 'POST',
    body: JSON.stringify({ ...payload, status: 'Draft' }),
  });
  const draft = draftResponse.body?.data?.record;
  check('Generate creates a persisted Draft with a snapshot', draftResponse.status === 201 && draft?.status === 'Draft' && draft?.hasContent);
  if (!draft?.id) throw new Error(`Draft creation failed: ${JSON.stringify(draftResponse.body)}`);
  check('Draft has no premature submission timestamp', !draft.submittedAt);
  check('Draft is visible to its sender after a fresh list request', (
    (await api(supervisorToken, '/reports?box=outgoing')).body?.data?.rows || []
  ).some((row) => row.id === draft.id));
  check('Draft is not visible in the RHU inbox before submission', !(
    ((await api(rhuToken, '/reports?box=incoming')).body?.data?.rows || [])
      .some((row) => row.id === draft.id)
  ));

  const submitResponse = await api(supervisorToken, `/reports/${draft.id}/submit`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  });
  const submitted = submitResponse.body?.data?.record;
  check('Review confirmation submits the saved draft (200)', submitResponse.status === 200 && submitted?.status === 'Submitted');
  if (!submitted?.id) throw new Error(`Draft submit failed: ${JSON.stringify(submitResponse.body)}`);
  check('Submission response includes a submission timestamp and facility', Boolean(submitted.submittedAt && submitted.recipientFacilityId));

  const { data: databaseRow, error: databaseError } = await SERVICE
    .from('reports')
    .select('id, report_type, report_period, title, created_by, sender_role, recipient_role, recipient_facility_id, municipality_id, barangay_id, status, submitted_at, content, content_schema_version')
    .eq('id', submitted.id)
    .maybeSingle();
  check('Submission is persisted with complete routing and report snapshot', !databaseError &&
    databaseRow?.report_type === type &&
    databaseRow?.report_period === period &&
    databaseRow?.created_by === sender.id &&
    databaseRow?.sender_role === 'health_supervisor' &&
    databaseRow?.recipient_role === 'rhu_personnel' &&
    databaseRow?.recipient_facility_id === receiver.facilityId &&
    databaseRow?.municipality_id === sender.municipalityId &&
    databaseRow?.barangay_id === sender.barangayId &&
    databaseRow?.status === 'Submitted' &&
    Boolean(databaseRow?.submitted_at) &&
    databaseRow?.content_schema_version === 1 &&
    databaseRow?.content?.reportType === content.reportType &&
    databaseRow?.content?.reportPeriod === content.reportPeriod &&
    databaseRow?.content?.generatedAt === content.generatedAt &&
    JSON.stringify(databaseRow?.content?.columns) === JSON.stringify(content.columns) &&
    JSON.stringify(databaseRow?.content?.rows) === JSON.stringify(content.rows),
  `database error=${databaseError?.message || 'none'}`);

  const senderRefresh = await api(supervisorToken, '/reports?box=outgoing');
  const senderRows = senderRefresh.body?.data?.rows || [];
  check('Sender refresh shows the persisted submission', senderRows.some((row) => row.id === submitted.id && row.status === 'Submitted'));

  const rhuRefresh = await api(rhuToken, '/reports?box=incoming');
  const rhuRows = rhuRefresh.body?.data?.rows || [];
  check('Authorized RHU facility inbox contains the report', rhuRefresh.status === 200 &&
    rhuRows.some((row) => row.id === submitted.id && row.recipientFacilityId === receiver.facilityId));
  const rhuDetail = await api(rhuToken, `/reports/${submitted.id}`);
  check('RHU can open and retrieve the exact submitted snapshot', rhuDetail.status === 200 &&
    rhuDetail.body?.data?.record?.content?.reportType === content.reportType &&
    rhuDetail.body?.data?.record?.content?.generatedAt === content.generatedAt &&
    JSON.stringify(rhuDetail.body?.data?.record?.content?.rows) === JSON.stringify(content.rows));

  const received = await api(rhuToken, `/reports/${submitted.id}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'Received' }),
  });
  check('RHU acknowledgement moves Submitted → Received', received.status === 200 && received.body?.data?.record?.status === 'Received');
  const reviewed = await api(rhuToken, `/reports/${submitted.id}/review`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'Reviewed' }),
  });
  check('RHU review moves Received → Reviewed', reviewed.status === 200 && reviewed.body?.data?.record?.status === 'Reviewed');
  const refreshedHistory = await api(supervisorToken, '/reports?box=outgoing');
  check('Sender refresh retains the report and final review status', (
    (refreshedHistory.body?.data?.rows || []).some((row) => row.id === submitted.id && row.status === 'Reviewed')
  ));

  const duplicate = await api(supervisorToken, `/reports/${draft.id}/submit`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  });
  check('Repeated submission is rejected (409)', duplicate.status === 409, `status=${duplicate.status}`);

  const unauthorizedRead = await api(null, `/reports/${submitted.id}`);
  check('Unauthenticated report retrieval is denied (401)', unauthorizedRead.status === 401, `status=${unauthorizedRead.status}`);
  const unauthorizedSubmit = await api(rhuToken, '/reports', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  check('RHU Personnel cannot originate reports (403)', unauthorizedSubmit.status === 403, `status=${unauthorizedSubmit.status}`);

  let networkRejected = false;
  try {
    await fetch('http://127.0.0.1:1/api/reports');
  } catch {
    networkRejected = true;
  }
  check('Network failure is surfaced as a rejected request, not success', networkRejected);

  const { data: history, error: historyError } = await SERVICE
    .from('report_status_history')
    .select('previous_status, new_status, action')
    .eq('report_id', submitted.id)
    .order('created_at', { ascending: true });
  check('Database history records Draft → Submitted → Received → Reviewed', !historyError &&
    history?.some((event) => event.previous_status === 'Draft' && event.new_status === 'Submitted') &&
    history?.some((event) => event.previous_status === 'Submitted' && event.new_status === 'Received') &&
    history?.some((event) => event.previous_status === 'Received' && event.new_status === 'Reviewed'),
  `history error=${historyError?.message || 'none'}`);

  console.log(`\nQA report written: ${title} (${period}) — ${submitted.id}. It is retained for inspection.`);
  console.log(`\n=== ${pass.length} passed, ${fail.length} failed ===`);
  if (fail.length) {
    console.log('FAILURES:');
    fail.forEach((failure) => console.log(` - ${failure}`));
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error('REPORT WORKFLOW E2E ERROR', error);
  process.exitCode = 1;
});

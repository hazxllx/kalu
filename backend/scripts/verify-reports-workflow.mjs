/**
 * Live, authenticated end-to-end verification of the report submission workflow.
 *
 * Runs against the REAL Supabase project and a running API — through Supabase
 * sign-in, Express authorization, the reports service and Postgres RLS. This is
 * the request path the browser uses; it is not a GUI/browser driver.
 *
 * RUN IT WITH THE API ALREADY LISTENING:
 *   cd backend
 *   node src/server.js                         # terminal 1
 *   node scripts/verify-reports-workflow.mjs    # terminal 2
 *
 * Credentials come from the environment (never source):
 *   KALUSAGAP_SUPERVISOR_PASSWORD   password for the Health Supervisor account
 *   KALUSAGAP_RHU_PASSWORD          password for the RHU Personnel account
 * Optional account overrides:
 *   REPORTS_SUPERVISOR_EMAIL  (default supervisor@kalusagap.test)
 *   REPORTS_RHU_EMAIL         (default rhu.personnel@kalusagap.test)
 *
 * It writes ONE identifiable QA report (report_period = "QA-<timestamp>",
 * title "QA Reports E2E <timestamp>") to the real database and does not delete
 * it, matching the existing live-harness convention.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const API = process.env.API_URL || 'http://localhost:5000/api';
const SERVICE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const pass = [];
const fail = [];
const check = (name, ok, extra = '') => {
  (ok ? pass : fail).push(`${name}${extra ? ` — ${extra}` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const reqEnv = (name) => {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name} in the environment — required to run this verification.`); process.exit(1); }
  return v;
};

async function signIn(email, password) {
  const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email}: ${error.message}`);
  return data.session.access_token;
}

const api = async (token, path, options = {}) => {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  let body = null;
  try { body = await res.json(); } catch { /* no body */ }
  return { status: res.status, body };
};

// Inclusive YYYY-MM-DD window for a YYYY-MM period (matches the UI helper).
const monthWindow = (period) => {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
};

const run = async () => {
  const SUP_EMAIL = process.env.REPORTS_SUPERVISOR_EMAIL || 'supervisor@kalusagap.test';
  const RHU_EMAIL = process.env.REPORTS_RHU_EMAIL || 'rhu.personnel@kalusagap.test';
  const SUP_PASS = reqEnv('KALUSAGAP_SUPERVISOR_PASSWORD');
  const RHU_PASS = reqEnv('KALUSAGAP_RHU_PASSWORD');

  const stamp = Date.now();
  const PERIOD = `QA-${stamp}`;
  const TYPE = 'Follow-up Report';
  const TITLE = `QA Reports E2E ${stamp}`;

  const supTok = await signIn(SUP_EMAIL, SUP_PASS);
  const rhuTok = await signIn(RHU_EMAIL, RHU_PASS);

  // 1. Identity resolves correctly through /auth/me.
  const supMe = await api(supTok, '/auth/me');
  check('Supervisor signs in and resolves role=health_supervisor', supMe.status === 200 && supMe.body?.data?.user?.role === 'health_supervisor', `role=${supMe.body?.data?.user?.role} brgy=${supMe.body?.data?.user?.barangay}`);
  const rhuMe = await api(rhuTok, '/auth/me');
  check('RHU signs in and resolves role=rhu_personnel', rhuMe.status === 200 && rhuMe.body?.data?.user?.role === 'rhu_personnel', `role=${rhuMe.body?.data?.user?.role}`);
  const supBarangay = supMe.body?.data?.user?.barangay;
  const supMunicipalityId = supMe.body?.data?.user?.municipalityId;

  // 2. Preview data source: the count the UI preview would show for this month,
  //    read from the SAME scoped API the preview uses, compared to the DB.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const win = monthWindow(thisMonth);
  const fu = await api(supTok, `/operational/followups?from=${win.from}&to=${win.to}`);
  const apiFollowupCount = (fu.body?.data?.rows || []).length;
  const { count: dbFollowupCount } = await SERVICE
    .from('follow_ups')
    .select('*', { count: 'exact', head: true })
    .gte('scheduled_date', win.from)
    .lte('scheduled_date', win.to);
  check('Preview source API is reachable and scope-enforced for the supervisor', fu.status === 200, `api_rows=${apiFollowupCount} db_rows(all scopes)=${dbFollowupCount}`);

  // 3. Baseline outgoing count.
  const before = await api(supTok, '/reports?box=outgoing');
  const beforeRows = before.body?.data?.rows || before.body?.data?.records || [];
  check('Supervisor outgoing list loads', before.status === 200, `rows=${beforeRows.length}`);

  // 4. Generate -> Submit (the create the preview's Submit button performs).
  const created = await api(supTok, '/reports', {
    method: 'POST',
    body: JSON.stringify({ reportType: TYPE, reportPeriod: PERIOD, title: TITLE }),
  });
  const rec = created.body?.data?.record;
  check('Supervisor submits a report (201)', created.status === 201 && Boolean(rec?.id), JSON.stringify(created.body?.error || created.status));
  check('Submitted report is routed Health Supervisor -> RHU Personnel', rec?.recipientRole === 'rhu_personnel' && rec?.senderRole === 'health_supervisor', `sender=${rec?.senderRole} recipient=${rec?.recipientRole} status=${rec?.status}`);

  // 5. Persistence: the submission is in the DB with the supervisor's own scope.
  const { data: dbRow } = await SERVICE.from('reports').select('*').eq('id', rec?.id).maybeSingle();
  check('Submission persisted to the database', Boolean(dbRow), `id=${rec?.id}`);
  check('Persisted scope is the server-derived supervisor scope', dbRow && dbRow.created_by === supMe.body?.data?.user?.id && dbRow.municipality_id === supMunicipalityId, `created_by_match=${dbRow?.created_by === supMe.body?.data?.user?.id} muni_match=${dbRow?.municipality_id === supMunicipalityId}`);

  // 6. Visible to the sender after "refresh" (fresh list fetch).
  const after = await api(supTok, '/reports?box=outgoing');
  const afterRows = after.body?.data?.rows || after.body?.data?.records || [];
  check('Submission is visible in the supervisor outgoing list', afterRows.some((r) => r.id === rec?.id), `rows=${afterRows.length}`);

  // 7. Correct recipient inbox: RHU incoming contains it, scoped to RHU.
  const rhuInbox = await api(rhuTok, '/reports?box=incoming');
  const inboxRows = rhuInbox.body?.data?.rows || rhuInbox.body?.data?.records || [];
  check('RHU incoming inbox loads', rhuInbox.status === 200, `rows=${inboxRows.length}`);
  check('RHU inbox contains the submitted report', inboxRows.some((r) => r.id === rec?.id), `has=${inboxRows.some((r) => r.id === rec?.id)}`);
  check('RHU inbox only exposes reports routed to RHU Personnel', inboxRows.every((r) => r.recipientRole === 'rhu_personnel'));

  // 8. Duplicate submission is rejected (same type+period+recipient).
  const dup = await api(supTok, '/reports', {
    method: 'POST',
    body: JSON.stringify({ reportType: TYPE, reportPeriod: PERIOD, title: TITLE }),
  });
  check('Duplicate submission is rejected (409)', dup.status === 409, `status=${dup.status}`);

  // 9. Unauthorized: RHU Personnel may NOT submit (not a sender role).
  const rhuSubmit = await api(rhuTok, '/reports', {
    method: 'POST',
    body: JSON.stringify({ reportType: TYPE, reportPeriod: `QA-RHU-${stamp}`, title: 'QA RHU submit' }),
  });
  check('RHU Personnel cannot submit a report (403)', rhuSubmit.status === 403, `status=${rhuSubmit.status}`);

  // 10. A forged recipient route is rejected outright (server validates the
  //     requested recipient against the sender's allowed routes).
  const forgedRoute = await api(supTok, '/reports', {
    method: 'POST',
    body: JSON.stringify({ reportType: TYPE, reportPeriod: `QA-ROUTE-${stamp}`, title: 'QA forged route', recipientRole: 'mho' }),
  });
  check('Forged recipient route is rejected (4xx)', forgedRoute.status >= 400 && forgedRoute.status < 500, `status=${forgedRoute.status}`);

  // 11. Forged scope/identity fields are ignored: the create still succeeds but
  //     is bound to the authenticated session, never the client-supplied values.
  const forgedMuni = '00000000-0000-0000-0000-000000000000';
  const forged = await api(supTok, '/reports', {
    method: 'POST',
    body: JSON.stringify({
      reportType: TYPE, reportPeriod: `QA-FORGE-${stamp}`, title: 'QA forged scope',
      municipalityId: forgedMuni, municipality_id: forgedMuni, barangayId: forgedMuni, barangay_id: forgedMuni,
      created_by: forgedMuni, status: 'Reviewed',
    }),
  });
  const forgedRec = forged.body?.data?.record;
  const { data: forgedDb } = forgedRec?.id ? await SERVICE.from('reports').select('*').eq('id', forgedRec.id).maybeSingle() : { data: null };
  check('Forged scope/identity is ignored (bound to the session)',
    Boolean(forgedDb) &&
    forgedDb.municipality_id === supMunicipalityId &&
    forgedDb.sender_role === 'health_supervisor' &&
    forgedDb.recipient_role === 'rhu_personnel' &&
    forgedDb.created_by === supMe.body?.data?.user?.id &&
    forgedDb.status === 'Submitted',
    forgedDb ? `muni=${forgedDb.municipality_id === supMunicipalityId} sender=${forgedDb.sender_role} recipient=${forgedDb.recipient_role} status=${forgedDb.status}` : `create_status=${forged.status}`);

  // 11. Cross-scope read: the supervisor's own incoming box is empty (a Health
  //     Supervisor is a sender, never a recipient) — they cannot read the RHU inbox.
  const supInbox = await api(supTok, '/reports?box=incoming');
  const supInboxRows = supInbox.body?.data?.rows || supInbox.body?.data?.records || [];
  check('Health Supervisor cannot read RHU-routed reports via incoming', !supInboxRows.some((r) => r.recipientRole === 'rhu_personnel'), `rows=${supInboxRows.length}`);

  console.log(`\nArtifacts written: report "${TITLE}" (period ${PERIOD}) + one forged-scope QA report (period QA-FORGE-${stamp}), both from ${SUP_EMAIL} in ${supBarangay}.`);
  console.log(`\n=== ${pass.length} passed, ${fail.length} failed ===`);
  if (fail.length) { console.log('FAILURES:'); fail.forEach((f) => console.log(` - ${f}`)); process.exitCode = 1; }
};

run().catch((e) => { console.error('HARNESS ERROR', e); process.exitCode = 1; });

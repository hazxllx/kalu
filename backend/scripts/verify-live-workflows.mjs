/**
 * Live workflow verification against the real Supabase project + running API.
 *
 * Signs in as every operational role and checks the behaviour the KALUSAGAP
 * brief requires, end to end — through Express authorization, the services and
 * the database RLS, not through the UI:
 *
 *   - health personnel registration -> pending account -> 403 until approved
 *   - approval authority: PHN approves Health Supervisor / RHU Personnel,
 *     Health Supervisor approves BHW / Resident, System Admin and MHO have none
 *   - a rejected account stays locked
 *   - referral resident embeds and the RHU Personnel read boundary
 *   - follow-up schedule state, status persistence and resident embeds
 *   - medical certificate prepare / submit / approve / illegal transition
 *   - real audit-trail events and real system-log request rows
 *   - the M1 annual sex breakdown
 *
 * RUN IT WITH THE API ALREADY LISTENING:
 *     node src/server.js                      # terminal 1
 *     node scripts/verify-live-workflows.mjs   # terminal 2
 *
 * It is NOT read-only: it creates a QA personnel account per run, one referral,
 * one medical certificate and the corresponding log rows, using the
 * `*.qa.<timestamp>@kalusagap.test` email pattern so every artifact is
 * identifiable. Override the accounts it uses with the OFFICIAL_* env vars when
 * a run should target specific accounts.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const API = process.env.API_URL || 'http://localhost:5000/api';
const ANON = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const SERVICE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const pass = [];
const fail = [];
const check = (name, ok, extra = '') => {
  (ok ? pass : fail).push(`${name}${extra ? ` — ${extra}` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

async function signIn(email, password) {
  const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
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

// BUG-026: live-account credentials come from the environment, never source.
const reqEnv = (name) => {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name} in the environment — required to run live verification.`); process.exit(1); }
  return v;
};
const CRED = {
  admin: ['admin@kalusagap.test', reqEnv('KALUSAGAP_ADMIN_PASSWORD'), 'admin'],
  mho: ['mho@kalusagap.test', reqEnv('KALUSAGAP_MHO_PASSWORD'), 'mho'],
  rhu: ['rhu.personnel@kalusagap.test', reqEnv('KALUSAGAP_RHU_PASSWORD'), 'rhu_personnel'],
  phn: ['phn@kalusagap.test', reqEnv('KALUSAGAP_PHN_PASSWORD'), 'phn'],
  supervisor: ['supervisor@kalusagap.test', reqEnv('KALUSAGAP_SUPERVISOR_PASSWORD'), 'health_supervisor'],
};

// Ephemeral password for the throwaway QA applicant accounts this script
// creates; sourced from the environment so no credential is committed.
const QA_APPLICANT_PASSWORD = reqEnv('KALUSAGAP_QA_APPLICANT_PASSWORD');

const run = async () => {
  const T = {};
  const ROLE = {};
  for (const [k, [e, p, r]] of Object.entries(CRED)) { T[k] = await signIn(e, p); ROLE[k] = r; }

  const { data: brgyList } = await SERVICE.from('barangays').select('id,name').eq('name', 'San Isidro').single();
  const brgyId = brgyList.id;
  const { data: facList } = await SERVICE.from('facilities').select('id,name').limit(1);
  const facilityId = facList?.[0]?.id;

  // ---------------------------------------------------------------- 1. sessions
  for (const [k, tok] of Object.entries(T)) {
    const me = await api(tok, '/auth/me');
    check(`sign-in + /auth/me as ${k}`, me.status === 200 && me.body?.data?.user?.role === ROLE[k], `role=${me.body?.data?.user?.role}`);
  }

  // ------------------------------------------------- 2. personnel registration
  const email = `bhw.qa.${Date.now()}@kalusagap.test`;
  const password = QA_APPLICANT_PASSWORD;
  const reg = await api(null, '/staff-accounts/register', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'QA Barangay Health Worker', email, password, phone: '09171234567',
      role: 'bhw', position: 'Barangay Health Worker', barangayId: brgyId,
    }),
  });
  check('personnel registration creates a pending request', reg.status === 201 && reg.body?.data?.request?.status === 'pending', JSON.stringify(reg.body?.error || reg.body?.data?.request?.status));

  // phn has no operational approver, so it must not be requestable here at all —
  // otherwise a request is created that nobody can ever action. It is
  // provisioned administratively instead. Only one role is probed live because
  // /staff-accounts/register is rate-limited to 10 requests per hour; the full
  // matrix is covered by test/staffApprovalAuthority.test.js.
  const unapprovable = await api(null, '/staff-accounts/register', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'QA Unapprovable PHN', email: `qa.unapprovable.${Date.now()}@kalusagap.test`,
      password: QA_APPLICANT_PASSWORD, phone: '09171234567', role: 'phn',
    }),
  });
  check('registration rejects PHN (no operational approver)', unapprovable.status === 400, `status=${unapprovable.status}`);

  const requestId = reg.body?.data?.request?.id;

  // The new BHW can sign in with Supabase, but must be refused by the API.
  const bhwToken = await signIn(email, password);
  const pendingMe = await api(bhwToken, '/auth/me');
  check('PENDING BHW is refused by /auth/me (403)', pendingMe.status === 403, `status=${pendingMe.status} msg=${pendingMe.body?.message || pendingMe.body?.error?.message || ''}`);
  const pendingHouseholds = await api(bhwToken, '/households');
  check('PENDING BHW cannot reach a protected BHW endpoint', pendingHouseholds.status === 403, `status=${pendingHouseholds.status}`);

  // ---------------------------------------------- 3. approval authority matrix
  const phnQueue = await api(T.phn, '/staff-accounts/queue?status=pending');
  check('PHN queue loads', phnQueue.status === 200, `rows=${phnQueue.body?.data?.rows?.length}`);
  check('PHN queue only shows HS/RHU roles', (phnQueue.body?.data?.rows || []).every((r) => ['health_supervisor', 'rhu_personnel'].includes(r.role)));
  check('PHN queue contains the BHW request (not their responsibility)', !(phnQueue.body?.data?.rows || []).some((r) => r.id === requestId));

  const adminQueue = await api(T.admin, '/staff-accounts/queue?status=pending');
  check('System Admin cannot open the operational approval queue (403)', adminQueue.status === 403, `status=${adminQueue.status}`);

  const mhoQueue = await api(T.mho, '/staff-accounts/queue?status=pending');
  check('MHO cannot open the operational approval queue (403)', mhoQueue.status === 403, `status=${mhoQueue.status}`);

  const hsQueue = await api(T.supervisor, '/staff-accounts/queue?status=pending');
  check('Health Supervisor queue loads', hsQueue.status === 200, `rows=${hsQueue.body?.data?.rows?.length}`);
  check('Health Supervisor queue contains the BHW request', (hsQueue.body?.data?.rows || []).some((r) => r.id === requestId));

  const phnApproveBhw = await api(T.phn, `/staff-accounts/${requestId}/approve`, { method: 'POST', body: JSON.stringify({}) });
  check('PHN cannot approve a BHW (404, out of authority)', phnApproveBhw.status === 404, `status=${phnApproveBhw.status}`);

  const adminApprove = await api(T.admin, `/staff-accounts/${requestId}/approve`, { method: 'POST', body: JSON.stringify({}) });
  check('System Admin cannot approve a BHW (403)', adminApprove.status === 403, `status=${adminApprove.status}`);

  // ------------------------------------------- 4. Health Supervisor approves it
  const approved = await api(T.supervisor, `/staff-accounts/${requestId}/approve`, { method: 'POST', body: JSON.stringify({ remarks: 'QA approval' }) });
  check('Health Supervisor approves the BHW', approved.status === 200 && approved.body?.data?.request?.status === 'approved', JSON.stringify(approved.body?.error || ''));

  const afterToken = await signIn(email, password);
  const afterMe = await api(afterToken, '/auth/me');
  check('APPROVED BHW can authenticate and resolve role=bhw', afterMe.status === 200 && afterMe.body?.data?.user?.role === 'bhw', JSON.stringify(afterMe.body?.data?.user || afterMe.body));
  const bhk = await api(afterToken, '/households');
  check('APPROVED BHW reaches a protected BHW endpoint', bhk.status === 200, `status=${bhk.status}`);

  // ------------------------------------------- 5. reject flow (new applicant)
  const rejectEmail = `bhw.reject.${Date.now()}@kalusagap.test`;
  const rej = await api(null, '/staff-accounts/register', {
    method: 'POST',
    body: JSON.stringify({ fullName: 'QA Rejected BHW', email: rejectEmail, password: QA_APPLICANT_PASSWORD, role: 'bhw', barangayId: brgyId }),
  });
  const rejId = rej.body?.data?.request?.id;
  const rejected = await api(T.supervisor, `/staff-accounts/${rejId}/reject`, { method: 'POST', body: JSON.stringify({ reason: 'Incomplete barangay assignment' }) });
  check('Health Supervisor rejects a BHW with a reason', rejected.status === 200 && rejected.body?.data?.request?.status === 'rejected', JSON.stringify(rejected.body?.error || ''));
  check('Rejection reason is stored and returned', Boolean(rejected.body?.data?.request?.rejectionReason));
  const rejToken = await signIn(rejectEmail, QA_APPLICANT_PASSWORD);
  const rejMe = await api(rejToken, '/auth/me');
  check('REJECTED BHW cannot access the protected system (403)', rejMe.status === 403, `status=${rejMe.status}`);

  // ------------------------------------------- 6. resident multi-word search
  const one = await api(T.mho, '/residents?q=Juan');
  const two = await api(T.mho, '/residents?q=Juan%20Del');
  check('MHO resident search returns results for a single name', (one.body?.data?.rows || []).length > 0, `rows=${one.body?.data?.rows?.length}`);
  check('MHO resident search handles a multi-word name', (two.body?.data?.rows || []).length > 0, `rows=${two.body?.data?.rows?.length}`);

  // ------------------------------------------- 7. referrals
  const { data: resList } = await SERVICE.from('residents').select('id').eq('barangay_id', brgyId).limit(1);
  const refRes = resList?.[0];
  if (refRes) {
    const created = await api(T.supervisor, '/referrals', {
      method: 'POST',
      body: JSON.stringify({ residentId: refRes.id, reason: 'QA referral', destination_facility: 'RHU Pili', priority: 'High' }),
    });
    check('Health Supervisor creates a referral', created.status === 200 || created.status === 201, JSON.stringify(created.body?.error || ''));
    check('create response embeds the resident (name available immediately)', Boolean(created.body?.data?.record?.resident?.first_name), JSON.stringify(created.body?.data?.record?.resident || created.body?.error));

    const refId = created.body?.data?.record?.id;
    const statusChange = await api(T.supervisor, `/referrals/${refId}/status`, { method: 'PUT', body: JSON.stringify({ status: 'Accepted' }) });
    check('referral status change still embeds the resident', Boolean(statusChange.body?.data?.record?.resident?.first_name), JSON.stringify(statusChange.body?.data?.record?.resident || statusChange.body?.error));

    const phnRefs = await api(T.phn, '/referrals');
    const phnHasResident = (phnRefs.body?.data?.rows || []).every((r) => r.resident && r.resident.first_name);
    check('PHN referral list rows all carry a resident', phnRefs.status === 200 && phnHasResident, `status=${phnRefs.status} rows=${phnRefs.body?.data?.rows?.length}`);

    const rhuRefs = await api(T.rhu, '/referrals');
    check('RHU Personnel cannot read referrals (403)', rhuRefs.status === 403, `status=${rhuRefs.status}`);
  } else {
    check('referral fixture resident available', false, 'no San Isidro resident');
  }

  // ------------------------------------------- 8. follow-ups
  const fu = await api(T.phn, '/operational/followups');
  check('PHN follow-up list loads', fu.status === 200, `rows=${fu.body?.data?.rows?.length}`);
  check('follow-up rows expose the derived schedule state', (fu.body?.data?.rows || []).every((r) => 'is_overdue' in r && 'is_due_today' in r));
  if (fu.body?.data?.rows?.length) {
    const row = fu.body.data.rows[0];
    const up = await api(T.phn, `/operational/followups/${row.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Ongoing' }) });
    check('PHN can persist a follow-up status change', up.status === 200 && ['Ongoing', 'Scheduled'].includes(up.body?.data?.record?.status), JSON.stringify(up.body?.error || up.body?.data?.record?.status));
    check('follow-up write response still embeds the resident', Boolean(up.body?.data?.record?.resident?.first_name), JSON.stringify(up.body?.data?.record?.resident || up.body?.error));
    const reread = await api(T.phn, '/operational/followups');
    const same = (reread.body?.data?.rows || []).find((r) => r.id === row.id);
    check('follow-up status change persisted to Supabase', same?.status === up.body?.data?.record?.status, `db=${same?.status}`);
  }

  // ------------------------------------------- 9. medical certificates
  const certRes = (await SERVICE.from('residents').select('id').eq('barangay_id', brgyId).limit(1)).data?.[0];
  const rhuCreate = await api(T.rhu, '/medical-certificates', {
    method: 'POST',
    body: JSON.stringify({ residentId: certRes.id, purpose: 'General Medical Certificate', findings: 'QA findings', dateOfExamination: '2026-09-27', medicalOfficer: 'QA Officer', licenseNumber: 'QA-1' }),
  });
  check('RHU Personnel prepares a medical certificate (Draft)', rhuCreate.status === 201 && rhuCreate.body?.data?.record?.status === 'Draft', JSON.stringify(rhuCreate.body?.error || rhuCreate.body?.data?.record?.status));
  const certId = rhuCreate.body?.data?.record?.id;

  const phnView = await api(T.phn, '/medical-certificates');
  check('PHN sees the certificate in the register', (phnView.body?.data?.rows || []).some((c) => c.id === certId), `rows=${phnView.body?.data?.rows?.length}`);
  const mhoView = await api(T.mho, '/medical-certificates');
  check('MHO sees the certificate in the register', (mhoView.body?.data?.rows || []).some((c) => c.id === certId), `rows=${mhoView.body?.data?.rows?.length}`);

  const rhuApprove = await api(T.rhu, `/medical-certificates/${certId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Approved' }) });
  check('RHU Personnel cannot approve a certificate (403)', rhuApprove.status === 403, `status=${rhuApprove.status}`);

  const phnSubmit = await api(T.phn, `/medical-certificates/${certId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'For Review' }) });
  check('PHN submits the draft for review', phnSubmit.status === 200 && phnSubmit.body?.data?.record?.status === 'For Review', JSON.stringify(phnSubmit.body?.error || ''));
  const mhoApprove = await api(T.mho, `/medical-certificates/${certId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Approved', notes: 'QA review' }) });
  check('MHO approves the certificate', mhoApprove.status === 200 && mhoApprove.body?.data?.record?.status === 'Approved', JSON.stringify(mhoApprove.body?.error || ''));
  const jump = await api(T.mho, `/medical-certificates/${certId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Draft' }) });
  check('illegal certificate transition is refused (409)', jump.status === 409, `status=${jump.status}`);
  const detail = await api(T.phn, `/medical-certificates/${certId}`);
  check('certificate audit history is returned', (detail.body?.data?.record?.audit || []).length >= 3, `entries=${detail.body?.data?.record?.audit?.length}`);

  // ------------------------------------------- 10. audit + system log
  const audit = await api(T.admin, '/audit-trail?limit=50');
  check('Audit Trail returns real events', audit.status === 200 && (audit.body?.data?.rows || []).length > 0, `rows=${audit.body?.data?.rows?.length}`);
  const actions = new Set((audit.body?.data?.rows || []).map((r) => r.action));
  check('Audit Trail contains the staff account approval', actions.has('APPROVED_STAFF_ACCOUNT') || actions.has('ACCOUNT_APPROVED'), [...actions].slice(0, 12).join(','));
  check('Audit Trail contains the certificate decision', [...actions].some((a) => String(a).startsWith('MEDICAL_CERTIFICATE')), [...actions].filter((a) => String(a).startsWith('MEDICAL')).join(','));
  const auditFiltered = await api(T.admin, '/audit-trail?q=MEDICAL_CERTIFICATE&limit=10');
  check('Audit Trail search/filter works', (auditFiltered.body?.data?.rows || []).length > 0, `rows=${auditFiltered.body?.data?.rows?.length}`);

  const logs = await api(T.admin, '/system-logs?limit=50');
  check('System Log returns real request events', logs.status === 200 && (logs.body?.data?.rows || []).length > 0, `rows=${logs.body?.data?.rows?.length}`);
  const logsForPhn = await api(T.phn, '/system-logs');
  check('System Log is administrator-only (403 for PHN)', logsForPhn.status === 403, `status=${logsForPhn.status}`);

  // ------------------------------------------- 11. MHO annual sex breakdown
  const annual = await api(T.mho, '/m1/annual?year=2026');
  const withSex = (annual.body?.data?.indicators || []).filter((i) => i.sexBreakdown && i.bySex);
  check('M1 annual report exposes a sex breakdown', withSex.length > 0, `indicators=${withSex.length}`);
  const b1 = withSex.find((i) => i.code === 'B1_1');
  if (b1) {
    const sum = b1.bySex.Male + b1.bySex.Female + b1.bySex.Other + b1.bySex.Unknown;
    check('sex breakdown sums to the reported total', sum === b1.annual, `bySex=${JSON.stringify(b1.bySex)} annual=${b1.annual}`);
  }

  console.log(`\n=== ${pass.length} passed, ${fail.length} failed ===`);
  if (fail.length) { console.log('FAILURES:'); fail.forEach((f) => console.log(` - ${f}`)); process.exitCode = 1; }
};

run().catch((e) => { console.error('HARNESS ERROR', e); process.exitCode = 1; });

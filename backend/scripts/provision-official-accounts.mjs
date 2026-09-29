/**
 * KALUSAGAP — official/QA account provisioning + credential check.
 *
 * Reads backend/.env for SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (and the
 * anon key for password verification). For each account in ACCOUNTS it:
 *   1. checks whether the Supabase Auth user exists,
 *   2. verifies the intended password via a real anon sign-in,
 *   3. (only with --apply) creates the auth user when missing, resets an
 *      invalid password, confirms the email, and fixes the profile row's
 *      role / status / municipality / barangay so the account can log in.
 *
 * Safe by default: without --apply it changes NOTHING and only prints a report.
 * Service-role writes bypass RLS and the profile self-edit guard trigger.
 *
 * Usage:
 *   node backend/scripts/provision-official-accounts.mjs            # check only
 *   node backend/scripts/provision-official-accounts.mjs --apply    # create/fix
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load backend/.env regardless of the current working directory.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const APPLY = process.argv.includes('--apply');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}
if (!ANON_KEY) {
  console.error('Missing SUPABASE_ANON_KEY in backend/.env (needed to verify passwords)');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Municipality / barangay used for scoped roles.
const MUNICIPALITY = { name: 'Pili', province: 'Camarines Sur' };
const DEFAULT_SUPERVISOR_BARANGAY = 'San Isidro';

// role: exact public.app_role value. status: 'active' required for staff login.
// scope: 'municipality' -> set municipality_id (barangay must stay null);
//        'barangay'     -> set municipality_id + barangay_id;
//        'none'         -> admin/resident (no scope needed).
//
// BUG-026: account passwords are NEVER hardcoded. Each comes from its own
// environment variable so no credential is committed to source. A missing
// variable is a clear configuration error (see requirePassword()).
const requirePassword = (envName) => {
  const value = process.env[envName];
  if (!value) {
    console.error(`Missing ${envName} in backend/.env — set every official-account password before provisioning.`);
    process.exit(1);
  }
  return value;
};

const ACCOUNTS = [
  { email: 'admin@kalusagap.test',          password: requirePassword('KALUSAGAP_ADMIN_PASSWORD'),      role: 'admin',             status: 'active', scope: 'none',         fullName: 'System Administrator' },
  { email: 'mho@kalusagap.test',            password: requirePassword('KALUSAGAP_MHO_PASSWORD'),        role: 'mho',               status: 'active', scope: 'municipality', fullName: 'Municipal Health Officer' },
  { email: 'rhu.personnel@kalusagap.test',  password: requirePassword('KALUSAGAP_RHU_PASSWORD'),        role: 'rhu_personnel',     status: 'active', scope: 'municipality', fullName: 'RHU Personnel' },
  { email: 'phn@kalusagap.test',            password: requirePassword('KALUSAGAP_PHN_PASSWORD'),        role: 'phn',               status: 'active', scope: 'municipality', fullName: 'Public Health Nurse' },
  { email: 'supervisor@kalusagap.test',     password: requirePassword('KALUSAGAP_SUPERVISOR_PASSWORD'), role: 'health_supervisor', status: 'active', scope: 'barangay',     fullName: 'Health Supervisor', barangay: DEFAULT_SUPERVISOR_BARANGAY },
  { email: 'mollie.greenholt@forms.lat',    password: requirePassword('KALUSAGAP_RESIDENT_PASSWORD'),   role: 'resident',          status: 'active', scope: 'none',         fullName: 'Mollie Greenholt' },
];

const mask = (pw) => (pw ? `${pw.slice(0, 2)}***${pw.slice(-2)} (len ${pw.length})` : '(empty)');

async function listAllAuthUsers() {
  const byEmail = new Map();
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    for (const u of data.users) if (u.email) byEmail.set(u.email.toLowerCase(), u);
    if (data.users.length < 1000) break;
    page += 1;
  }
  return byEmail;
}

async function verifyPassword(email, password) {
  // Brand-new anon client per attempt; discarded immediately.
  const c = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, reason: error.message };
  await c.auth.signOut().catch(() => {});
  return { ok: Boolean(data?.session), reason: null };
}

async function resolveScopeIds() {
  const { data: muni, error: mErr } = await admin
    .from('municipalities').select('id')
    .eq('name', MUNICIPALITY.name).eq('province', MUNICIPALITY.province).single();
  if (mErr) throw new Error(`municipality lookup failed: ${mErr.message}`);

  const { data: brgys, error: bErr } = await admin
    .from('barangays').select('id,name').eq('municipality_id', muni.id);
  if (bErr) throw new Error(`barangay lookup failed: ${bErr.message}`);

  const barangayByName = new Map(brgys.map((b) => [b.name, b.id]));
  return { municipalityId: muni.id, barangayByName };
}

async function getProfile(id) {
  const { data, error } = await admin
    .from('profiles')
    .select('id,email,full_name,role,status,municipality_id,barangay_id')
    .eq('id', id).maybeSingle();
  if (error) throw new Error(`profile lookup failed: ${error.message}`);
  return data;
}

function buildProfilePatch(acct, profile, scope) {
  const patch = {};
  if (profile.role !== acct.role) patch.role = acct.role;
  // Status: for staff, enforce 'active' (required to log in). For residents,
  // preserve their verification status (pending_verification still logs in as
  // resident-limited); only re-enable a disabled resident.
  if (acct.role === 'resident') {
    if (profile.status === 'disabled') patch.status = 'active';
  } else if (profile.status !== acct.status) {
    patch.status = acct.status;
  }
  if (!profile.full_name) patch.full_name = acct.fullName;

  if (acct.scope === 'municipality') {
    if (!profile.municipality_id) patch.municipality_id = scope.municipalityId;
    if (profile.barangay_id) patch.barangay_id = null; // non-scoped role must not carry a barangay
  } else if (acct.scope === 'barangay') {
    if (!profile.municipality_id) patch.municipality_id = scope.municipalityId;
    if (!profile.barangay_id) {
      const bId = scope.barangayByName.get(acct.barangay);
      if (!bId) throw new Error(`barangay '${acct.barangay}' not found in seed data`);
      patch.barangay_id = bId;
    }
  } else if (acct.scope === 'none' && acct.role !== 'resident') {
    // admin: barangay must be null; municipality optional (admin sees all).
    if (profile.barangay_id) patch.barangay_id = null;
  }
  return patch;
}

async function main() {
  console.log(`\nKALUSAGAP account provisioning — mode: ${APPLY ? 'APPLY (writes enabled)' : 'CHECK ONLY (no writes)'}`);
  console.log(`Supabase project: ${SUPABASE_URL}\n`);

  const scope = await resolveScopeIds();
  const authUsers = await listAllAuthUsers();

  const summary = [];

  for (const acct of ACCOUNTS) {
    const line = { email: acct.email, role: acct.role, actions: [] };
    let user = authUsers.get(acct.email.toLowerCase());

    // 1) Ensure auth user exists.
    if (!user) {
      line.exists = false;
      if (APPLY) {
        const { data, error } = await admin.auth.admin.createUser({
          email: acct.email,
          password: acct.password,
          email_confirm: true,
          user_metadata: { full_name: acct.fullName },
        });
        if (error) throw new Error(`createUser(${acct.email}) failed: ${error.message}`);
        user = data.user;
        line.actions.push('CREATED auth user (email confirmed)');
      } else {
        line.actions.push('WOULD CREATE auth user');
      }
    } else {
      line.exists = true;
      // Confirm email if needed so password sign-in can succeed.
      if (!user.email_confirmed_at && !user.confirmed_at) {
        if (APPLY) {
          await admin.auth.admin.updateUserById(user.id, { email_confirm: true });
          line.actions.push('CONFIRMED email');
        } else {
          line.actions.push('WOULD CONFIRM email');
        }
      }
    }

    // 2) Verify / fix password (only meaningful once the user exists).
    if (user) {
      const check = await verifyPassword(acct.email, acct.password);
      line.passwordValid = check.ok;
      if (!check.ok) {
        line.passwordReason = check.reason;
        if (APPLY) {
          const { error } = await admin.auth.admin.updateUserById(user.id, {
            password: acct.password,
            email_confirm: true,
          });
          if (error) throw new Error(`password reset(${acct.email}) failed: ${error.message}`);
          line.actions.push(`RESET password -> ${mask(acct.password)}`);
        } else {
          line.actions.push(`WOULD RESET password -> ${mask(acct.password)}`);
        }
      }
    }

    // 3) Ensure profile role/status/scope (only when we have a user id).
    if (user) {
      let profile = await getProfile(user.id);
      if (!profile) {
        // Trigger normally creates it; insert defensively if absent.
        if (APPLY) {
          const insert = {
            id: user.id, email: acct.email, full_name: acct.fullName,
            role: acct.role, status: acct.status,
          };
          if (acct.scope === 'municipality') insert.municipality_id = scope.municipalityId;
          if (acct.scope === 'barangay') {
            insert.municipality_id = scope.municipalityId;
            insert.barangay_id = scope.barangayByName.get(acct.barangay);
          }
          const { error } = await admin.from('profiles').insert(insert);
          if (error) throw new Error(`profile insert(${acct.email}) failed: ${error.message}`);
          line.actions.push(`CREATED profile (role=${acct.role}, status=${acct.status})`);
          profile = await getProfile(user.id);
        } else {
          line.actions.push(`WOULD CREATE profile (role=${acct.role}, status=${acct.status})`);
        }
      }

      if (profile) {
        line.profile = {
          role: profile.role, status: profile.status,
          municipality_id: profile.municipality_id, barangay_id: profile.barangay_id,
        };
        const patch = buildProfilePatch(acct, profile, scope);
        if (Object.keys(patch).length > 0) {
          if (APPLY) {
            const { error } = await admin.from('profiles').update(patch).eq('id', user.id);
            if (error) throw new Error(`profile update(${acct.email}) failed: ${error.message}`);
            line.actions.push(`FIXED profile ${JSON.stringify(patch)}`);
          } else {
            line.actions.push(`WOULD FIX profile ${JSON.stringify(patch)}`);
          }
        }
      }
    }

    if (line.actions.length === 0) line.actions.push('OK — no change needed');
    summary.push(line);
  }

  console.log('================ RESULT ================');
  for (const l of summary) {
    console.log(`\n${l.email}  [${l.role}]`);
    console.log(`  auth user exists : ${l.exists}`);
    if (l.passwordValid !== undefined) {
      console.log(`  password valid   : ${l.passwordValid}${l.passwordReason ? `  (${l.passwordReason})` : ''}`);
    }
    if (l.profile) {
      console.log(`  profile          : role=${l.profile.role}, status=${l.profile.status}, muni=${l.profile.municipality_id ? 'set' : 'null'}, brgy=${l.profile.barangay_id ? 'set' : 'null'}`);
    }
    for (const a of l.actions) console.log(`  - ${a}`);
  }
  console.log('\n========================================');
  if (!APPLY) console.log('CHECK ONLY: no changes were made. Re-run with --apply to create/fix.');
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});

/**
 * KALUSAGAP — official/QA account provisioning + credential check.
 *
 * Reads local SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY settings (and the
 * anon key for password verification). For each account in ACCOUNTS it:
 *   1. checks whether the Supabase Auth user exists,
 *   2. verifies the intended password via a real anon sign-in,
 *   3. (only with --apply) creates the auth user when missing, resets an
 *      invalid password, confirms the email, and provisions the profile.
 *      Existing personnel retain their Auth credentials, status and assignment;
 *      only missing lifecycle sidecars are reconciled.
 *
 * Safe by default: without --apply it changes NOTHING and only prints a report.
 * Service-role writes bypass RLS and the profile self-edit guard trigger.
 *
 * Usage:
 *   node backend/scripts/provision-official-accounts.mjs            # check only
 *   node backend/scripts/provision-official-accounts.mjs --apply    # create/fix
 */
import '../src/config/env.js';
import { createClient } from '@supabase/supabase-js';
import { assertLocalScriptEnvironment, localFetch } from './local-safety.mjs';
import { assertOfficialPersonnelIdentity, buildProfilePatch, isPersonnel, newRhuAssignment, reconcileOfficialPersonnel } from './official-personnel.mjs';

assertLocalScriptEnvironment();

const APPLY = process.argv.includes('--apply');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing local SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
if (!ANON_KEY) {
  console.error('Missing local SUPABASE_ANON_KEY (needed to verify passwords).');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: localFetch },
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
    console.error(`Missing ${envName}. Set every official-account password before provisioning.`);
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
    global: { fetch: localFetch },
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
  const { data: rhu, error: rErr } = await admin.from('facilities').select('id')
    .eq('municipality_id', muni.id).eq('name', 'RHU').eq('type', 'rhu').maybeSingle();
  if (rErr) throw new Error(`RHU facility lookup failed: ${rErr.message}`);
  return { municipalityId: muni.id, barangayByName, rhuFacilityId: rhu?.id };
}

async function getProfile(id) {
  const { data, error } = await admin
    .from('profiles')
    .select('id,email,full_name,role,status,municipality_id,barangay_id,facility_id,rhu_stations')
    .eq('id', id).maybeSingle();
  if (error) throw new Error(`profile lookup failed: ${error.message}`);
  return data;
}

async function main() {
  console.log(`\nKALUSAGAP account provisioning — mode: ${APPLY ? 'APPLY (writes enabled)' : 'CHECK ONLY (no writes)'}`);
  console.log(`Supabase origin: ${new URL(SUPABASE_URL).origin}\n`);

  const scope = await resolveScopeIds();
  const authUsers = await listAllAuthUsers();

  const summary = [];

  for (const acct of ACCOUNTS) {
    const line = { email: acct.email, role: acct.role, actions: [] };
    let user = authUsers.get(acct.email.toLowerCase());
    let preservePersonnel = false;
    if (user && isPersonnel(acct.role)) {
      await assertOfficialPersonnelIdentity(admin, user);
      preservePersonnel = isPersonnel((await getProfile(user.id))?.role);
    }

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
      if (!preservePersonnel && !user.email_confirmed_at && !user.confirmed_at) {
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
      if (!check.ok && preservePersonnel) {
        line.actions.push('PRESERVED existing personnel Auth credentials');
      } else if (!check.ok) {
        line.passwordReason = check.reason;
        if (APPLY) {
          const { error } = await admin.auth.admin.updateUserById(user.id, {
            password: acct.password,
            email_confirm: true,
          });
          if (error) throw new Error(`password reset(${acct.email}) failed: ${error.message}`);
          line.actions.push('RESET password');
        } else {
          line.actions.push('WOULD RESET password');
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
          if (acct.role === 'rhu_personnel') Object.assign(insert, newRhuAssignment(scope));
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
        if (isPersonnel(acct.role)) {
          line.actions.push(await reconcileOfficialPersonnel(admin, user.id, APPLY));
          if (preservePersonnel && profile.role === 'rhu_personnel' && (!profile.facility_id || !profile.rhu_stations?.length)) {
            line.actions.push('Existing RHU assignment is incomplete; assign facility/stations through admin account management');
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

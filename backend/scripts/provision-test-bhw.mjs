/**
 * KALUSAGAP — test BHW account provisioning (DEVELOPMENT / STAGING ONLY).
 *
 * Creates (or repairs) the single synthetic BHW account the offline integration
 * tests and the authenticated Playwright suite sign in as:
 *
 *   email:  test-bhw@kalusagap-dev.local   (override with KALUSAGAP_TEST_BHW_EMAIL)
 *   role:   bhw
 *   status: active
 *   scope:  municipality "Taguig Test" / barangay "Test Poblacion"
 *
 * SAFETY — read before running:
 *   - The production project ref is HARD-BLOCKED. The script refuses to run with
 *     a non-zero exit if the target URL contains the production ref.
 *   - Check-only by default. Only `--apply` performs writes.
 *   - Credentials come from the environment; the password is NEVER hardcoded and
 *     never printed. Configure with:
 *       SUPABASE_DEV_URL (or SUPABASE_URL)
 *       SUPABASE_DEV_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY)
 *       SUPABASE_DEV_ANON_KEY (or SUPABASE_ANON_KEY)
 *       KALUSAGAP_TEST_BHW_PASSWORD   (required to create/reset)
 *       KALUSAGAP_TEST_BHW_EMAIL      (optional; defaults below)
 *
 * Usage:
 *   node backend/scripts/provision-test-bhw.mjs            # check only
 *   node backend/scripts/provision-test-bhw.mjs --apply     # create / fix
 *
 * Prerequisites: supabase/seed-dev.sql must have been applied to the dev project
 * (it creates the Taguig Test municipality and Test Poblacion barangay). Run the
 * seed FIRST — the profile insert below fails if the scope rows are missing.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load backend/.env (if present) but do NOT rely on it: dev runs supply the
// values through the environment so production .env never has to change.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

/** The production project ref. Never allow a write against it. */
const PRODUCTION_REF = 'lblawqeoixojyytkmfqy';

const APPLY = process.argv.includes('--apply');

const SUPABASE_URL =
  process.env.SUPABASE_DEV_URL || process.env.TEST_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SERVICE_KEY =
  process.env.SUPABASE_DEV_SERVICE_ROLE_KEY ||
  process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';
const ANON_KEY =
  process.env.SUPABASE_DEV_ANON_KEY ||
  process.env.TEST_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

const TEST_EMAIL = process.env.KALUSAGAP_TEST_BHW_EMAIL || 'test-bhw@kalusagap-dev.local';
const TEST_PASSWORD = process.env.KALUSAGAP_TEST_BHW_PASSWORD || '';

const MUNICIPALITY = { name: 'Taguig Test', province: 'NCR' };
const BARANGAY_NAME = 'Test Poblacion';

// --- guards -----------------------------------------------------------------

if (!SUPABASE_URL) {
  console.error('Missing SUPABASE_DEV_URL (or SUPABASE_URL). Nothing to do.');
  process.exit(1);
}

if (SUPABASE_URL.includes(PRODUCTION_REF)) {
  console.error(
    `REFUSING TO RUN: target URL contains the PRODUCTION project ref (${PRODUCTION_REF}).\n` +
      'Point SUPABASE_DEV_URL at a dedicated development project. Production is read-only.',
  );
  process.exit(1);
}

if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_DEV_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY).');
  process.exit(1);
}

if (APPLY && !TEST_PASSWORD) {
  console.error(
    'Missing KALUSAGAP_TEST_BHW_PASSWORD. Set a strong test password before --apply so the account can sign in.',
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const mask = (pw) => (pw ? `${pw.slice(0, 2)}***${pw.slice(-2)} (len ${pw.length})` : '(empty)');

async function findAuthUserByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const found = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 1000) return null;
    page += 1;
  }
}

async function verifyPassword(email, password) {
  if (!ANON_KEY) return { ok: null, reason: 'anon key not provided — cannot verify password' };
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, reason: error.message };
  await client.auth.signOut().catch(() => {});
  return { ok: Boolean(data?.session), reason: null };
}

async function resolveScope() {
  const { data: muni, error: mErr } = await admin
    .from('municipalities')
    .select('id')
    .eq('name', MUNICIPALITY.name)
    .eq('province', MUNICIPALITY.province)
    .maybeSingle();
  if (mErr) throw new Error(`municipality lookup failed: ${mErr.message}`);
  if (!muni) {
    throw new Error(
      `Municipality "${MUNICIPALITY.name}" not found. Apply supabase/seed-dev.sql to the dev project first.`,
    );
  }

  const { data: brgy, error: bErr } = await admin
    .from('barangays')
    .select('id')
    .eq('municipality_id', muni.id)
    .eq('name', BARANGAY_NAME)
    .maybeSingle();
  if (bErr) throw new Error(`barangay lookup failed: ${bErr.message}`);
  if (!brgy) {
    throw new Error(
      `Barangay "${BARANGAY_NAME}" not found. Apply supabase/seed-dev.sql to the dev project first.`,
    );
  }

  return { municipalityId: muni.id, barangayId: brgy.id };
}

async function getProfile(id) {
  const { data, error } = await admin
    .from('profiles')
    .select('id,email,full_name,role,status,municipality_id,barangay_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`profile lookup failed: ${error.message}`);
  return data;
}

async function main() {
  console.log(`\nKALUSAGAP test-BHW provisioning — mode: ${APPLY ? 'APPLY (writes enabled)' : 'CHECK ONLY (no writes)'}`);
  console.log(`Target: ${SUPABASE_URL}`);
  console.log(`Email:  ${TEST_EMAIL}\n`);

  const scope = await resolveScope();
  const actions = [];

  let user = await findAuthUserByEmail(TEST_EMAIL);

  // 1) Ensure the auth user exists and its email is confirmed.
  if (!user) {
    if (APPLY) {
      const { data, error } = await admin.auth.admin.createUser({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Test BHW' },
      });
      if (error) throw new Error(`createUser failed: ${error.message}`);
      user = data.user;
      actions.push('CREATED auth user (email confirmed)');
    } else {
      actions.push('WOULD CREATE auth user');
    }
  } else if (!user.email_confirmed_at && !user.confirmed_at) {
    if (APPLY) {
      await admin.auth.admin.updateUserById(user.id, { email_confirm: true });
      actions.push('CONFIRMED email');
    } else {
      actions.push('WOULD CONFIRM email');
    }
  }

  // 2) Verify / repair the password (only meaningful once the user exists).
  if (user && TEST_PASSWORD && ANON_KEY) {
    const check = await verifyPassword(TEST_EMAIL, TEST_PASSWORD);
    if (check.ok === false) {
      if (APPLY) {
        const { error } = await admin.auth.admin.updateUserById(user.id, {
          password: TEST_PASSWORD,
          email_confirm: true,
        });
        if (error) throw new Error(`password reset failed: ${error.message}`);
        actions.push(`RESET password -> ${mask(TEST_PASSWORD)}`);
      } else {
        actions.push(`WOULD RESET password -> ${mask(TEST_PASSWORD)}`);
      }
    } else if (check.ok) {
      actions.push('password valid');
    }
  }

  // 3) Ensure the profile row has the BHW role, active status and dev scope.
  if (user) {
    let profile = await getProfile(user.id);
    const desired = {
      role: 'bhw',
      status: 'active',
      municipality_id: scope.municipalityId,
      barangay_id: scope.barangayId,
    };

    if (!profile) {
      if (APPLY) {
        const insert = { id: user.id, email: TEST_EMAIL, full_name: 'Test BHW', ...desired };
        const { error } = await admin.from('profiles').insert(insert);
        if (error) throw new Error(`profile insert failed: ${error.message}`);
        actions.push(`CREATED profile (role=bhw, status=active)`);
        profile = await getProfile(user.id);
      } else {
        actions.push('WOULD CREATE profile (role=bhw, status=active)');
      }
    } else {
      const patch = {};
      for (const [key, value] of Object.entries(desired)) {
        if (profile[key] !== value) patch[key] = value;
      }
      if (Object.keys(patch).length) {
        if (APPLY) {
          const { error } = await admin.from('profiles').update(patch).eq('id', user.id);
          if (error) throw new Error(`profile update failed: ${error.message}`);
          actions.push(`FIXED profile ${JSON.stringify(patch)}`);
        } else {
          actions.push(`WOULD FIX profile ${JSON.stringify(patch)}`);
        }
      }
    }

    if (profile) {
      console.log(
        `Profile: role=${profile.role} status=${profile.status} ` +
          `muni=${profile.municipality_id ? 'set' : 'null'} brgy=${profile.barangay_id ? 'set' : 'null'}`,
      );
    }
  }

  console.log('\nResult:');
  if (actions.length === 0) actions.push('OK — no change needed');
  for (const a of actions) console.log(`  - ${a}`);

  if (!APPLY) console.log('\nCHECK ONLY: no changes were made. Re-run with --apply to create/fix.');
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});

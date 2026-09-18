/**
 * KALUSAGAP — live login-flow verification.
 *
 * Reproduces EXACTLY what the browser does on the login page:
 *   1. sign in through Supabase Auth with the PUBLIC anon key (browser path),
 *   2. read the resulting access token,
 *   3. resolve the application profile through the backend `GET /api/auth/me`
 *      (this is the call that fails with "Your account has no profile").
 *
 * Reports the profile id vs the auth user id so a broken link is visible.
 *
 *   node scripts/verify-login-flow.mjs
 *
 * Reads credentials from environment variables (never hard-coded):
 *   ACCOUNT_ADMIN_PASSWORD, ACCOUNT_PHN_PASSWORD, ACCOUNT_SUPERVISOR_PASSWORD
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const API_URL = process.env.API_URL || `http://localhost:${process.env.PORT || 5000}/api`;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY in backend/.env');
  process.exit(1);
}

const ACCOUNTS = [
  { label: 'Admin', email: 'admin@kalusagap.test', password: process.env.ACCOUNT_ADMIN_PASSWORD },
  { label: 'PHN', email: 'phn@kalusagap.test', password: process.env.ACCOUNT_PHN_PASSWORD },
  { label: 'Health Supervisor', email: 'supervisor@kalusagap.test', password: process.env.ACCOUNT_SUPERVISOR_PASSWORD },
];

const EXPECTED_ROLE = {
  'admin@kalusagap.test': 'admin',
  'phn@kalusagap.test': 'phn',
  'supervisor@kalusagap.test': 'health_supervisor',
};

// A fresh client per attempt with no session persistence — same shape as the
// browser client, minus the localStorage persistence.
const browserClient = () =>
  createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

const main = async () => {
  let failures = 0;

  for (const account of ACCOUNTS) {
    console.log('');
    console.log(`${account.label} — ${account.email}`);

    if (!account.password) {
      console.log('  FAIL  no password supplied (set the ACCOUNT_*_PASSWORD env var)');
      failures += 1;
      continue;
    }

    // --- 1. browser-style Supabase sign-in (anon key) ----------------------
    const supabase = browserClient();
    const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });

    if (signInError || !signIn?.session?.user) {
      console.log(`  FAIL  supabase signInWithPassword -> ${signInError?.message || 'no session'}`);
      failures += 1;
      continue;
    }

    const authUser = signIn.session.user;
    const token = signIn.session.access_token;
    console.log(`  OK    supabase signInWithPassword (auth user id ${authUser.id})`);
    console.log(`        app_metadata.role = ${authUser.app_metadata?.role ?? '(unset)'}`);

    // --- 2. backend profile resolution (the failing call) ------------------
    const response = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const message = payload?.error?.message || `HTTP ${response.status}`;
      console.log(`  FAIL  GET /api/auth/me -> ${response.status} ${message}`);
      failures += 1;
      continue;
    }

    const profile = payload?.data?.user;
    if (!profile) {
      console.log('  FAIL  GET /api/auth/me returned no user');
      failures += 1;
      continue;
    }

    const linkOk = profile.id === authUser.id;
    const roleOk = profile.role === EXPECTED_ROLE[account.email];
    const activeOk = profile.status === 'active';

    console.log(`        profile id      = ${profile.id} ${linkOk ? '(matches auth user)' : '(MISMATCH)'}`);
    console.log(`        role / status   = ${profile.role} / ${profile.status} ${roleOk ? '' : '(UNEXPECTED ROLE)'}`);
    console.log(`        coverage        = ${profile.barangay || profile.municipality || 'municipality-wide'}`);
    console.log(
      `  ${linkOk && roleOk && activeOk ? 'PASS' : 'FAIL'}  profile resolved through the backend for the browser path`,
    );
    if (!(linkOk && roleOk && activeOk)) failures += 1;

    await supabase.auth.signOut();
  }

  console.log('');
  console.log(failures === 0 ? 'ALL ACCOUNTS PASS (browser auth path)' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error('Verification failed:', err.message);
  process.exit(1);
});

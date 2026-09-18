/**
 * KALUSAGAP — official account provisioning (admin only).
 *
 * Creates (or updates) the three official role accounts through the Supabase
 * Admin API using the backend service-role key. The service-role key never
 * leaves the server: this script runs from `backend/`, never from the browser.
 *
 *   node scripts/provision-official-accounts.mjs            # create/repair, generate + print temporary passwords
 *   node scripts/provision-official-accounts.mjs --no-rotate # keep existing passwords, never print them
 *
 * SAFE TO RE-RUN: accounts are matched by email. An existing account is
 * updated in place (role metadata, profile role/status/coverage) and is NEVER
 * duplicated. Passwords are generated fresh, stored only by Supabase Auth
 * (never in the database or in source), and are marked temporary.
 *
 * What it guarantees per account:
 *   - a confirmed Supabase Auth user with the given email,
 *   - `app_metadata.role` set to the canonical role id,
 *   - a `profiles` row with the same role, status 'active' and the coverage
 *     assignment the role requires (barangay-scoped roles get a barangay).
 *
 * It does not touch any other account.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const API_URL = process.env.API_URL || `http://localhost:${process.env.PORT || 5000}/api`;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}

const rotatePasswords = !process.argv.includes('--no-rotate');

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** The official accounts this project provisions. */
const ACCOUNTS = [
  {
    role: 'admin',
    email: 'admin@kalusagap.test',
    fullName: 'System Administrator',
    position: 'System Administrator',
    barangay: null,
  },
  {
    role: 'phn',
    email: 'phn@kalusagap.test',
    fullName: 'Public Health Nurse',
    position: 'Public Health Nurse',
    // PHNs are RHU-based personnel and are never assigned a barangay.
    barangay: null,
  },
  {
    role: 'health_supervisor',
    email: 'supervisor@kalusagap.test',
    fullName: 'Barangay Health Supervisor',
    position: 'Barangay Health Supervisor',
    barangay: 'San Isidro',
  },
];

/* -------------------------------------------------------------------------- */
/* Temporary password generation                                              */
/* -------------------------------------------------------------------------- */

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*?';
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

const pick = (set) => set[crypto.randomInt(set.length)];

/** Unique, high-entropy temporary password (one of each character class). */
const generatePassword = (length = 18) => {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALL));
  // Fisher–Yates shuffle so the guaranteed characters are not positionally fixed.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Find an auth user by email (paginated; the admin API has no email filter). */
const findUserByEmail = async (email) => {
  const target = email.toLowerCase();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = (data?.users || []).find((u) => (u.email || '').toLowerCase() === target);
    if (match) return match;
    if ((data?.users || []).length < 200) return null;
  }
  return null;
};

/** The Pili deployment municipality (created by supabase/seed.sql). */
const loadMunicipality = async () => {
  const { data, error } = await admin
    .from('municipalities')
    .select('id, name, province')
    .eq('name', 'Pili')
    .eq('province', 'Camarines Sur')
    .maybeSingle();
  if (error) throw error;
  return data;
};

const loadBarangay = async (municipalityId, name) => {
  if (!name) return null;
  const { data, error } = await admin
    .from('barangays')
    .select('id, name')
    .eq('municipality_id', municipalityId)
    .eq('name', name)
    .maybeSingle();
  if (error) throw error;
  return data;
};

/** Keep the profiles row authoritative: role, status and coverage. */
const syncProfile = async ({ userId, email, fullName, role, position, municipalityId, barangayId }) => {
  const row = {
    id: userId,
    email,
    full_name: fullName,
    role,
    status: 'active',
    municipality_id: municipalityId,
    barangay_id: barangayId,
    position,
  };

  const { data: existing, error: readError } = await admin
    .from('profiles').select('id').eq('id', userId).maybeSingle();
  if (readError) throw readError;

  const { error } = existing
    ? await admin.from('profiles').update(row).eq('id', userId)
    : await admin.from('profiles').insert(row);
  if (error) throw error;
};

/** Prove the credentials work AND that the role resolves from the database. */
const verifyLogin = async (email, password) => {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.data?.session?.accessToken) {
    return { ok: false, reason: payload?.error?.message || `HTTP ${response.status}` };
  }

  // Confirm the authenticated profile (role/status/coverage) resolves server-side.
  const me = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${payload.data.session.accessToken}` },
  });
  const mePayload = await me.json().catch(() => null);

  return {
    ok: true,
    role: mePayload?.data?.user?.role || payload.data.user?.role || null,
    status: mePayload?.data?.user?.status ?? null,
    barangay: mePayload?.data?.user?.barangay ?? null,
  };
};

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

const main = async () => {
  if (!ANON_KEY) {
    console.warn('Note: SUPABASE_ANON_KEY not set — login verification still runs through the API.');
  }

  const municipality = await loadMunicipality();
  if (!municipality) {
    console.error('Municipality "Pili, Camarines Sur" not found. Apply supabase/seed.sql first.');
    process.exit(1);
  }

  const results = [];

  for (const account of ACCOUNTS) {
    const existing = await findUserByEmail(account.email);
    const password = rotatePasswords ? generatePassword() : null;

    let userId;
    let created = false;

    if (existing) {
      userId = existing.id;
      const patch = { email_confirm: true, app_metadata: { ...(existing.app_metadata || {}), role: account.role } };
      if (password) patch.password = password;
      const { error } = await admin.auth.admin.updateUserById(userId, patch);
      if (error) throw new Error(`${account.email}: ${error.message}`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: account.email,
        password,
        email_confirm: true,
        app_metadata: { role: account.role },
        user_metadata: { full_name: account.fullName },
      });
      if (error) throw new Error(`${account.email}: ${error.message}`);
      userId = data.user.id;
      created = true;
    }

    const barangay = await loadBarangay(municipality.id, account.barangay);
    if (account.barangay && !barangay) {
      throw new Error(`Barangay "${account.barangay}" not found for ${account.email}. Apply supabase/seed.sql first.`);
    }

    await syncProfile({
      userId,
      email: account.email,
      fullName: account.fullName,
      role: account.role,
      position: account.position,
      municipalityId: municipality.id,
      barangayId: barangay?.id || null,
    });

    let verification = { ok: false, reason: 'password not rotated' };
    if (password) {
      try {
        verification = await verifyLogin(account.email, password);
      } catch (err) {
        verification = { ok: false, reason: err.message };
      }
    }

    results.push({ account, userId, created, password, verification });
  }

  /* ------------------------------- report -------------------------------- */
  console.log('');
  console.log('KALUSAGAP — official accounts provisioned');
  console.log('=========================================');
  for (const { account, userId, created, password, verification } of results) {
    console.log('');
    console.log(`${account.role.toUpperCase()}  (${created ? 'created' : 'existing account updated'})`);
    console.log(`  email     : ${account.email}`);
    console.log(`  password  : ${password || '(unchanged — not displayed)'}`);
    console.log(`  user id   : ${userId}`);
    console.log(`  coverage  : ${account.barangay || 'municipality-wide'}`);
    console.log(
      `  verified  : ${
        verification.ok
          ? `login OK · role=${verification.role} · status=${verification.status}${verification.barangay ? ` · barangay=${verification.barangay}` : ''}`
          : `NOT verified — ${verification.reason}`
      }`,
    );
  }
  console.log('');
  console.log('Passwords are TEMPORARY (Supabase Auth only) — rotate them after first sign-in.');
  console.log('');

  const failed = results.filter((r) => !r.verification.ok && r.password);
  if (failed.length) process.exit(1);
};

main().catch((err) => {
  console.error('Provisioning failed:', err.message);
  process.exit(1);
});

/**
 * Reset ONE existing Supabase Auth user's password, in place.
 *
 * - Does NOT create users. Fails if the email is not found.
 * - Reads the new password from env var RESET_PASSWORD (never hardcoded here).
 * - Snapshots the profile before/after so we can prove role/scope/status and
 *   the auth user id are preserved.
 * - Verifies the new password with a real anon sign-in.
 * - Never prints the password.
 *
 * Usage:
 *   $env:RESET_PASSWORD='...'; node backend/scripts/reset-password.mjs <email>
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const email = (process.argv[2] || '').trim().toLowerCase();
const newPassword = process.env.RESET_PASSWORD || '';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!email) { console.error('Usage: node reset-password.mjs <email> (RESET_PASSWORD env required)'); process.exit(1); }
if (!newPassword) { console.error('RESET_PASSWORD env var is empty.'); process.exit(1); }
if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) { console.error('Missing Supabase env in backend/.env'); process.exit(1); }

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const findUser = async () => {
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 1000) return null;
    page += 1;
  }
};

const getProfile = async (id) => {
  const { data, error } = await admin
    .from('profiles')
    .select('id,email,full_name,role,status,municipality_id,barangay_id,facility_id')
    .eq('id', id).maybeSingle();
  if (error) throw new Error(`profile lookup failed: ${error.message}`);
  return data;
};

const verify = async () => {
  const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: newPassword });
  if (error) return false;
  await c.auth.signOut().catch(() => {});
  return Boolean(data?.session);
};

const scopeSig = (p) => JSON.stringify({
  id: p.id, role: p.role, status: p.status,
  municipality_id: p.municipality_id, barangay_id: p.barangay_id, facility_id: p.facility_id,
});

const main = async () => {
  const user = await findUser();
  console.log(`account found: ${user ? 'yes' : 'no'}`);
  if (!user) process.exit(2);

  const before = await getProfile(user.id);
  const beforeSig = before ? scopeSig(before) : null;

  const { error } = await admin.auth.admin.updateUserById(user.id, { password: newPassword });
  if (error) { console.log('password reset: no'); throw new Error(`updateUserById failed: ${error.message}`); }

  const ok = await verify();
  const after = await getProfile(user.id);
  const afterSig = after ? scopeSig(after) : null;

  console.log(`password reset: ${ok ? 'yes' : 'no (sign-in verification failed)'}`);
  console.log(`same auth user id: ${before && after && before.id === after.id ? 'yes' : 'n/a'}`);
  console.log(`profile preserved: ${beforeSig && beforeSig === afterSig ? 'yes' : 'CHANGED'}`);
  if (after) {
    console.log(`role: ${after.role}`);
    console.log(`status: ${after.status}`);
    console.log(`municipality_id: ${after.municipality_id ? 'set' : 'null'}`);
    console.log(`barangay_id: ${after.barangay_id ? 'set' : 'null'}`);
  }
};

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

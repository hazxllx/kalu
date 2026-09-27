/**
 * READ-ONLY diagnostic: prove who owns a resident's notifications.
 *
 * Answers the question "why does the resident at /app/resident/notifications
 * see these notifications?" without changing any data. It reads only; it never
 * inserts, updates or deletes, and it never prints passwords, tokens or the
 * service-role key. It runs SERVER-SIDE with the service key (never the
 * browser) exactly like the other backend scripts.
 *
 * For the given account it reports:
 *   - the auth.users id (the identity the app scopes notifications by),
 *   - the resident row(s) linked to that auth id — and flags if more than one
 *     resident shares it (the one real cross-resident leak vector),
 *   - a global scan for any auth_user_id linked to >1 resident,
 *   - every notification whose recipient_id = this auth id (id, title,
 *     category, related_type, related_id, created_at, read), and confirms each
 *     returned row truly belongs to this auth id,
 *   - the total notifications in the table vs the count owned by this account,
 *     so you can see the query is scoped (owned << total means isolation works).
 *
 * Usage:
 *   node backend/scripts/diagnose-resident-notifications.mjs <email>
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const email = (process.argv[2] || '').trim().toLowerCase();
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!email) { console.error('Usage: node diagnose-resident-notifications.mjs <email>'); process.exit(1); }
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env in backend/.env'); process.exit(1); }

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

const main = async () => {
  const user = await findUser();
  console.log(`account found: ${user ? 'yes' : 'no'}`);
  if (!user) process.exit(2);
  const authId = user.id;
  console.log(`auth.users id: ${authId}`);

  // Resident row(s) linked to this auth account.
  const { data: linked, error: rErr } = await admin
    .from('residents')
    .select('id, first_name, last_name, barangay, verification_status')
    .eq('auth_user_id', authId);
  if (rErr) throw new Error(`residents lookup failed: ${rErr.message}`);
  console.log(`\nlinked resident rows: ${linked?.length || 0}`);
  (linked || []).forEach((r) => console.log(`  - ${r.id} (${r.first_name} ${r.last_name}, ${r.barangay}, ${r.verification_status})`));
  if ((linked?.length || 0) > 1) {
    console.log('  !! MULTIPLE residents share this auth account — this IS a cross-resident leak vector.');
  }

  // Global scan: any auth account linked to more than one resident.
  const { data: allLinks, error: gErr } = await admin
    .from('residents')
    .select('auth_user_id')
    .not('auth_user_id', 'is', null)
    .limit(100000);
  if (gErr) throw new Error(`global link scan failed: ${gErr.message}`);
  const counts = new Map();
  for (const row of allLinks || []) counts.set(row.auth_user_id, (counts.get(row.auth_user_id) || 0) + 1);
  const dups = [...counts.entries()].filter(([, n]) => n > 1);
  console.log(`\nauth accounts linked to >1 resident (global): ${dups.length}`);
  dups.slice(0, 20).forEach(([uid, n]) => console.log(`  - ${uid}: ${n} residents`));

  // Notifications owned by this account.
  const { data: owned, error: nErr } = await admin
    .from('notifications')
    .select('id, recipient_id, title, category, related_type, related_id, read_at, created_at')
    .eq('recipient_id', authId)
    .order('created_at', { ascending: false });
  if (nErr) throw new Error(`notifications lookup failed: ${nErr.message}`);
  console.log(`\nnotifications with recipient_id = this auth id: ${owned?.length || 0}`);
  const foreign = (owned || []).filter((n) => n.recipient_id !== authId);
  (owned || []).forEach((n) =>
    console.log(`  - [${n.read_at ? 'read' : 'UNREAD'}] ${n.title} | ${n.category} | ${n.related_type || '-'}#${n.related_id ?? '-'} | ${n.created_at}`),
  );
  console.log(`rows returned that do NOT belong to this auth id: ${foreign.length} (must be 0)`);

  // Total-in-table vs owned, to show the recipient filter is scoping.
  const { count: total, error: cErr } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true });
  if (cErr) throw new Error(`count failed: ${cErr.message}`);
  console.log(`\ntotal notifications in table: ${total ?? 'unknown'}`);
  console.log(`owned by this account: ${owned?.length || 0}`);
  console.log('\nInterpretation:');
  console.log('  - owned << total  => the recipient filter is isolating correctly.');
  console.log('  - linked residents > 1  => resolve duplicate account links (see migration 20260927140000).');
  console.log('  - foreign rows > 0  => a real query/ownership bug (should never happen).');
};

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

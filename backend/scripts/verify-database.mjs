/**
 * KALUSAGAP — database verification + reference-data seed (Phase 4).
 *
 * Runs against the configured Supabase project (backend/.env):
 *   1. verifies every expected table exists and is readable,
 *   2. seeds the reference data (municipality, barangays, facilities) when
 *      missing — the same idempotent logic as supabase/seed.sql,
 *   3. prints the resulting reference rows.
 *
 * Usage:  node scripts/verify-database.mjs   (from the backend/ directory)
 * Never prints credentials. Does NOT apply the fabricated demo seed.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const EXPECTED_TABLES = [
  'municipalities', 'barangays', 'facilities', 'profiles', 'role_permissions',
  'account_applications', 'documents', 'residents', 'visits', 'referrals',
  'record_counters',
];

const pass = (msg) => console.log(`PASS  ${msg}`);
const fail = (msg) => console.log(`FAIL  ${msg}`);

// --- 1. tables ---------------------------------------------------------------
let tablesOk = true;
for (const table of EXPECTED_TABLES) {
  const { error } = await supabase.from(table).select('count', { count: 'exact', head: true });
  if (error) {
    tablesOk = false;
    fail(`table public.${table} — ${error.message}`);
  } else {
    pass(`table public.${table}`);
  }
}

// --- 2. reference data ---------------------------------------------------------
const MUNICIPALITY = { name: 'Pili', province: 'Camarines Sur', region: 'Region V (Bicol)' };
const BARANGAYS = ['San Isidro', 'San Antonio', 'Old San Roque'];

let { data: municipality } = await supabase
  .from('municipalities')
  .select('id, name, province, region')
  .eq('name', MUNICIPALITY.name)
  .eq('province', MUNICIPALITY.province)
  .maybeSingle();

if (!municipality) {
  const { data, error } = await supabase
    .from('municipalities')
    .insert(MUNICIPALITY)
    .select('id, name, province, region')
    .single();
  if (error) {
    fail(`seed municipality — ${error.message}`);
    process.exit(1);
  }
  municipality = data;
  console.log('SEEDED municipality:', municipality.name);
} else {
  pass('municipality exists:', municipality.name);
}

const { data: existingBarangays } = await supabase
  .from('barangays')
  .select('id, name')
  .eq('municipality_id', municipality.id);

const existingNames = new Set((existingBarangays || []).map((b) => b.name));
const missingBarangays = BARANGAYS.filter((b) => !existingNames.has(b));

if (missingBarangays.length) {
  const { error } = await supabase.from('barangays').insert(
    missingBarangays.map((name) => ({
      municipality_id: municipality.id,
      name,
      status: 'Active',
      health_station_name: `${name} Barangay Health Center`,
    })),
  );
  if (error) fail(`seed barangays — ${error.message}`);
  else console.log('SEEDED barangays:', missingBarangays.join(', '));
} else {
  pass('barangays exist:', [...existingNames].sort().join(', '));
}

const { data: barangays } = await supabase
  .from('barangays')
  .select('id, name, municipality_id')
  .eq('municipality_id', municipality.id);

// Facilities: "RHU" + one barangay health station per barangay (matches
// frontend/src/lib/consultationLocations.js).
const { data: existingFacilities } = await supabase
  .from('facilities')
  .select('name, type, barangay_id')
  .eq('municipality_id', municipality.id);

const facilityNames = new Set((existingFacilities || []).map((f) => f.name));
const toInsert = [];
if (!facilityNames.has('RHU')) {
  toInsert.push({ municipality_id: municipality.id, barangay_id: null, name: 'RHU', type: 'rhu' });
}
for (const b of barangays || []) {
  const name = `${b.name} Barangay Health Center`;
  if (!facilityNames.has(name)) {
    toInsert.push({
      municipality_id: municipality.id,
      barangay_id: b.id,
      name,
      type: 'barangay_health_station',
    });
  }
}
if (toInsert.length) {
  const { error } = await supabase.from('facilities').insert(toInsert);
  if (error) fail(`seed facilities — ${error.message}`);
  else console.log(`SEEDED ${toInsert.length} facilities:`, toInsert.map((f) => f.name).join(', '));
} else {
  pass('facilities exist:', [...facilityNames].sort().join(', '));
}

// --- 3. summary ----------------------------------------------------------------
const { count: barangayCount } = await supabase
  .from('barangays').select('count', { count: 'exact', head: true })
  .eq('municipality_id', municipality.id);
const { count: facilityCount } = await supabase
  .from('facilities').select('count', { count: 'exact', head: true })
  .eq('municipality_id', municipality.id);
const { count: profileCount } = await supabase
  .from('profiles').select('count', { count: 'exact', head: true });

console.log('---');
console.log(`municipality: ${municipality.name} (${municipality.province}, ${municipality.region})`);
console.log(`barangays: ${barangayCount ?? 0}`);
console.log(`facilities: ${facilityCount ?? 0}`);
console.log(`profiles: ${profileCount ?? 0}`);
console.log(tablesOk ? 'ALL TABLES VERIFIED' : 'SOME TABLES MISSING');
process.exit(tablesOk ? 0 : 1);

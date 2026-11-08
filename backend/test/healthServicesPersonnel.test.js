import assert from 'node:assert/strict';
import test from 'node:test';

// Keep the service-layer notification helper inert (no live Supabase).
import env from '../src/config/env.js';
env.isSupabaseConfigured = false;

import { assignablePersonnel } from '../src/services/healthServices.service.js';

/**
 * Minimal thenable Supabase builder stub for the single-table profiles read in
 * assignablePersonnel: `.from('profiles').select().eq().eq().in()` then awaited.
 */
const makeSupabase = (rows) => {
  const filters = [];
  let range = [0, 499];
  const chain = {
    select() { return chain; },
    eq(key, value) { filters.push((row) => row[key] === value); return chain; },
    in(key, values) { filters.push((row) => values.includes(row[key])); return chain; },
    order() { return chain; },
    range(from, to) { range = [from, to]; return chain; },
    then(onF, onR) { return Promise.resolve({ data: rows.filter((row) => filters.every((filter) => filter(row))).slice(range[0], range[1] + 1), error: null }).then(onF, onR); },
  };
  return { from() { return chain; } };
};

const mho = { id: 'u-mho', role: 'mho', municipalityId: 'm1', barangayId: null };
const supervisor = { id: 'u-sup', role: 'health_supervisor', municipalityId: 'm1', barangayId: 'b1' };
const REAL_1 = '20000000-0000-0000-0000-000000000001';
const REAL_2 = '20000000-0000-0000-0000-000000000002';
const SUPERVISOR_ID = '20000000-0000-0000-0000-000000000003';
const staff = (row) => ({
  status: 'active', municipality_id: 'm1', facility_id: null, account: null,
  municipality: { id: 'm1', is_active: true },
  barangay: { id: row.barangay_id, municipality_id: 'm1', name: row.barangay_id === 'b2' ? 'San Antonio' : 'San Isidro', status: 'Active' },
  ...row,
});

// A realistic municipality roster: two legitimate BHWs that share the same
// display name, the fixed operational Health Supervisor on the test domain, and
// three QA/live-verification artifact accounts created by verify-live-workflows.
const roster = [
  { id: REAL_1, full_name: 'Juan Dela Cruz', email: 'juan.delacruz@kalusagap.ph', role: 'bhw', barangay_id: 'b1' },
  { id: REAL_2, full_name: 'Juan Dela Cruz', email: 'jdelacruz2@gmail.com', role: 'bhw', barangay_id: 'b1' },
  { id: SUPERVISOR_ID, full_name: 'Health Supervisor', email: 'supervisor@kalusagap.test', role: 'health_supervisor', barangay_id: 'b1' },
  { id: '20000000-0000-0000-0000-000000000004', full_name: 'QA Barangay Health Worker', email: 'bhw.qa.1760000000001@kalusagap.test', role: 'bhw', barangay_id: 'b1' },
  { id: '20000000-0000-0000-0000-000000000005', full_name: 'QA Barangay Health Worker', email: 'bhw.qa.1760000000002@kalusagap.test', role: 'bhw', barangay_id: 'b1' },
  { id: '20000000-0000-0000-0000-000000000006', full_name: 'QA Unapprovable PHN', email: 'qa.unapprovable.1760000000003@kalusagap.test', role: 'phn', barangay_id: 'b1' },
].map(staff);

test('assignablePersonnel excludes QA/verification artifact accounts', async () => {
  const supabase = makeSupabase(roster);
  const rows = await assignablePersonnel({ user: mho, supabase });

  // No QA artifact account survives.
  assert.deepEqual(rows.map((r) => r.id).sort(), [REAL_1, REAL_2, SUPERVISOR_ID]);
  // The fixed operational Health Supervisor on the test domain is kept.
  assert.ok(rows.some((r) => r.id === SUPERVISOR_ID), 'operational test-domain account must be kept');
});

test('assignablePersonnel keeps legitimate personnel with identical display names', async () => {
  const supabase = makeSupabase(roster);
  const rows = await assignablePersonnel({ user: mho, supabase });

  const namedJuan = rows.filter((r) => r.name === 'Juan Dela Cruz');
  assert.equal(namedJuan.length, 2, 'both real BHWs sharing a name remain selectable');
  assert.deepEqual(namedJuan.map((r) => r.id).sort(), [REAL_1, REAL_2]);
});

test('assignablePersonnel deduplicates by stable account id', async () => {
  // Same account id repeated (e.g. an upstream response that doubled a row).
  const dupeRow = staff({ id: REAL_1, full_name: 'Juan Dela Cruz', email: 'juan.delacruz@kalusagap.ph', role: 'bhw', barangay_id: 'b1' });
  const supabase = makeSupabase([dupeRow, { ...dupeRow }]);
  const rows = await assignablePersonnel({ user: mho, supabase });
  assert.equal(rows.length, 1, 'a repeated account id appears exactly once');
  assert.equal(rows[0].id, REAL_1);
});

test('assignablePersonnel confines a Health Supervisor to their own barangay', async () => {
  const otherBarangay = [
    { id: '20000000-0000-0000-0000-000000000007', full_name: 'Other Barangay BHW', email: 'other@kalusagap.ph', role: 'bhw', barangay_id: 'b2' },
    { id: REAL_1, full_name: 'Juan Dela Cruz', email: 'juan.delacruz@kalusagap.ph', role: 'bhw', barangay_id: 'b1' },
  ].map(staff);
  const supabase = makeSupabase(otherBarangay);
  const rows = await assignablePersonnel({ user: supervisor, supabase });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, REAL_1);
});

test('assignablePersonnel returns an empty list for a supervisor with no barangay', async () => {
  const supabase = makeSupabase(roster);
  const rows = await assignablePersonnel({ user: { ...supervisor, barangayId: null }, supabase });
  assert.deepEqual(rows, []);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { list } from '../src/services/operational.service.js';

/**
 * Thenable Supabase query stub: records the select string and eq filters, and
 * resolves to { data, error } when awaited. Lets the operational list query be
 * asserted without a live database.
 */
const listQueryStub = (data, error = null) => {
  const calls = { table: null, select: null, eq: {} };
  const chain = {
    calls,
    from(table) { calls.table = table; return chain; },
    select(sel) { calls.select = sel; return chain; },
    order() { return chain; },
    limit() { return chain; },
    eq(col, val) { calls.eq[col] = val; return chain; },
    gte() { return chain; },
    lte() { return chain; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(resolve) { return Promise.resolve({ data, error }).then(resolve); },
  };
  return chain;
};

const RESIDENT_ROW = {
  id: 'r-imm-1',
  resident_id: 'res-1',
  vaccine: 'BCG',
  dose: '1ST',
  administered_date: '2026-10-02',
  status: 'Completed',
  barangay_id: 'b1',
  municipality_id: 'm1',
  resident: { id: 'res-1', first_name: 'Samantha', middle_name: null, last_name: 'Dela Cruz' },
};

test('immunizations list embeds the resident relationship (same convention as maternal)', async () => {
  const supabase = listQueryStub([RESIDENT_ROW]);
  const rows = await list({
    user: { id: 'hs-1', role: 'health_supervisor', barangayId: 'b1', municipalityId: 'm1' },
    kind: 'immunizations',
    supabase,
  });
  assert.equal(supabase.calls.table, 'immunizations');
  // Resident embed is requested using the shared residents relationship.
  assert.match(supabase.calls.select, /resident:residents\(/);
  assert.match(supabase.calls.select, /first_name/);
  assert.match(supabase.calls.select, /last_name/);
  // The embedded resident is returned so the UI can display the name.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].resident.first_name, 'Samantha');
  assert.equal(rows[0].resident.last_name, 'Dela Cruz');
});

test('immunizations list is barangay-scoped for a Health Supervisor', async () => {
  const supabase = listQueryStub([RESIDENT_ROW]);
  await list({
    user: { id: 'hs-1', role: 'health_supervisor', barangayId: 'b1', municipalityId: 'm1' },
    kind: 'immunizations',
    supabase,
  });
  assert.equal(supabase.calls.eq.barangay_id, 'b1');
});

test('a Health Supervisor with no barangay gets no immunization rows', async () => {
  const supabase = listQueryStub([RESIDENT_ROW]);
  const rows = await list({
    user: { id: 'hs-2', role: 'health_supervisor', barangayId: null, municipalityId: 'm1' },
    kind: 'immunizations',
    supabase,
  });
  assert.deepEqual(rows, []);
});

test('immunizations response does not expose unrelated resident fields', async () => {
  const supabase = listQueryStub([RESIDENT_ROW]);
  await list({
    user: { id: 'hs-1', role: 'health_supervisor', barangayId: 'b1', municipalityId: 'm1' },
    kind: 'immunizations',
    supabase,
  });
  // The embed is an explicit allow-list — never `residents(*)`.
  assert.doesNotMatch(supabase.calls.select, /residents\(\s*\*/);
  for (const field of ['password', 'auth_user_id', 'contact', 'email']) {
    assert.doesNotMatch(supabase.calls.select, new RegExp(field));
  }
});

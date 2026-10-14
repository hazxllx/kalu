import assert from 'node:assert/strict';
import test from 'node:test';

import { list as listOperationalFollowUps } from '../src/services/operational.service.js';
import { listOwn } from '../src/services/residentFollowups.service.js';

const makeFollowUps = (count) => Array.from({ length: count }, (_, index) => ({
  id: `follow-up-${index + 1}`,
  resident_id: 'resident-1',
  scheduled_date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
  scheduled_time: '09:00:00',
  location: index === 0 ? 'RHU' : `Barangay Health Station ${index + 1}`,
  status: 'Scheduled',
  created_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
}));

const pagedSupabase = ({ rows, resident } = {}) => {
  const ranges = [];
  const equalityFilters = [];
  return {
    ranges,
    equalityFilters,
    from(table) {
      const ctx = { table, from: 0, to: rows?.length ?? 0, filters: {} };
      const chain = {
        select() { return chain; },
        eq(column, value) {
          ctx.filters[column] = value;
          equalityFilters.push({ table, column, value });
          return chain;
        },
        order() { return chain; },
        limit() { return chain; },
        range(from, to) {
          ctx.from = from;
          ctx.to = to + 1;
          ranges.push({ table, from, to });
          return chain;
        },
        maybeSingle() {
          return Promise.resolve({ data: resident || null, error: null });
        },
        then(resolve, reject) {
          if (table === 'residents') return Promise.resolve({ data: resident || null, error: null }).then(resolve, reject);
          return Promise.resolve({
            data: (rows || []).slice(ctx.from, ctx.to),
            error: null,
          }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
};

test('staff follow-up listing pages past 200 records and retains supervisor scope', async () => {
  const rows = makeFollowUps(405);
  const supabase = pagedSupabase({ rows });
  const result = await listOperationalFollowUps({
    user: { id: 'supervisor-1', role: 'health_supervisor', barangayId: 'barangay-1' },
    kind: 'followups',
    supabase,
  });

  assert.equal(result.length, 405);
  assert.equal(result[0].id, rows[0].id);
  assert.equal(result[0].location, 'RHU');
  assert.equal(result[1].location, 'Barangay Health Station 2');
  assert.equal(result.at(-1).id, rows.at(-1).id);
  assert.deepEqual(supabase.ranges.map(({ from, to }) => [from, to]), [[0, 199], [200, 399], [400, 599]]);
  assert(supabase.equalityFilters.some(({ table, column, value }) =>
    table === 'follow_ups' && column === 'barangay_id' && value === 'barangay-1'));
});

test('resident follow-up listing pages through all own records without exposing other residents', async () => {
  const rows = makeFollowUps(205);
  const supabase = pagedSupabase({
    rows,
    resident: { id: 'resident-1', auth_user_id: 'user-1' },
  });
  const result = await listOwn({
    user: { id: 'user-1', role: 'resident' },
    supabase,
  });

  assert.equal(result.length, 205);
  assert.equal(result.at(-1).id, rows.at(-1).id);
  assert(supabase.equalityFilters.some(({ table, column, value }) =>
    table === 'follow_ups' && column === 'resident_id' && value === 'resident-1'));
  assert.deepEqual(supabase.ranges.map(({ from, to }) => [from, to]), [[0, 199], [200, 399]]);
  assert.equal('resident_id' in result[0], false);
});

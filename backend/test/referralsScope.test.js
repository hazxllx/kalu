import assert from 'node:assert/strict';
import test from 'node:test';

import { list as listReferrals } from '../src/services/referrals.service.js';

const makeReferral = (id, barangayId) => ({
  id,
  resident_id: `resident-${id}`,
  barangay_id: barangayId,
  municipality_id: 'municipality-1',
  status: 'Pending',
  created_at: '2026-10-14T00:00:00.000Z',
  resident: {
    id: `resident-${id}`,
    first_name: 'Test',
    last_name: id,
    barangay: barangayId,
  },
});

const referralSupabase = (records, referralError = null) => {
  const ranges = [];
  const selects = [];

  return {
    ranges,
    selects,
    from(table) {
      const context = { filters: [], range: null };
      const query = {
        select(value) {
          selects.push({ table, value });
          return query;
        },
        order() {
          return query;
        },
        eq(column, value) {
          context.filters.push((row) => row[column] === value);
          return query;
        },
        in(column, values) {
          context.filters.push((row) => values.includes(row[column]));
          return query;
        },
        range(from, to) {
          context.range = { from, to };
          if (table === 'health_referrals') ranges.push([from, to]);
          return query;
        },
        then(resolve, reject) {
          const matching = table === 'health_referrals'
            ? records.filter((row) => context.filters.every((matches) => matches(row)))
            : [];
          const data = context.range
            ? matching.slice(context.range.from, context.range.to + 1)
            : matching;
          return Promise.resolve({
            data,
            error: table === 'health_referrals' ? referralError : null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
};

test('Health Supervisor referrals paginate without crossing the assigned barangay', async () => {
  const ownRecords = Array.from({ length: 205 }, (_, index) =>
    makeReferral(`own-${String(index + 1).padStart(3, '0')}`, 'barangay-1'));
  const otherBarangay = makeReferral('other-001', 'barangay-2');
  const supabase = referralSupabase([...ownRecords, otherBarangay]);

  const result = await listReferrals({
    user: {
      id: 'supervisor-1',
      role: 'health_supervisor',
      barangayId: 'barangay-1',
    },
    supabase,
  });

  assert.equal(result.length, 205);
  assert(result.every((row) => row.barangay_id === 'barangay-1'));
  assert.deepEqual(supabase.ranges, [[0, 199], [200, 399]]);
  assert(supabase.selects.some(({ table, value }) =>
    table === 'health_referrals' && value.includes('resident:residents(')));
});

test('referral listing returns an empty collection and surfaces database errors', async () => {
  const user = {
    id: 'supervisor-1',
    role: 'health_supervisor',
    barangayId: 'barangay-1',
  };
  assert.deepEqual(
    await listReferrals({ user, supabase: referralSupabase([]) }),
    [],
  );
  await assert.rejects(
    listReferrals({
      user,
      supabase: referralSupabase([], { message: 'Database unavailable' }),
    }),
    /Database unavailable/,
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { create } from '../src/services/operational.service.js';

const USER = { id: 'phn-1', role: 'phn' };
const RESIDENT = { id: 'resident-1', municipality_id: null, barangay_id: null, auth_user_id: null };

const makeSupabase = () => {
  let stored = null;
  let followUpInsertCount = 0;
  let auditInsertCount = 0;

  const supabase = {
    from(table) {
      const filters = {};
      const query = {
        select() { return query; },
        eq(column, value) {
          filters[column] = value;
          return query;
        },
        maybeSingle() {
          const data = table === 'residents'
            ? filters.id === RESIDENT.id ? RESIDENT : null
            : table === 'follow_ups' && stored?.client_operation_key === filters.client_operation_key
              ? stored
              : null;
          return Promise.resolve({ data, error: null });
        },
        insert(value) {
          if (table === 'follow_ups') {
            followUpInsertCount += 1;
            stored = { ...value, id: 'follow-up-1' };
          } else if (table === 'health_audit_logs') {
            auditInsertCount += 1;
          }
          return query;
        },
        single() {
          return Promise.resolve({ data: stored, error: null });
        },
        then(resolve, reject) {
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    get followUpInsertCount() { return followUpInsertCount; },
    get auditInsertCount() { return auditInsertCount; },
    get stored() { return stored; },
  };
  return supabase;
};

const input = (supabase) => ({
  user: USER,
  kind: 'followups',
  idempotencyKey: 'offline-op-1',
  payload: {
    residentId: RESIDENT.id,
    purpose: 'Check-up',
    scheduled_date: '2026-10-20',
    status: 'Scheduled',
  },
  supabase,
});

test('a lost follow-up create response is deduplicated by its persisted operation key', async () => {
  const supabase = makeSupabase();
  const first = await create(input(supabase));
  const replay = await create(input(supabase));

  assert.equal(first.id, 'follow-up-1');
  assert.equal(replay.id, first.id);
  assert.equal(supabase.stored.client_operation_key, 'offline-op-1');
  assert.equal(supabase.followUpInsertCount, 1);
  assert.equal(supabase.auditInsertCount, 1);
});

test('an operation key cannot replay a follow-up belonging to another resident', async () => {
  const supabase = makeSupabase();
  await create(input(supabase));

  await assert.rejects(
    create({
      ...input(supabase),
      payload: { ...input(supabase).payload, residentId: 'resident-2' },
    }),
    { statusCode: 404 },
  );
  assert.equal(supabase.followUpInsertCount, 1);
});

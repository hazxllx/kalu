import assert from 'node:assert/strict';
import test from 'node:test';

import env from '../src/config/env.js';
import { notifyHealthSupervisorsOnce } from '../src/services/notifications.service.js';

test('notification fan-out targets only the active Health Supervisor role and assigned barangay', async () => {
  const previousConfigured = env.isSupabaseConfigured;
  env.isSupabaseConfigured = true;
  const calls = { profiles: { filters: {} }, writes: [] };
  const supabase = {
    from(table) {
      const context = { table, filters: {}, payload: null, options: null };
      const chain = {
        select() { return chain; },
        eq(column, value) { context.filters[column] = value; return chain; },
        upsert(payload, options) {
          context.payload = payload;
          context.options = options;
          calls.writes.push(context);
          return chain;
        },
        maybeSingle() {
          return Promise.resolve({ data: { id: `notif-${calls.writes.length}` }, error: null });
        },
        then(resolve, reject) {
          calls.profiles.filters = context.filters;
          return Promise.resolve({
            data: [{ id: 'hs-a' }, { id: 'hs-b' }, { id: 'hs-actor' }],
            error: null,
          }).then(resolve, reject);
        },
      };
      return chain;
    },
  };

  try {
    const created = await notifyHealthSupervisorsOnce({
      barangayId: 'barangay-7',
      municipalityId: 'municipality-1',
      actorId: 'hs-actor',
      title: 'Follow-up assigned',
      relatedType: 'follow_up_assigned',
      relatedId: 'follow-up-1',
      eventKey: 'follow_up_assigned:follow-up-1',
      supabase,
    });

    assert.equal(created, 2);
    assert.deepEqual(calls.profiles.filters, {
      role: 'health_supervisor',
      status: 'active',
      barangay_id: 'barangay-7',
      municipality_id: 'municipality-1',
    });
    assert.deepEqual(calls.writes.map((write) => write.payload.recipient_id), ['hs-a', 'hs-b']);
    assert.ok(calls.writes.every((write) => write.payload.event_key === 'follow_up_assigned:follow-up-1'));
    assert.ok(calls.writes.every((write) => write.options.onConflict === 'recipient_id,event_key'
      && write.options.ignoreDuplicates === true));
  } finally {
    env.isSupabaseConfigured = previousConfigured;
  }
});

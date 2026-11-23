import assert from 'node:assert/strict';
import test from 'node:test';

import {
  list,
  update,
  markNotificationRead,
  markAllNotificationsRead,
} from '../src/services/operational.service.js';

/**
 * Minimal thenable Supabase stub for the notifications update paths.
 *
 * Records RPC calls so the tests can assert the recipient and notification IDs
 * passed to the owner-scoped database functions.
 */
const supabaseStub = (resolveData) => {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      const result = typeof resolveData === 'function' ? resolveData(name, args) : resolveData;
      return { data: result?.data ?? null, error: result?.error ?? null };
    },
  };
};

const OWNER = { id: 'auth-user-1', role: 'resident' };
const ROW = { id: 'notif-1', recipient_id: 'auth-user-1', read_at: null, title: 'Hi', message: '', category: 'information' };

test('markNotificationRead calls the owner-scoped database function with exact IDs', async () => {
  const supabase = supabaseStub({ data: { ...ROW, read_at: '2026-10-11T00:00:00.000Z' } });
  const result = await markNotificationRead({ user: OWNER, id: 'notif-1', supabase });

  assert.deepEqual(supabase.calls, [{
    name: 'mark_owned_notification_read',
    args: { p_recipient_id: OWNER.id, p_notification_id: 'notif-1' },
  }]);
  assert.equal(result.id, 'notif-1');
});

test("markNotificationRead cannot mark another user's notification (no matching row → 404)", async () => {
  const supabase = supabaseStub({ data: null });
  await assert.rejects(
    () => markNotificationRead({ user: { id: 'attacker', role: 'resident' }, id: 'notif-1', supabase }),
    /Notification not found/,
  );
  assert.deepEqual(supabase.calls[0].args, {
    p_recipient_id: 'attacker',
    p_notification_id: 'notif-1',
  });
});

test('REGRESSION: PUT update for notifications dispatches to markNotificationRead for a non-staff role', async () => {
  // Before the fix, update() fell through to the staff-only operational path and
  // threw 403 (assertStaff) for residents, so marking read failed for everyone.
  const supabase = supabaseStub({ data: { ...ROW, read_at: '2026-10-11T00:00:00.000Z' } });
  const result = await update({ user: OWNER, kind: 'notifications', id: 'notif-1', payload: {}, supabase });

  assert.equal(supabase.calls[0].name, 'mark_owned_notification_read');
  assert.ok(result.read_at);
});

test('update for notifications works for the "notification" singular alias too', async () => {
  const supabase = supabaseStub({ data: { ...ROW, read_at: '2026-10-11T00:00:00.000Z' } });
  const result = await update({ user: OWNER, kind: 'notification', id: 'notif-1', payload: {}, supabase });
  assert.equal(supabase.calls[0].name, 'mark_owned_notification_read');
  assert.ok(result.read_at);
});

test('markAllNotificationsRead scopes to the caller and only unread rows, returning the count', async () => {
  const supabase = supabaseStub({ data: 3 });
  const result = await markAllNotificationsRead({ user: OWNER, supabase });

  assert.deepEqual(supabase.calls, [{
    name: 'mark_all_owned_notifications_read',
    args: { p_recipient_id: OWNER.id },
  }]);
  assert.equal(result.updated, 3);
});

test('markAllNotificationsRead reports 0 when nothing was unread', async () => {
  const supabase = supabaseStub({ data: 0 });
  const result = await markAllNotificationsRead({ user: OWNER, supabase });
  assert.equal(result.updated, 0);
});

test('notification listing returns complete paginated history scoped to the authenticated recipient', async () => {
  const rows = Array.from({ length: 201 }, (_, index) => ({
    id: `notif-${index}`,
    recipient_id: OWNER.id,
    read_at: index % 2 ? '2026-10-11T00:00:00.000Z' : null,
  }));
  const calls = [];
  const supabase = {
    from(table) {
      const ctx = { table, filters: {}, range: null };
      const chain = {
        select() { return chain; },
        eq(column, value) { ctx.filters[column] = value; return chain; },
        order() { return chain; },
        range(from, to) { ctx.range = [from, to]; calls.push(ctx); return chain; },
        then(resolve, reject) {
          return Promise.resolve({ data: rows.slice(ctx.range[0], ctx.range[1] + 1), error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };

  const result = await list({ user: OWNER, kind: 'notifications', supabase });
  assert.equal(result.length, rows.length);
  assert.deepEqual(calls.map((call) => call.range), [[0, 199], [200, 399]]);
  assert.ok(calls.every((call) => call.table === 'notifications' && call.filters.recipient_id === OWNER.id));
});

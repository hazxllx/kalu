import assert from 'node:assert/strict';
import test from 'node:test';

import {
  update,
  markNotificationRead,
  markAllNotificationsRead,
} from '../src/services/operational.service.js';

/**
 * Minimal thenable Supabase stub for the notifications update paths.
 *
 * Records the table, the update payload, and every `eq`/`is` filter so the test
 * can assert ownership scoping (`recipient_id`), that only `read_at` is written,
 * and that "mark all" is limited to unread rows. `resolveData` decides what the
 * query resolves to (a row, null, or an array) for both `.maybeSingle()` and
 * the awaited (`then`) form.
 */
const supabaseStub = (resolveData) => {
  const calls = { table: null, update: null, eq: {}, is: {}, select: null };
  const result = typeof resolveData === 'function' ? resolveData(calls) : resolveData;
  const chain = {
    calls,
    from(table) { calls.table = table; return chain; },
    update(payload) { calls.update = payload; return chain; },
    eq(col, val) { calls.eq[col] = val; return chain; },
    is(col, val) { calls.is[col] = val; return chain; },
    select(sel) { calls.select = sel; return chain; },
    maybeSingle() { return Promise.resolve({ data: result?.single ?? null, error: result?.error ?? null }); },
    then(resolve) { return Promise.resolve({ data: result?.many ?? [], error: result?.error ?? null }).then(resolve); },
  };
  return chain;
};

const OWNER = { id: 'auth-user-1', role: 'resident' };
const ROW = { id: 'notif-1', recipient_id: 'auth-user-1', read_at: null, title: 'Hi', message: '', category: 'information' };

test('markNotificationRead scopes the update by id AND recipient and sets read_at only', async () => {
  const supabase = supabaseStub({ single: { ...ROW, read_at: '2026-10-11T00:00:00.000Z' } });
  const result = await markNotificationRead({ user: OWNER, id: 'notif-1', supabase });

  assert.equal(supabase.calls.table, 'notifications');
  // Ownership is enforced in the statement itself.
  assert.equal(supabase.calls.eq.id, 'notif-1');
  assert.equal(supabase.calls.eq.recipient_id, 'auth-user-1');
  // Only read_at is written — content fields are never touched.
  assert.deepEqual(Object.keys(supabase.calls.update), ['read_at']);
  assert.ok(supabase.calls.update.read_at);
  assert.equal(result.id, 'notif-1');
});

test("markNotificationRead cannot mark another user's notification (no matching row → 404)", async () => {
  // recipient_id filter yields no row for a non-owner.
  const supabase = supabaseStub({ single: null });
  await assert.rejects(
    () => markNotificationRead({ user: { id: 'attacker', role: 'resident' }, id: 'notif-1', supabase }),
    /Notification not found/,
  );
  assert.equal(supabase.calls.eq.recipient_id, 'attacker');
});

test('REGRESSION: PUT update for notifications dispatches to markNotificationRead for a non-staff role', async () => {
  // Before the fix, update() fell through to the staff-only operational path and
  // threw 403 (assertStaff) for residents, so marking read failed for everyone.
  const supabase = supabaseStub({ single: { ...ROW, read_at: '2026-10-11T00:00:00.000Z' } });
  const result = await update({ user: OWNER, kind: 'notifications', id: 'notif-1', payload: {}, supabase });

  assert.equal(supabase.calls.table, 'notifications');
  assert.equal(supabase.calls.eq.recipient_id, 'auth-user-1');
  assert.ok(result.read_at);
});

test('update for notifications works for the "notification" singular alias too', async () => {
  const supabase = supabaseStub({ single: { ...ROW, read_at: '2026-10-11T00:00:00.000Z' } });
  const result = await update({ user: OWNER, kind: 'notification', id: 'notif-1', payload: {}, supabase });
  assert.equal(supabase.calls.table, 'notifications');
  assert.ok(result.read_at);
});

test('markAllNotificationsRead scopes to the caller and only unread rows, returning the count', async () => {
  const supabase = supabaseStub({ many: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }] });
  const result = await markAllNotificationsRead({ user: OWNER, supabase });

  assert.equal(supabase.calls.table, 'notifications');
  // Only the caller's rows.
  assert.equal(supabase.calls.eq.recipient_id, 'auth-user-1');
  // Only currently-unread rows (preserves existing read timestamps / history).
  assert.equal(supabase.calls.is.read_at, null);
  assert.deepEqual(Object.keys(supabase.calls.update), ['read_at']);
  assert.equal(result.updated, 3);
});

test('markAllNotificationsRead reports 0 when nothing was unread', async () => {
  const supabase = supabaseStub({ many: [] });
  const result = await markAllNotificationsRead({ user: OWNER, supabase });
  assert.equal(result.updated, 0);
});

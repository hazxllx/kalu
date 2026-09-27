import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as service from '../src/services/operational.service.js';

/**
 * Resident/staff NOTIFICATION isolation (the boundary that keeps one resident
 * from seeing another's notifications).
 *
 * The resident notifications endpoint reads through the service-role client
 * (which bypasses RLS), so the explicit `recipient_id = req.user.id` filter in
 * the service is the isolation boundary. These tests inject an in-memory
 * Supabase fake (list + markNotificationRead accept an optional `supabase`) to
 * prove, deterministically and without a live database, that:
 *   - list returns ONLY rows whose recipient_id equals the caller's auth id;
 *   - the unread/all counts a resident can compute are therefore own-only;
 *   - mark-as-read only ever affects the caller's own notification (IDOR safe).
 *
 * recipient_id is an auth.users id (req.user.id from the verified session), the
 * same value the RLS policy compares to auth.uid().
 */

class FakeQuery {
  constructor(store, table) {
    this.store = store;
    this.table = table;
    this.filters = [];
    this.op = 'select';
    this.payload = null;
    this.maybe_ = false;
  }
  select() { if (!['update'].includes(this.op)) this.op = 'select'; return this; }
  update(row) { this.op = 'update'; this.payload = row; return this; }
  eq(col, val) { this.filters.push([col, val]); return this; }
  order() { return this; }
  limit() { return this._run(); }
  maybeSingle() { this.maybe_ = true; return this._run(); }
  then(resolve, reject) { return this._run().then(resolve, reject); }

  _match(rows) { return rows.filter((r) => this.filters.every(([c, v]) => r[c] === v)); }
  async _run() {
    const t = this.store.tables[this.table] || (this.store.tables[this.table] = new Map());
    if (this.op === 'update') {
      const rows = this._match([...t.values()]);
      let updated = null;
      for (const r of rows) { Object.assign(r, this.payload); updated = r; }
      return { data: updated ? { ...updated } : null, error: null };
    }
    const rows = this._match([...t.values()]).map((r) => ({ ...r }));
    if (this.maybe_) return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  }
}

let store;
const supabase = () => store.client;

const USER_A = { id: 'auth-A', role: 'resident' };
const USER_B = { id: 'auth-B', role: 'resident' };

const seed = (id, recipient, over = {}) => {
  store.tables.notifications.set(id, {
    id, recipient_id: recipient, category: 'information', title: `n-${id}`,
    message: '', related_type: '', related_id: null, read_at: null,
    created_at: '2026-09-27T00:00:00Z', ...over,
  });
};

beforeEach(() => {
  store = { tables: { notifications: new Map() } };
  store.client = { from: (table) => new FakeQuery(store, table) };
  seed('nA1', 'auth-A');
  seed('nA2', 'auth-A', { category: 'reminder', title: 'Referral created' });
  seed('nB1', 'auth-B', { title: 'Maternal record added' });
});

test('list returns ONLY the caller\'s own notifications (recipient_id = auth id)', async () => {
  const aRows = await service.list({ user: USER_A, kind: 'notifications', supabase: supabase() });
  assert.equal(aRows.length, 2);
  assert.ok(aRows.every((r) => r.recipient_id === 'auth-A'), 'every row belongs to A');

  const bRows = await service.list({ user: USER_B, kind: 'notifications', supabase: supabase() });
  assert.equal(bRows.length, 1);
  assert.equal(bRows[0].recipient_id, 'auth-B');
  assert.equal(bRows[0].id, 'nB1');
});

test('a resident never receives another resident\'s notification, even by id', async () => {
  const aRows = await service.list({ user: USER_A, kind: 'notifications', supabase: supabase() });
  assert.ok(aRows.every((r) => r.id !== 'nB1'), 'A must not see B\'s notification');
});

test('unread/all counts computed from the list are own-only', async () => {
  const aRows = await service.list({ user: USER_A, kind: 'notifications', supabase: supabase() });
  const unread = aRows.filter((r) => !r.read_at).length;
  assert.equal(aRows.length, 2); // "All" count for A
  assert.equal(unread, 2); // "Unread" count for A — never includes B's row
});

test('mark-as-read only affects the caller\'s own notification', async () => {
  const res = await service.markNotificationRead({ user: USER_A, id: 'nA1', supabase: supabase() });
  assert.ok(res.read_at);
  assert.ok(store.tables.notifications.get('nA1').read_at);
});

test('IDOR: a resident cannot mark another resident\'s notification read (404, unchanged)', async () => {
  await assert.rejects(
    () => service.markNotificationRead({ user: USER_B, id: 'nA1', supabase: supabase() }),
    (e) => e.statusCode === 404,
  );
  assert.equal(store.tables.notifications.get('nA1').read_at, null, "A's notification stays unread");
});

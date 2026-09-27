import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as service from '../src/services/residentFollowups.service.js';

/**
 * Resident follow-up confirmation service tests.
 *
 * The service normally talks to Supabase through the service-role client; here
 * an in-memory fake is injected (every function accepts an optional `supabase`)
 * so ownership resolution, IDOR protection, approve/reject transitions,
 * duplicate-decision guards and staff notifications are exercised without a
 * live database.
 */

// --- in-memory Supabase fake (same shape as referrals.test.js) --------------
class FakeQuery {
  constructor(store, table) {
    this.store = store; this.table = table; this.filters = [];
    this.op = 'select'; this.payload = null; this.selectStr = '';
    this.single_ = false; this.maybe_ = false;
  }
  select(str) { this.selectStr = str || ''; if (!['insert', 'update', 'delete'].includes(this.op)) this.op = 'select'; return this; }
  insert(row) { this.op = 'insert'; this.payload = row; return this; }
  update(row) { this.op = 'update'; this.payload = row; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col, val) { this.filters.push([col, val]); return this; }
  order() { return this; }
  limit() { return this; }
  single() { this.single_ = true; return this._run(); }
  maybeSingle() { this.maybe_ = true; return this._run(); }
  then(resolve, reject) { return this._run().then(resolve, reject); }

  _match(rows) { return rows.filter((r) => this.filters.every(([c, v]) => r[c] === v)); }
  async _run() {
    const t = this.store.tables[this.table] || (this.store.tables[this.table] = new Map());
    if (this.op === 'select') {
      const rows = this._match([...t.values()]).map((r) => ({ ...r }));
      if (this.single_ || this.maybe_) return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }
    if (this.op === 'insert') {
      const row = { ...this.payload };
      if (this.table === 'notifications') this.store.notifications.push({ ...row });
      else if (this.table === 'health_audit_logs') this.store.audit.push({ ...row });
      return { data: { ...row }, error: null };
    }
    if (this.op === 'update') {
      const rows = this._match([...t.values()]);
      let updated = null;
      for (const r of rows) { Object.assign(r, this.payload); updated = r; }
      return { data: updated ? { ...updated } : null, error: null };
    }
    return { data: null, error: null };
  }
}

const makeStore = () => {
  const store = { tables: { follow_ups: new Map() }, residents: new Map(), notifications: [], audit: [] };
  store.tables.residents = store.residents;
  store.client = { from: (table) => new FakeQuery(store, table) };
  return store;
};

let store;
const supabase = () => store.client;
const seedFollowUp = (id, over = {}) => {
  const row = {
    id, resident_id: 'RES-1', purpose: 'BP check', scheduled_date: '2026-11-05', scheduled_time: '09:30:00',
    location: 'BHS', assigned_provider: 'Midwife', priority: 'High', status: 'Pending', notes: 'bring log',
    requires_resident_response: true, resident_decision: 'pending', resident_decision_at: null,
    resident_decision_reason: '', created_by: 'hs-1', municipality_id: 'M1', barangay_id: 'brgy-1',
    created_at: '2026-11-01T00:00:00Z', ...over,
  };
  store.tables.follow_ups.set(id, row);
  return row;
};

beforeEach(() => {
  store = makeStore();
  store.residents.set('RES-1', { id: 'RES-1', barangay: 'San Isidro', barangay_id: 'brgy-1', municipality_id: 'M1', auth_user_id: 'auth-res-1' });
  store.residents.set('RES-2', { id: 'RES-2', barangay: 'San Antonio', barangay_id: 'brgy-2', municipality_id: 'M1', auth_user_id: 'auth-res-2' });
});

const RES1 = { id: 'auth-res-1', role: 'resident-limited' };
const RES2 = { id: 'auth-res-2', role: 'resident' };
const NO_RESIDENT = { id: 'auth-nobody', role: 'resident' };

test('listOwn returns only the caller\'s follow-ups in a resident-safe shape', async () => {
  seedFollowUp('fu-1');
  seedFollowUp('fu-2', { resident_id: 'RES-2' });
  const rows = await service.listOwn({ user: RES1, supabase: supabase() });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'fu-1');
  assert.equal(rows[0].confirmationStatus, 'Awaiting Confirmation');
  // No staff/internal fields leak to the resident.
  for (const leak of ['resident_id', 'created_by', 'barangay_id', 'municipality_id']) {
    assert.ok(!(leak in rows[0]), `must not expose ${leak}`);
  }
});

test('getOwn returns an owned follow-up but 404s another resident\'s (IDOR)', async () => {
  seedFollowUp('fu-1');
  seedFollowUp('fu-2', { resident_id: 'RES-2' });
  const own = await service.getOwn({ user: RES1, id: 'fu-1', supabase: supabase() });
  assert.equal(own.id, 'fu-1');
  await assert.rejects(() => service.getOwn({ user: RES1, id: 'fu-2', supabase: supabase() }), (e) => e.statusCode === 404);
});

test('approveOwn sets Scheduled + approved + timestamp and notifies the creating staff', async () => {
  seedFollowUp('fu-1');
  const res = await service.approveOwn({ user: RES1, id: 'fu-1', supabase: supabase() });
  assert.equal(res.status, 'Scheduled');
  assert.equal(res.confirmationStatus, 'Confirmed');
  const row = store.tables.follow_ups.get('fu-1');
  assert.equal(row.resident_decision, 'approved');
  assert.ok(row.resident_decision_at);
  assert.equal(store.notifications.length, 1);
  assert.equal(store.notifications[0].title, 'Resident approved follow-up');
  assert.equal(store.notifications[0].recipient_id, 'hs-1'); // the creator, not the resident
  assert.ok(store.audit.some((a) => a.action === 'FOLLOWUP_RESIDENT_APPROVED'));
});

test('rejectOwn requires a reason, then sets Cancelled + rejected + reason and notifies staff', async () => {
  seedFollowUp('fu-1');
  await assert.rejects(() => service.rejectOwn({ user: RES1, id: 'fu-1', reason: '  ', supabase: supabase() }), (e) => e.statusCode === 422);
  const res = await service.rejectOwn({ user: RES1, id: 'fu-1', reason: 'Cannot attend', supabase: supabase() });
  assert.equal(res.status, 'Cancelled');
  assert.equal(res.confirmationStatus, 'Rejected');
  assert.equal(res.rejectionReason, 'Cannot attend');
  const row = store.tables.follow_ups.get('fu-1');
  assert.equal(row.resident_decision, 'rejected');
  assert.equal(row.resident_decision_reason, 'Cannot attend');
  assert.equal(store.notifications.at(-1).title, 'Resident rejected follow-up');
});

test('duplicate / conflicting decisions are rejected with 409', async () => {
  seedFollowUp('fu-1');
  await service.approveOwn({ user: RES1, id: 'fu-1', supabase: supabase() });
  await assert.rejects(() => service.approveOwn({ user: RES1, id: 'fu-1', supabase: supabase() }), (e) => e.statusCode === 409);
  await assert.rejects(() => service.rejectOwn({ user: RES1, id: 'fu-1', reason: 'x', supabase: supabase() }), (e) => e.statusCode === 409);

  seedFollowUp('fu-2');
  await service.rejectOwn({ user: RES1, id: 'fu-2', reason: 'no', supabase: supabase() });
  await assert.rejects(() => service.approveOwn({ user: RES1, id: 'fu-2', supabase: supabase() }), (e) => e.statusCode === 409);
});

test('a resident can respond to their own open follow-up even if it was not flagged requires_resident_response', async () => {
  // Health-team scheduled follow-ups (no explicit confirmation flag) are still
  // confirmable/rejectable by the resident they belong to.
  seedFollowUp('fu-1', { requires_resident_response: false, resident_decision: null, status: 'Scheduled' });
  const listed = await service.listOwn({ user: RES1, supabase: supabase() });
  assert.equal(listed[0].confirmationStatus, 'Awaiting Confirmation');
  const res = await service.approveOwn({ user: RES1, id: 'fu-1', supabase: supabase() });
  assert.equal(res.status, 'Scheduled');
  assert.equal(res.confirmationStatus, 'Confirmed');
  assert.equal(store.tables.follow_ups.get('fu-1').resident_decision, 'approved');
});

test('a completed/terminal follow-up can no longer be responded to (409)', async () => {
  seedFollowUp('fu-c', { resident_decision: null, status: 'Completed' });
  await assert.rejects(() => service.approveOwn({ user: RES1, id: 'fu-c', supabase: supabase() }), (e) => e.statusCode === 409);
});

test('IDOR: a resident cannot approve or reject another resident\'s follow-up (404) and it stays unchanged', async () => {
  seedFollowUp('fu-2', { resident_id: 'RES-2' });
  await assert.rejects(() => service.approveOwn({ user: RES1, id: 'fu-2', supabase: supabase() }), (e) => e.statusCode === 404);
  await assert.rejects(() => service.rejectOwn({ user: RES1, id: 'fu-2', reason: 'x', supabase: supabase() }), (e) => e.statusCode === 404);
  const row = store.tables.follow_ups.get('fu-2');
  assert.equal(row.resident_decision, 'pending');
  assert.equal(row.status, 'Pending');
  assert.equal(store.notifications.length, 0);
});

test('a session with no linked resident record is 404 (no cross-account access)', async () => {
  seedFollowUp('fu-1');
  await assert.rejects(() => service.listOwn({ user: NO_RESIDENT, supabase: supabase() }), (e) => e.statusCode === 404);
  await assert.rejects(() => service.approveOwn({ user: NO_RESIDENT, id: 'fu-1', supabase: supabase() }), (e) => e.statusCode === 404);
});

test('a verified resident (role "resident") can act on their own follow-up too', async () => {
  seedFollowUp('fu-9', { resident_id: 'RES-2' });
  const res = await service.approveOwn({ user: RES2, id: 'fu-9', supabase: supabase() });
  assert.equal(res.status, 'Scheduled');
});

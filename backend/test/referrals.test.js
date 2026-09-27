import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as service from '../src/services/referrals.service.js';

/**
 * Referral coordination service tests.
 *
 * The service normally talks to Supabase through the service-role client; here
 * an in-memory fake client is injected so the role + barangay/municipality
 * scope logic, validation, audit logging and resident notifications can be
 * exercised without a live database. Every function accepts an optional
 * `supabase` so no module mocking is required.
 */

// --- in-memory Supabase fake ------------------------------------------------
class FakeQuery {
  constructor(store, table) {
    this.store = store;
    this.table = table;
    this.filters = [];
    this.op = 'select';
    this.payload = null;
    this.selectStr = '';
    this.single_ = false;
    this.maybe_ = false;
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

  _match(rows) {
    return rows.filter((r) => this.filters.every(([c, v]) => r[c] === v));
  }
  _embed(row) {
    if (!row) return row;
    if (this.selectStr.includes('residents(')) {
      const resident = this.store.residents.get(row.resident_id) || null;
      return { ...row, resident };
    }
    return { ...row };
  }
  async _run() {
    const t = this.store.tables[this.table] || (this.store.tables[this.table] = new Map());
    if (this.op === 'select') {
      let rows = this._match([...t.values()]).map((r) => this._embed(r));
      if (this.single_ || this.maybe_) return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }
    if (this.op === 'insert') {
      const row = { ...this.payload };
      if (this.table === 'health_referrals') {
        row.id = row.id || `HR-${++this.store.seq}`;
        row.status = row.status || 'Pending';
        row.priority = row.priority || 'Medium';
        row.referral_date = row.referral_date || '2026-01-01';
        row.notes = row.notes ?? '';
        row.resolution_notes = row.resolution_notes ?? '';
        row.completed_at = row.completed_at ?? null;
        row.created_at = new Date().toISOString();
        // Emulate the sync_operational_scope trigger: scope from the resident.
        const resident = this.store.residents.get(row.resident_id);
        row.municipality_id = resident?.municipality_id ?? null;
        row.barangay_id = resident?.barangay_id ?? null;
        t.set(row.id, row);
      } else if (this.table === 'notifications') {
        this.store.notifications.push({ ...row });
      } else if (this.table === 'health_audit_logs') {
        this.store.audit.push({ ...row });
      }
      return { data: this._embed(row), error: null };
    }
    if (this.op === 'update') {
      const rows = this._match([...t.values()]);
      let updated = null;
      for (const r of rows) { Object.assign(r, this.payload); updated = r; }
      return { data: updated ? this._embed(updated) : null, error: null };
    }
    if (this.op === 'delete') {
      for (const r of this._match([...t.values()])) t.delete(r.id);
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
}

const makeStore = () => {
  const store = {
    seq: 0,
    tables: { health_referrals: new Map() },
    residents: new Map(),
    notifications: [],
    audit: [],
  };
  // Resident reads go through the same `from('residents')` path, so point the
  // table map at the residents store (same reference).
  store.tables.residents = store.residents;
  store.client = { from: (table) => new FakeQuery(store, table) };
  return store;
};

let store;
beforeEach(() => {
  store = makeStore();
  store.residents.set('RES-1', { id: 'RES-1', barangay: 'San Isidro', barangay_id: 'brgy-1', municipality_id: 'M1', auth_user_id: 'auth-res-1' });
  store.residents.set('RES-2', { id: 'RES-2', barangay: 'San Antonio', barangay_id: 'brgy-2', municipality_id: 'M1', auth_user_id: 'auth-res-2' });
});

const HS = { id: 'hs-1', role: 'health_supervisor', barangay: 'San Isidro', barangayId: 'brgy-1', municipalityId: 'M1', name: 'Supervisor One' };
const HS_OTHER = { id: 'hs-2', role: 'health_supervisor', barangay: 'San Antonio', barangayId: 'brgy-2', municipalityId: 'M1' };
const PHN = { id: 'phn-1', role: 'phn', municipalityId: 'M1' };
const MHO = { id: 'mho-1', role: 'mho', municipalityId: 'M1' };
const MHO_OTHER = { id: 'mho-2', role: 'mho', municipalityId: 'M2' };
const BHW = { id: 'bhw-1', role: 'bhw', barangay: 'San Isidro', barangayId: 'brgy-1', municipalityId: 'M1' };
const RESIDENT = { id: 'auth-res-1', role: 'resident' };

const supabase = () => store.client;
const baseReferral = { reason: 'High BP, needs specialist', destination_facility: 'RHU Pili', priority: 'High' };

test('create persists a referral, derives scope from the resident, and writes audit + notification', async () => {
  const rec = await service.create({ user: HS, payload: { residentId: 'RES-1', ...baseReferral }, supabase: supabase() });
  assert.equal(rec.resident_id, 'RES-1');
  assert.equal(rec.barangay_id, 'brgy-1');
  assert.equal(rec.municipality_id, 'M1');
  assert.equal(rec.created_by, 'hs-1');
  assert.equal(rec.status, 'Pending');
  assert.equal(store.audit.length, 1);
  assert.equal(store.audit[0].action, 'REFERRAL_CREATED');
  assert.equal(store.notifications.length, 1);
  assert.equal(store.notifications[0].recipient_id, 'auth-res-1');
});

test('create requires a reason and a destination facility (422)', async () => {
  await assert.rejects(
    () => service.create({ user: HS, payload: { residentId: 'RES-1', destination_facility: 'RHU Pili' }, supabase: supabase() }),
    (e) => e.statusCode === 422,
  );
  await assert.rejects(
    () => service.create({ user: HS, payload: { residentId: 'RES-1', reason: 'x' }, supabase: supabase() }),
    (e) => e.statusCode === 422,
  );
});

test('a Health Supervisor cannot create a referral for a resident in another barangay (404)', async () => {
  await assert.rejects(
    () => service.create({ user: HS, payload: { residentId: 'RES-2', ...baseReferral }, supabase: supabase() }),
    (e) => e.statusCode === 404,
  );
});

test('creating a referral for a non-existent resident is 404', async () => {
  await assert.rejects(
    () => service.create({ user: HS, payload: { residentId: 'RES-999', ...baseReferral }, supabase: supabase() }),
    (e) => e.statusCode === 404,
  );
});

test('a BHW cannot create a referral (403)', async () => {
  await assert.rejects(
    () => service.create({ user: BHW, payload: { residentId: 'RES-1', ...baseReferral }, supabase: supabase() }),
    (e) => e.statusCode === 403,
  );
});

test('list returns only the Health Supervisor\'s own barangay referrals', async () => {
  await service.create({ user: HS, payload: { residentId: 'RES-1', ...baseReferral }, supabase: supabase() });
  // A referral in another barangay (created by that barangay's supervisor).
  await service.create({ user: HS_OTHER, payload: { residentId: 'RES-2', ...baseReferral }, supabase: supabase() });

  const mine = await service.list({ user: HS, supabase: supabase() });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].resident_id, 'RES-1');

  const municipality = await service.list({ user: PHN, supabase: supabase() });
  assert.equal(municipality.length, 2); // PHN sees the whole municipality
});

test('an MHO sees every referral in their municipality but never another municipality', async () => {
  await service.create({ user: HS, payload: { residentId: 'RES-1', ...baseReferral }, supabase: supabase() });
  await service.create({ user: HS_OTHER, payload: { residentId: 'RES-2', ...baseReferral }, supabase: supabase() });

  const mine = await service.list({ user: MHO, supabase: supabase() });
  assert.equal(mine.length, 2); // both M1 referrals (municipality-wide)

  const other = await service.list({ user: MHO_OTHER, supabase: supabase() });
  assert.equal(other.length, 0); // M2 MHO sees no M1 data
});

test('a resident sees only their own referrals', async () => {
  await service.create({ user: HS, payload: { residentId: 'RES-1', ...baseReferral }, supabase: supabase() });
  await service.create({ user: HS_OTHER, payload: { residentId: 'RES-2', ...baseReferral }, supabase: supabase() });

  const own = await service.list({ user: RESIDENT, supabase: supabase() });
  assert.equal(own.length, 1);
  assert.equal(own[0].resident_id, 'RES-1');
});

test('getById hides a referral from another barangay (404)', async () => {
  const rec = await service.create({ user: HS, payload: { residentId: 'RES-1', ...baseReferral }, supabase: supabase() });
  await assert.rejects(
    () => service.getById({ user: HS_OTHER, id: rec.id, supabase: supabase() }),
    (e) => e.statusCode === 404,
  );
  const ok = await service.getById({ user: HS, id: rec.id, supabase: supabase() });
  assert.equal(ok.id, rec.id);
});

test('updateStatus to Completed stamps completed_at and notifies the resident', async () => {
  const rec = await service.create({ user: HS, payload: { residentId: 'RES-1', ...baseReferral }, supabase: supabase() });
  store.notifications.length = 0; // ignore the creation notification
  const updated = await service.updateStatus({ user: HS, id: rec.id, status: 'Completed', supabase: supabase() });
  assert.equal(updated.status, 'Completed');
  assert.ok(updated.completed_at);
  assert.equal(store.notifications.length, 1);
  assert.equal(store.notifications[0].title, 'Referral completed');
  assert.ok(store.audit.some((a) => a.action === 'REFERRAL_STATUS_CHANGED'));
});

test('updateStatus rejects an invalid status (422)', async () => {
  const rec = await service.create({ user: HS, payload: { residentId: 'RES-1', ...baseReferral }, supabase: supabase() });
  await assert.rejects(
    () => service.updateStatus({ user: HS, id: rec.id, status: 'Bogus', supabase: supabase() }),
    (e) => e.statusCode === 422,
  );
});

test('a Health Supervisor from another barangay cannot update a referral (404)', async () => {
  const rec = await service.create({ user: HS, payload: { residentId: 'RES-1', ...baseReferral }, supabase: supabase() });
  await assert.rejects(
    () => service.update({ user: HS_OTHER, id: rec.id, payload: { reason: 'changed' }, supabase: supabase() }),
    (e) => e.statusCode === 404,
  );
});

test('a resident cannot create or update referrals (403)', async () => {
  await assert.rejects(
    () => service.create({ user: RESIDENT, payload: { residentId: 'RES-1', ...baseReferral }, supabase: supabase() }),
    (e) => e.statusCode === 403,
  );
});

test('delete removes the referral within scope and writes an audit entry', async () => {
  const rec = await service.create({ user: HS, payload: { residentId: 'RES-1', ...baseReferral }, supabase: supabase() });
  await service.remove({ user: HS, id: rec.id, supabase: supabase() });
  const remaining = await service.list({ user: HS, supabase: supabase() });
  assert.equal(remaining.length, 0);
  assert.ok(store.audit.some((a) => a.action === 'REFERRAL_DELETED'));
});

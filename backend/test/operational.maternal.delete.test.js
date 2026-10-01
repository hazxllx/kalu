import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as service from '../src/services/operational.service.js';

/**
 * Maternal record deletion (spec PART 13).
 *
 * A deleted maternal record must stop counting toward Monthly / Quarterly /
 * Annual reports, so deletion has to actually remove the persisted row. These
 * tests inject a tiny in-memory Supabase stand-in to prove the service:
 *   - deletes the row from maternal_records,
 *   - re-checks the record's resident is inside the caller's barangay scope
 *     BEFORE deleting (a Health Supervisor cannot delete another barangay's
 *     record), and
 *   - refuses to delete non-maternal operational kinds.
 */

class FakeQuery {
  constructor(store, table) {
    this.store = store;
    this.table = table;
    this.filters = [];
    this.op = 'select';
    this.payload = null;
    this.single_ = false;
    this.maybe_ = false;
  }
  select() { if (!['insert', 'delete'].includes(this.op)) this.op = 'select'; return this; }
  insert(row) { this.op = 'insert'; this.payload = row; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  maybeSingle() { this.maybe_ = true; return this._run(); }
  single() { this.single_ = true; return this._run(); }
  then(resolve, reject) { return this._run().then(resolve, reject); }

  _table() { return this.store.tables[this.table] || (this.store.tables[this.table] = new Map()); }
  _match(rows) { return rows.filter((r) => this.filters.every((f) => f(r))); }
  async _run() {
    const t = this._table();
    if (this.op === 'select') {
      const rows = this._match([...t.values()]);
      if (this.single_ || this.maybe_) return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }
    if (this.op === 'insert') {
      const row = { ...this.payload, id: this.payload.id || `X-${++this.store.seq}` };
      t.set(row.id, row);
      return { data: row, error: null };
    }
    if (this.op === 'delete') {
      for (const r of this._match([...t.values()])) t.delete(r.id);
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
}

let store;
let sb;
beforeEach(() => {
  store = {
    seq: 0,
    tables: {
      maternal_records: new Map(),
      residents: new Map(),
      health_audit_logs: new Map(),
    },
  };
  store.tables.residents.set('RES-1', { id: 'RES-1', barangay: 'San Isidro', barangay_id: 'brgy-1', municipality_id: 'M1', auth_user_id: null });
  store.tables.residents.set('RES-2', { id: 'RES-2', barangay: 'San Antonio', barangay_id: 'brgy-2', municipality_id: 'M1', auth_user_id: null });
  store.tables.maternal_records.set('MAT-1', { id: 'MAT-1', resident_id: 'RES-1', barangay_id: 'brgy-1', municipality_id: 'M1', status: 'Active' });
  store.tables.maternal_records.set('MAT-2', { id: 'MAT-2', resident_id: 'RES-2', barangay_id: 'brgy-2', municipality_id: 'M1', status: 'Active' });
  sb = { from: (table) => new FakeQuery(store, table) };
});

const HS = { id: 'hs-1', role: 'health_supervisor', barangay: 'San Isidro', barangayId: 'brgy-1', municipalityId: 'M1' };

test('remove deletes a maternal record in the caller barangay', async () => {
  const res = await service.remove({ user: HS, kind: 'maternal', id: 'MAT-1', supabase: sb });
  assert.deepEqual(res, { id: 'MAT-1' });
  assert.equal(store.tables.maternal_records.has('MAT-1'), false); // actually removed
  assert.equal(store.tables.health_audit_logs.size, 1); // audited
});

test('remove refuses a maternal record from another barangay', async () => {
  await assert.rejects(
    service.remove({ user: HS, kind: 'maternal', id: 'MAT-2', supabase: sb }),
    (e) => e.statusCode === 404,
  );
  assert.equal(store.tables.maternal_records.has('MAT-2'), true); // untouched
});

test('remove rejects a missing record', async () => {
  await assert.rejects(
    service.remove({ user: HS, kind: 'maternal', id: 'NOPE', supabase: sb }),
    (e) => e.statusCode === 404,
  );
});

test('remove refuses non-maternal operational kinds', async () => {
  await assert.rejects(
    service.remove({ user: HS, kind: 'followups', id: 'MAT-1', supabase: sb }),
    (e) => e.statusCode === 403,
  );
});

test('remove refuses a non-staff caller', async () => {
  const resident = { id: 'r-9', role: 'resident' };
  await assert.rejects(
    service.remove({ user: resident, kind: 'maternal', id: 'MAT-1', supabase: sb }),
    (e) => e.statusCode === 403,
  );
});

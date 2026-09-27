import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as service from '../src/services/m1.service.js';
import { getIndicator } from '../src/config/m1Catalog.js';

/**
 * FHSIS M1 service tests — an in-memory fake Supabase client is injected so the
 * scope logic, catalog validation, aggregation math (unique residents vs
 * events, age/sex breakdown), source adapters (immunizations, households,
 * mortality), annual matrix and drill-down are exercised without a live DB.
 */

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
    this.onConflict = null;
  }
  select(str) { this.selectStr = str || ''; if (!['insert', 'update', 'delete', 'upsert'].includes(this.op)) this.op = 'select'; return this; }
  insert(row) { this.op = 'insert'; this.payload = row; return this; }
  upsert(row, opts) { this.op = 'upsert'; this.payload = row; this.onConflict = opts?.onConflict; return this; }
  update(row) { this.op = 'update'; this.payload = row; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  gte(col, val) { this.filters.push((r) => r[col] != null && String(r[col]) >= String(val)); return this; }
  lte(col, val) { this.filters.push((r) => r[col] != null && String(r[col]) <= String(val)); return this; }
  in(col, vals) { this.filters.push((r) => vals.includes(r[col])); return this; }
  order() { return this; }
  limit() { return this; }
  single() { this.single_ = true; return this._run(); }
  maybeSingle() { this.maybe_ = true; return this._run(); }
  then(resolve, reject) { return this._run().then(resolve, reject); }

  _match(rows) { return rows.filter((r) => this.filters.every((f) => f(r))); }
  _embed(row) {
    if (!row) return row;
    const out = { ...row };
    if (this.selectStr.includes('resident:residents(')) out.resident = this.store.residents.get(row.resident_id) || null;
    if (this.selectStr.includes('member:household_members(')) out.member = this.store.members.get(row.household_member_id) || null;
    if (this.selectStr.includes('municipalities(')) out.municipalities = this.store.municipalities.get(row.municipality_id) || null;
    return out;
  }
  _table() { return this.store.tables[this.table] || (this.store.tables[this.table] = new Map()); }
  async _run() {
    const t = this._table();
    if (this.op === 'select') {
      const rows = this._match([...t.values()]).map((r) => this._embed(r));
      if (this.single_ || this.maybe_) return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }
    if (this.op === 'insert') {
      const row = { ...this.payload };
      if (this.table === 'm1_records') {
        row.id = row.id || `M1-${++this.store.seq}`;
        // Emulate sync_m1_scope trigger.
        if (row.resident_id) {
          const r = this.store.residents.get(row.resident_id);
          row.municipality_id = r?.municipality_id ?? null;
          row.barangay_id = r?.barangay_id ?? null;
        } else if (row.household_id) {
          const h = this.store.tables.households.get(row.household_id);
          row.municipality_id = h?.municipality_id ?? null;
          row.barangay_id = h?.barangay_id ?? null;
        } else if (row.barangay_id) {
          const b = this.store.barangays.get(row.barangay_id);
          row.municipality_id = b?.municipality_id ?? null;
        }
        row.value = row.value ?? 1;
        row.detail = row.detail ?? {};
        row.status = row.status ?? 'Completed';
        t.set(row.id, row);
        return { data: this._embed(row), error: null };
      }
      if (this.table === 'health_audit_logs') { this.store.audit.push({ ...row }); return { data: row, error: null }; }
      t.set(row.id || `X-${++this.store.seq}`, row);
      return { data: row, error: null };
    }
    if (this.op === 'upsert') {
      const row = { ...this.payload, id: this.payload.id || `U-${++this.store.seq}` };
      t.set(row.id, row);
      return { data: row, error: null };
    }
    if (this.op === 'update') {
      let updated = null;
      for (const r of this._match([...t.values()])) { Object.assign(r, this.payload); updated = r; }
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
    tables: {
      m1_records: new Map(),
      households: new Map(),
      immunizations: new Map(),
      household_member_health_profiles: new Map(),
      m1_indicator_remarks: new Map(),
      m1_report_meta: new Map(),
      barangays: new Map(),
      m1_indicators: new Map(),
    },
    residents: new Map(),
    members: new Map(),
    barangays: new Map(),
    municipalities: new Map(),
    audit: [],
  };
  store.tables.residents = store.residents;
  store.tables.barangays = store.barangays;
  store.client = { from: (table) => new FakeQuery(store, table) };
  return store;
};

// Residents: RES-1 (brgy-1) female age ~25 -> 20-49; RES-3 female age ~17 -> 15-19.
let store;
let sb;
beforeEach(() => {
  store = makeStore();
  sb = store.client;
  store.residents.set('RES-1', { id: 'RES-1', first_name: 'Maria', last_name: 'Santos', barangay: 'San Isidro', barangay_id: 'brgy-1', municipality_id: 'M1', birth_date: '2001-01-01', sex: 'Female' });
  store.residents.set('RES-2', { id: 'RES-2', first_name: 'Ana', last_name: 'Cruz', barangay: 'San Antonio', barangay_id: 'brgy-2', municipality_id: 'M1', birth_date: '2000-01-01', sex: 'Female' });
  store.residents.set('RES-3', { id: 'RES-3', first_name: 'Liza', last_name: 'Reyes', barangay: 'San Isidro', barangay_id: 'brgy-1', municipality_id: 'M1', birth_date: '2009-06-01', sex: 'Female' });
  store.barangays.set('brgy-1', { id: 'brgy-1', name: 'San Isidro', municipality_id: 'M1', health_station_name: 'San Isidro BHS' });
  store.barangays.set('brgy-2', { id: 'brgy-2', name: 'San Antonio', municipality_id: 'M1' });
  store.municipalities.set('M1', { name: 'Baler', province: 'Aurora' });
});

const HS = { id: 'hs-1', role: 'health_supervisor', barangay: 'San Isidro', barangayId: 'brgy-1', municipalityId: 'M1' };
const HS_OTHER = { id: 'hs-2', role: 'health_supervisor', barangay: 'San Antonio', barangayId: 'brgy-2', municipalityId: 'M1' };
const MHO = { id: 'mho-1', role: 'mho', municipalityId: 'M1' };

const seedRecord = (over = {}) => {
  const id = `M1-seed-${++store.seq}`;
  const row = {
    id,
    indicator_code: 'B1_1',
    resident_id: 'RES-1',
    household_id: null,
    barangay_id: 'brgy-1',
    municipality_id: 'M1',
    record_date: '2026-09-10',
    value: 1,
    sex: '',
    age_group: '',
    status: 'Completed',
    detail: {},
    remarks: '',
    ...over,
  };
  store.tables.m1_records.set(id, row);
  return row;
};

// --- scope --------------------------------------------------------------------
test('resolveScope forces a barangay-scoped user to their own barangay', () => {
  // requesting another barangay must throw
  assert.throws(() => service.resolveScope(HS, 'brgy-2'), /only access your assigned barangay/);
  const own = service.resolveScope(HS, 'brgy-1');
  assert.equal(own.barangayId, 'brgy-1');
  assert.equal(own.level, 'barangay');
  // no requested barangay -> defaults to the user's own
  assert.equal(service.resolveScope(HS).barangayId, 'brgy-1');
});

test('resolveScope rejects unauthorized roles', () => {
  assert.throws(() => service.resolveScope({ role: 'resident' }), /not authorized/);
});

// --- catalog validation on write ---------------------------------------------
test('createRecord rejects unknown indicator codes', async () => {
  await assert.rejects(
    service.createRecord({ user: HS, payload: { indicator_code: 'NOPE', residentId: 'RES-1' }, supabase: sb }),
    /Unknown M1 indicator/,
  );
});

test('createRecord refuses indicators sourced from existing tables', async () => {
  await assert.rejects(
    service.createRecord({ user: HS, payload: { indicator_code: 'C1_2', residentId: 'RES-1' }, supabase: sb }),
    /aggregated from existing/,
  );
});

test('createRecord stores an underlying event scoped to the resident', async () => {
  const rec = await service.createRecord({
    user: HS,
    payload: { indicator_code: 'B1_1', residentId: 'RES-1', record_date: '2026-09-05' },
    supabase: sb,
  });
  assert.equal(rec.indicator_code, 'B1_1');
  assert.equal(rec.barangay_id, 'brgy-1');
  assert.equal(rec.resident_id, 'RES-1');
});

test('createRecord blocks a resident outside the caller barangay', async () => {
  await assert.rejects(
    service.createRecord({ user: HS, payload: { indicator_code: 'B1_1', residentId: 'RES-2' }, supabase: sb }),
    /not found/,
  );
});

// --- monthly aggregation ------------------------------------------------------
test('monthlyReport counts unique residents (not events) for a unique-person indicator', async () => {
  seedRecord({ indicator_code: 'A1_1', resident_id: 'RES-1', record_date: '2026-09-03' });
  seedRecord({ indicator_code: 'A1_1', resident_id: 'RES-1', record_date: '2026-09-20' }); // same resident twice
  seedRecord({ indicator_code: 'A1_1', resident_id: 'RES-3', record_date: '2026-09-11' });
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 9, supabase: sb });
  const a1 = report.byCode.A1_1;
  assert.equal(a1.total, 2); // two unique residents despite three records
  assert.equal(a1.byAge['20-49'], 1); // RES-1
  assert.equal(a1.byAge['15-19'], 1); // RES-3 (age ~17)
});

test('monthlyReport counts events for an event indicator', async () => {
  seedRecord({ indicator_code: 'B2_18', resident_id: 'RES-1', record_date: '2026-09-03' });
  seedRecord({ indicator_code: 'B2_18', resident_id: 'RES-1', record_date: '2026-09-15' });
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 9, supabase: sb });
  assert.equal(report.byCode.B2_18.total, 2);
});

test('monthlyReport excludes records from other barangays (scope isolation)', async () => {
  seedRecord({ indicator_code: 'B2_18', resident_id: 'RES-1', barangay_id: 'brgy-1', record_date: '2026-09-03' });
  seedRecord({ indicator_code: 'B2_18', resident_id: 'RES-2', barangay_id: 'brgy-2', municipality_id: 'M1', record_date: '2026-09-04' });
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 9, supabase: sb });
  assert.equal(report.byCode.B2_18.total, 1); // only brgy-1
});

test('monthlyReport aggregates immunizations from the existing table', async () => {
  store.tables.immunizations.set('IM-1', { id: 'IM-1', resident_id: 'RES-1', barangay_id: 'brgy-1', municipality_id: 'M1', vaccine: 'BCG', status: 'Completed', administered_date: '2026-09-08' });
  store.tables.immunizations.set('IM-2', { id: 'IM-2', resident_id: 'RES-3', barangay_id: 'brgy-1', municipality_id: 'M1', vaccine: 'BCG', status: 'Completed', administered_date: '2026-09-09' });
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 9, supabase: sb });
  assert.equal(report.byCode.C1_2.total, 2); // BCG
});

test('monthlyReport aggregates households WASH from the existing table', async () => {
  store.tables.households.set('HH-1', { id: 'HH-1', barangay_id: 'brgy-1', municipality_id: 'M1', water_source: 'level3', toilet_type: 'ws_own' });
  store.tables.households.set('HH-2', { id: 'HH-2', barangay_id: 'brgy-1', municipality_id: 'M1', water_source: 'level1', toilet_type: 'none' });
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 9, supabase: sb });
  assert.equal(report.byCode.G_1.total, 2); // both have basic safe water (level1/level3)
  assert.equal(report.byCode.G_1_3.total, 1); // one level III
  assert.equal(report.byCode.G_3_1.total, 1); // one septic (ws_own)
});

test('monthlyReport aggregates mortality from member health profiles', async () => {
  store.members.set('MB-1', { id: 'MB-1', name: 'X', sex: 'Male', birthday: '1950-01-01' });
  store.tables.household_member_health_profiles.set('HP-1', { id: 'HP-1', household_member_id: 'MB-1', barangay_id: 'brgy-1', municipality_id: 'M1', date_of_death: '2026-09-12' });
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 9, supabase: sb });
  assert.equal(report.byCode.H1_1.total, 1);
  assert.equal(report.byCode.H1_1.bySex.Male, 1);
});

test('monthlyReport includes every indicator, even zeros', async () => {
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 9, supabase: sb });
  assert.equal(report.indicators.length, 178);
  assert.equal(report.byCode.E8_2.total, 0); // rabies deaths, no records -> 0 (not hidden)
});

// --- FP current users ---------------------------------------------------------
test('monthlyReport computes FP current users from begin + new + other - dropout', async () => {
  seedRecord({ indicator_code: 'A2_coc', resident_id: 'RES-1', detail: { measure: 'current_begin' }, record_date: '2026-09-01' });
  seedRecord({ indicator_code: 'A2_coc', resident_id: 'RES-3', detail: { measure: 'new_present' }, record_date: '2026-09-05' });
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 9, supabase: sb });
  assert.equal(report.byCode.A2_coc.total, 2); // 1 begin (20-49) + 1 new (15-19)
});

// --- annual -------------------------------------------------------------------
test('annualSummary produces a 12-month matrix with an annual total', async () => {
  seedRecord({ indicator_code: 'B2_19', resident_id: 'RES-1', record_date: '2026-03-10' });
  seedRecord({ indicator_code: 'B2_19', resident_id: 'RES-1', record_date: '2026-03-20' });
  seedRecord({ indicator_code: 'B2_19', resident_id: 'RES-3', record_date: '2026-11-02' });
  const summary = await service.annualSummary({ user: HS, year: 2026, supabase: sb });
  const b2 = summary.indicators.find((i) => i.code === 'B2_19');
  assert.equal(b2.months[2], 2); // March index 2
  assert.equal(b2.months[10], 1); // November index 10
  assert.equal(b2.annual, 3);
});

test('annualSummary dedups unique-resident indicators per year', async () => {
  seedRecord({ indicator_code: 'A1_1', resident_id: 'RES-1', record_date: '2026-01-10' });
  seedRecord({ indicator_code: 'A1_1', resident_id: 'RES-1', record_date: '2026-07-10' });
  const summary = await service.annualSummary({ user: HS, year: 2026, supabase: sb });
  const a1 = summary.indicators.find((i) => i.code === 'A1_1');
  assert.equal(a1.annual, 1); // one unique resident across the year
});

// --- drilldown ----------------------------------------------------------------
test('drilldown returns the underlying records behind a total', async () => {
  seedRecord({ indicator_code: 'B1_1', resident_id: 'RES-1', record_date: '2026-09-03' });
  seedRecord({ indicator_code: 'B1_1', resident_id: 'RES-3', record_date: '2026-09-04' });
  const dd = await service.drilldown({ user: HS, indicatorCode: 'B1_1', year: 2026, month: 9, supabase: sb });
  assert.equal(dd.count, 2);
  assert.equal(dd.records[0].resident.id, 'RES-1');
  assert.equal(dd.indicator.code, 'B1_1');
});

test('drilldown enforces barangay scope', async () => {
  seedRecord({ indicator_code: 'B1_1', resident_id: 'RES-2', barangay_id: 'brgy-2', municipality_id: 'M1', record_date: '2026-09-03' });
  const dd = await service.drilldown({ user: HS, indicatorCode: 'B1_1', year: 2026, month: 9, supabase: sb });
  assert.equal(dd.count, 0); // brgy-2 record invisible to brgy-1 supervisor
});

// --- report meta --------------------------------------------------------------
test('getReportMeta resolves the barangay header from scope', async () => {
  const meta = await service.getReportMeta({ user: HS, year: 2026, month: 9, supabase: sb });
  assert.equal(meta.barangay.name, 'San Isidro');
  assert.equal(meta.municipality, 'Baler');
  assert.equal(meta.province, 'Aurora');
});

test('catalog validates against the shared indicator definitions', () => {
  assert.equal(getIndicator('B1_1').section, 'B');
  assert.equal(getIndicator('C1_2').source, 'immunizations');
});

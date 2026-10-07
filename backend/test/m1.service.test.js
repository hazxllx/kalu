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
    if (this.selectStr.includes('household:households(')) {
      out.household = this.store.tables.households.get(row.household_id) || null;
    }
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
      // Emulate the m1_manual_entries scope trigger (municipality from barangay).
      const incoming = { ...this.payload };
      if (this.table === 'm1_manual_entries' && incoming.barangay_id) {
        const b = this.store.barangays.get(incoming.barangay_id);
        incoming.municipality_id = b?.municipality_id ?? null;
      }
      // Respect onConflict: update the existing row for the conflict key in
      // place (true upsert) instead of inserting an uncontrolled duplicate.
      if (this.onConflict) {
        const keys = this.onConflict.split(',').map((k) => k.trim());
        for (const r of t.values()) {
          if (keys.every((k) => r[k] === incoming[k])) {
            Object.assign(r, incoming);
            return { data: this._embed(r), error: null };
          }
        }
      }
      const row = { ...incoming, id: incoming.id || `U-${++this.store.seq}` };
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
      m1_manual_entries: new Map(),
      maternal_records: new Map(),
      households: new Map(),
      household_members: new Map(),
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

// Seed a maternal_records case (Section B is DERIVED from this table).
const seedMaternal = (over = {}) => {
  const id = `MAT-${++store.seq}`;
  const row = {
    id,
    resident_id: 'RES-1',
    barangay_id: 'brgy-1',
    municipality_id: 'M1',
    lmp: null,
    edd: null,
    prenatal_visits: 0,
    status: 'Delivered',
    delivery_date: null,
    delivery_outcome: '',
    type_of_delivery: '',
    place_of_delivery: '',
    birth_attendant: '',
    birth_weight: '',
    pp_checkup_24h: null,
    pp_checkup_day3: null,
    pp_checkup_7_14d: null,
    pp_checkup_6wk: null,
    iron_folic_completed_date: null,
    vitamin_a_given_date: null,
    ...over,
  };
  store.tables.maternal_records.set(id, row);
  return row;
};

// Seed a manual aggregate figure (m1_manual_entries).
const seedManual = (over = {}) => {
  const id = `MAN-${++store.seq}`;
  const b = store.barangays.get(over.barangay_id || 'brgy-1');
  const row = {
    id,
    indicator_code: 'B1_1',
    barangay_id: 'brgy-1',
    municipality_id: b?.municipality_id || 'M1',
    period_year: 2026,
    period_month: 9,
    age_group: 'Total',
    sex: '',
    value: 0,
    ...over,
  };
  store.tables.m1_manual_entries.set(id, row);
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
    payload: { indicator_code: 'A1_1', residentId: 'RES-1', record_date: '2026-09-05' },
    supabase: sb,
  });
  assert.equal(rec.indicator_code, 'A1_1');
  assert.equal(rec.barangay_id, 'brgy-1');
  assert.equal(rec.resident_id, 'RES-1');
});

test('createRecord blocks a resident outside the caller barangay', async () => {
  await assert.rejects(
    service.createRecord({ user: HS, payload: { indicator_code: 'A1_1', residentId: 'RES-2' }, supabase: sb }),
    /not found/,
  );
});

test('createRecord refuses manual-entry indicators (no per-event store)', async () => {
  // B1_1 is a manual aggregate indicator now; it is entered via saveManualEntry,
  // not the per-event create path.
  await assert.rejects(
    service.createRecord({ user: HS, payload: { indicator_code: 'B1_1', residentId: 'RES-1' }, supabase: sb }),
    /aggregated from existing|m1_manual|not recorded directly/,
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

test('monthlyReport derives deliveries from maternal_records by delivery_date', async () => {
  seedMaternal({ delivery_date: '2026-09-03' });
  seedMaternal({ delivery_date: '2026-09-15' });
  seedMaternal({ delivery_date: '2026-08-31' }); // previous month — excluded
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 9, supabase: sb });
  assert.equal(report.byCode.B2_18.total, 2);
  assert.equal(report.byCode.B2_18.source, 'maternal_records');
});

test('monthlyReport classifies derived deliveries from the maternal fields', async () => {
  seedMaternal({ delivery_date: '2026-09-03', type_of_delivery: 'Vaginal', place_of_delivery: 'Public Facility', birth_attendant: 'Midwife', delivery_outcome: 'Live Birth', birth_weight: '3.2 kg' });
  seedMaternal({ delivery_date: '2026-09-10', type_of_delivery: 'Cesarean', place_of_delivery: 'Private Facility', birth_attendant: 'Doctor', delivery_outcome: 'Live Birth', birth_weight: '2.1 kg' });
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 9, supabase: sb });
  assert.equal(report.byCode.B2_18.total, 2); // deliveries
  assert.equal(report.byCode.B2_26a.total, 1); // one vaginal
  assert.equal(report.byCode.B2_26b.total, 1); // one cesarean
  assert.equal(report.byCode.B2_21c.total, 1); // one midwife
  assert.equal(report.byCode.B2_21a.total, 1); // one doctor
  assert.equal(report.byCode.B2_21.total, 2); // both skilled
  assert.equal(report.byCode.B2_24a.total, 1); // one public facility
  assert.equal(report.byCode.B2_23.total, 2); // both facility-based
  assert.equal(report.byCode.B2_20a.total, 1); // 3.2kg normal
  assert.equal(report.byCode.B2_20b.total, 1); // 2.1kg low
});

test('monthlyReport sums manual aggregate figures by age band', async () => {
  seedManual({ indicator_code: 'B1_1', period_month: 9, age_group: '20-49', value: 3 });
  seedManual({ indicator_code: 'B1_1', period_month: 9, age_group: '15-19', value: 1 });
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 9, supabase: sb });
  assert.equal(report.byCode.B1_1.total, 4);
  assert.equal(report.byCode.B1_1.byAge['20-49'], 3);
  assert.equal(report.byCode.B1_1.byAge['15-19'], 1);
  assert.equal(report.byCode.B1_1.source, 'm1_manual');
});

test('monthlyReport excludes records from other barangays (scope isolation)', async () => {
  seedMaternal({ barangay_id: 'brgy-1', delivery_date: '2026-09-03' });
  seedMaternal({ resident_id: 'RES-2', barangay_id: 'brgy-2', municipality_id: 'M1', delivery_date: '2026-09-04' });
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
  seedMaternal({ delivery_date: '2026-03-10' });
  seedMaternal({ delivery_date: '2026-03-20' });
  seedMaternal({ delivery_date: '2026-11-02' });
  const summary = await service.annualSummary({ user: HS, year: 2026, supabase: sb });
  const b2 = summary.indicators.find((i) => i.code === 'B2_18');
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
  seedRecord({ indicator_code: 'A1_1', resident_id: 'RES-1', record_date: '2026-09-03' });
  seedRecord({ indicator_code: 'A1_1', resident_id: 'RES-3', record_date: '2026-09-04' });
  const dd = await service.drilldown({ user: HS, indicatorCode: 'A1_1', year: 2026, month: 9, supabase: sb });
  assert.equal(dd.count, 2);
  assert.equal(dd.records[0].resident.id, 'RES-1');
  assert.equal(dd.indicator.code, 'A1_1');
});

test('drilldown enforces barangay scope', async () => {
  seedRecord({ indicator_code: 'A1_1', resident_id: 'RES-2', barangay_id: 'brgy-2', municipality_id: 'M1', record_date: '2026-09-03' });
  const dd = await service.drilldown({ user: HS, indicatorCode: 'A1_1', year: 2026, month: 9, supabase: sb });
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

// --- period report (Monthly | Quarterly | Annual) ----------------------------
test('periodReport (monthly) aggregates only the selected month', async () => {
  seedMaternal({ delivery_date: '2026-10-05' });
  seedMaternal({ delivery_date: '2026-10-25' });
  seedMaternal({ delivery_date: '2026-09-30' }); // previous month
  seedMaternal({ delivery_date: '2026-11-01' }); // next month
  const report = await service.periodReport({ user: HS, period: 'monthly', year: 2026, month: 10, supabase: sb });
  assert.equal(report.period.period, 'monthly');
  assert.equal(report.byCode.B2_18.total, 2); // only October
});

test('periodReport (quarterly Q4) aggregates October + November + December', async () => {
  seedMaternal({ delivery_date: '2026-10-10' });
  seedMaternal({ delivery_date: '2026-11-15' });
  seedMaternal({ delivery_date: '2026-12-20' });
  seedMaternal({ delivery_date: '2026-09-30' }); // Q3 — excluded
  seedMaternal({ delivery_date: '2027-01-02' }); // next year — excluded
  const report = await service.periodReport({ user: HS, period: 'quarterly', year: 2026, quarter: 4, supabase: sb });
  assert.equal(report.period.quarter, 4);
  assert.equal(report.byCode.B2_18.total, 3); // Oct + Nov + Dec only
  assert.match(report.periodLabel, /4th Quarter/);
});

test('periodReport (quarterly) isolates each quarter (Q1 2027 excludes Dec 2026)', async () => {
  seedMaternal({ delivery_date: '2026-12-31' }); // Q4 2026
  seedMaternal({ delivery_date: '2027-01-15' }); // Q1 2027
  seedMaternal({ delivery_date: '2027-03-31' }); // Q1 2027
  const q1 = await service.periodReport({ user: HS, period: 'quarterly', year: 2027, quarter: 1, supabase: sb });
  assert.equal(q1.byCode.B2_18.total, 2); // Jan + Mar 2027 only, not Dec 2026
});

test('periodReport (annual) aggregates the whole year, excluding other years', async () => {
  seedMaternal({ delivery_date: '2026-01-10' });
  seedMaternal({ delivery_date: '2026-06-10' });
  seedMaternal({ delivery_date: '2026-12-10' });
  seedMaternal({ delivery_date: '2027-01-10' }); // next year — excluded
  const report = await service.periodReport({ user: HS, period: 'annual', year: 2026, supabase: sb });
  assert.equal(report.period.period, 'annual');
  assert.equal(report.byCode.B2_18.total, 3); // Jan + Jun + Dec 2026
});

test('periodReport respects barangay scope for quarterly and annual', async () => {
  seedMaternal({ barangay_id: 'brgy-1', delivery_date: '2026-10-10' });
  seedMaternal({ resident_id: 'RES-2', barangay_id: 'brgy-2', municipality_id: 'M1', delivery_date: '2026-11-10' });
  const quarterly = await service.periodReport({ user: HS, period: 'quarterly', year: 2026, quarter: 4, supabase: sb });
  assert.equal(quarterly.byCode.B2_18.total, 1); // only brgy-1
  const annual = await service.periodReport({ user: HS, period: 'annual', year: 2026, supabase: sb });
  assert.equal(annual.byCode.B2_18.total, 1); // only brgy-1
});

test('periodReport includes every indicator for a quarterly report', async () => {
  const report = await service.periodReport({ user: HS, period: 'quarterly', year: 2026, quarter: 2, supabase: sb });
  assert.equal(report.indicators.length, 178);
  assert.equal(report.byCode.E8_2.total, 0); // untouched indicator still reported as 0
});

// --- maternal derivation (dated supplementation / postpartum) ----------------
test('B1_5 iron/folic is derived from maternal_records by completion date', async () => {
  seedMaternal({ resident_id: 'RES-1', iron_folic_completed_date: '2026-09-12' }); // 20-49
  seedMaternal({ resident_id: 'RES-3', iron_folic_completed_date: '2026-09-20' }); // 15-19
  seedMaternal({ resident_id: 'RES-1', iron_folic_completed_date: '2026-08-01' }); // other month
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 9, supabase: sb });
  assert.equal(report.byCode.B1_5.total, 2);
  assert.equal(report.byCode.B1_5.byAge['20-49'], 1);
  assert.equal(report.byCode.B1_5.byAge['15-19'], 1);
  assert.equal(report.byCode.B1_5.source, 'maternal_records');
});

test('B3_28 counts a mother who completed at least 2 postpartum check-ups', async () => {
  // Completion is the 2nd check-up date; it falls in September.
  seedMaternal({ resident_id: 'RES-1', pp_checkup_24h: '2026-09-02', pp_checkup_day3: '2026-09-05' });
  // Only one check-up -> not counted.
  seedMaternal({ resident_id: 'RES-3', pp_checkup_24h: '2026-09-02' });
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 9, supabase: sb });
  assert.equal(report.byCode.B3_28.total, 1);
  assert.equal(report.byCode.B3_28.byAge['20-49'], 1);
});

// --- manual aggregate entry: persistence, update-in-place, rollup ------------
test('saveManualEntry persists an aggregate figure that the monthly report reflects', async () => {
  await service.saveManualEntry({
    user: HS, year: 2026, month: 10, indicatorCode: 'B1_1',
    values: [{ age_group: '20-49', value: 3 }], supabase: sb,
  });
  const report = await service.periodReport({ user: HS, period: 'monthly', year: 2026, month: 10, supabase: sb });
  assert.equal(report.byCode.B1_1.total, 3);
  assert.equal(report.byCode.B1_1.byAge['20-49'], 3);
});

test('saveManualEntry updates the existing figure in place (no duplicate)', async () => {
  await service.saveManualEntry({
    user: HS, year: 2026, month: 10, indicatorCode: 'B1_1',
    values: [{ age_group: '20-49', value: 3 }], supabase: sb,
  });
  await service.saveManualEntry({
    user: HS, year: 2026, month: 10, indicatorCode: 'B1_1',
    values: [{ age_group: '20-49', value: 4 }], supabase: sb,
  });
  // Exactly one stored row for the bucket; the value is updated to 4.
  const stored = [...store.tables.m1_manual_entries.values()]
    .filter((r) => r.indicator_code === 'B1_1' && r.age_group === '20-49' && r.period_month === 10);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].value, 4);
  const monthly = await service.periodReport({ user: HS, period: 'monthly', year: 2026, month: 10, supabase: sb });
  assert.equal(monthly.byCode.B1_1.total, 4);
});

test('manual figures roll up into quarterly and annual totals', async () => {
  await service.saveManualEntry({ user: HS, year: 2026, month: 10, indicatorCode: 'B1_1', values: [{ age_group: '20-49', value: 2 }], supabase: sb });
  await service.saveManualEntry({ user: HS, year: 2026, month: 11, indicatorCode: 'B1_1', values: [{ age_group: '20-49', value: 3 }], supabase: sb });
  const q4 = await service.periodReport({ user: HS, period: 'quarterly', year: 2026, quarter: 4, supabase: sb });
  assert.equal(q4.byCode.B1_1.total, 5); // Oct + Nov
  const annual = await service.periodReport({ user: HS, period: 'annual', year: 2026, supabase: sb });
  assert.equal(annual.byCode.B1_1.total, 5);
  const annualMatrix = await service.annualSummary({ user: HS, year: 2026, supabase: sb });
  const b1 = annualMatrix.indicators.find((i) => i.code === 'B1_1');
  assert.equal(b1.months[9], 2); // October
  assert.equal(b1.months[10], 3); // November
  assert.equal(b1.annual, 5);
});

test('saveManualEntry refuses a derived indicator (prevents double counting)', async () => {
  await assert.rejects(
    service.saveManualEntry({ user: HS, year: 2026, month: 10, indicatorCode: 'B2_18', values: [{ value: 5 }], supabase: sb }),
    /cannot be entered manually|derived/,
  );
});

test('a derived indicator is never counted from a manual entry', async () => {
  // Deliveries derived from maternal_records…
  seedMaternal({ delivery_date: '2026-10-05' });
  // …and a stray manual figure for the SAME code is ignored by aggregation
  // (source is maternal_records, so the m1_manual branch never runs for it).
  seedManual({ indicator_code: 'B2_18', period_month: 10, age_group: 'Total', value: 99 });
  const report = await service.periodReport({ user: HS, period: 'monthly', year: 2026, month: 10, supabase: sb });
  assert.equal(report.byCode.B2_18.total, 1); // only the real delivery, not 1 + 99
});

test('listManualEntries returns stored figures and the manual indicator catalog', async () => {
  await service.saveManualEntry({ user: HS, year: 2026, month: 10, indicatorCode: 'B1_1', values: [{ age_group: '20-49', value: 7 }], remarks: 'reviewed', supabase: sb });
  const res = await service.listManualEntries({ user: HS, year: 2026, month: 10, supabase: sb });
  assert.ok(res.indicators.some((i) => i.code === 'B1_1'));
  assert.ok(!res.indicators.some((i) => i.code === 'B2_18')); // derived, not manual
  const entry = res.entries.find((e) => e.indicator_code === 'B1_1' && e.age_group === '20-49');
  assert.equal(entry.value, 7);
  assert.equal(res.remarks.B1_1, 'reviewed');
});

// ===========================================================================
// Person-based FP auto-counting (spec PART 1-28)
// ===========================================================================

// Seed household_members with an FP method + linked resident (age derived
// from the resident's birth_date at the report month).
const seedFpMember = (over = {}) => {
  const id = `FP-${++store.seq}`;
  const row = {
    id,
    household_id: over.household_id || 'HH-1',
    resident_id: 'RES-1',
    fp_method: 'Condom',
    name: 'Member',
    birthday: '',
    sex: '',
    ...over,
  };
  // Link the household (for scope) + resident (for birth_date/sex) embeds.
  if (!store.tables.households.has(row.household_id)) {
    store.tables.households.set(row.household_id, { id: row.household_id, barangay_id: 'brgy-1', municipality_id: 'M1', head_name: 'HH', purok: '', street_address: '' });
  }
  const hh = store.tables.households.get(row.household_id);
  const res = store.residents.get(row.resident_id) || {};
  store.tables.household_members.set(id, {
    ...row,
    household: hh,
    resident: { birth_date: res.birth_date || null, sex: res.sex || '' },
  });
  return store.tables.household_members.get(id);
};

// The FP person counts use a JOIN shape; the fake client's _embed only fills
// household/resident when the select string asks for them. We seed the raw
// member rows and rely on the service's household_members select which asks
// for the embeds — the FakeQuery._embed handles resident:residents(...) but
// NOT household:households(...). Patch _embed to also resolve households.
// (The FakeQuery._embed was defined before household support existed.)

test('FP method indicators are derived from unique qualifying people (PERSON +1)', async () => {
  // RES-1 female age ~25 (birth 2001) -> 20-49; RES-3 female age ~17 -> 15-19.
  seedFpMember({ id: 'FP-A', resident_id: 'RES-1', fp_method: 'Condom' });
  seedFpMember({ id: 'FP-B', resident_id: 'RES-3', fp_method: 'Condom' });
  seedFpMember({ id: 'FP-C', resident_id: 'RES-1', fp_method: 'Condom' }); // duplicate same person
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 10, supabase: sb });
  assert.equal(report.byCode.A2_condom.total, 2); // two unique women, not 3 records
  assert.equal(report.byCode.A2_condom.byAge['20-49'], 1); // RES-1
  assert.equal(report.byCode.A2_condom.byAge['15-19'], 1); // RES-3
});

test('FP person counts respect the reporting barangay (outside resident excluded)', async () => {
  seedFpMember({ id: 'FP-D', resident_id: 'RES-1', fp_method: 'Condom' }); // brgy-1
  // Give RES-2 (brgy-2) its own household + member so scope isolates it.
  store.tables.households.set('HH-2', { id: 'HH-2', barangay_id: 'brgy-2', municipality_id: 'M1', head_name: 'HH2', purok: '', street_address: '' });
  seedFpMember({ id: 'FP-E', resident_id: 'RES-2', household_id: 'HH-2', fp_method: 'Condom' }); // brgy-2
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 10, supabase: sb });
  assert.equal(report.byCode.A2_condom.total, 1); // only brgy-1
});

test('FP person counts group by method and never double count a person', async () => {
  // Same resident, two different method records -> only her actual method counts.
  seedFpMember({ id: 'FP-F', resident_id: 'RES-1', fp_method: 'Condom' });
  seedFpMember({ id: 'FP-G', resident_id: 'RES-1', fp_method: 'Injectable (DMPA)' });
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 10, supabase: sb });
  // RES-1 maps to BOTH A2_condom and A2_dmpa from the two roster rows; each
  // method counts her once. (A real person has ONE stored method; the test
  // verifies a person with multiple records is still +1 per method.)
  assert.equal(report.byCode.A2_condom.total, 1);
  assert.equal(report.byCode.A2_dmpa.total, 1);
});

test('FP method age bands: 14 -> 10-14, 15/19 -> 15-19, 20/49 -> 20-49', async () => {
  // RES-1 birth 2001 -> 25 in 2026 (20-49). Add synthetic ages via direct rows.
  store.residents.set('RES-4', { id: 'RES-4', first_name: 'B', last_name: 'Y', barangay: 'San Isidro', barangay_id: 'brgy-1', municipality_id: 'M1', birth_date: '2012-01-01', sex: 'Female' }); // ~14
  store.residents.set('RES-5', { id: 'RES-5', first_name: 'C', last_name: 'Z', barangay: 'San Isidro', barangay_id: 'brgy-1', municipality_id: 'M1', birth_date: '2011-06-01', sex: 'Female' }); // ~15
  store.residents.set('RES-6', { id: 'RES-6', first_name: 'D', last_name: 'W', barangay: 'San Isidro', barangay_id: 'brgy-1', municipality_id: 'M1', birth_date: '2007-06-01', sex: 'Female' }); // ~19
  store.residents.set('RES-7', { id: 'RES-7', first_name: 'E', last_name: 'V', barangay: 'San Isidro', barangay_id: 'brgy-1', municipality_id: 'M1', birth_date: '2006-01-01', sex: 'Female' }); // ~20
  store.residents.set('RES-8', { id: 'RES-8', first_name: 'F', last_name: 'U', barangay: 'San Isidro', barangay_id: 'brgy-1', municipality_id: 'M1', birth_date: '1977-06-01', sex: 'Female' }); // ~49
  seedFpMember({ id: 'FP-14', resident_id: 'RES-4', fp_method: 'Condom' });
  seedFpMember({ id: 'FP-15', resident_id: 'RES-5', fp_method: 'Condom' });
  seedFpMember({ id: 'FP-19', resident_id: 'RES-6', fp_method: 'Condom' });
  seedFpMember({ id: 'FP-20', resident_id: 'RES-7', fp_method: 'Condom' });
  seedFpMember({ id: 'FP-49', resident_id: 'RES-8', fp_method: 'Condom' });
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 10, supabase: sb });
  const c = report.byCode.A2_condom;
  assert.equal(c.byAge['10-14'], 1);
  assert.equal(c.byAge['15-19'], 2);
  assert.equal(c.byAge['20-49'], 2);
  assert.equal(c.total, 5);
});

test('FP current users total (A2_total) sums all auto-counted methods', async () => {
  seedFpMember({ id: 'FP-T1', resident_id: 'RES-1', fp_method: 'Condom' });
  seedFpMember({ id: 'FP-T2', resident_id: 'RES-3', fp_method: 'Injectable (DMPA)' });
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 10, supabase: sb });
  assert.equal(report.byCode.A2_total.total, 2); // one condom + one DMPA user
});

test('no qualifying people -> FP method total is 0', async () => {
  const report = await service.monthlyReport({ user: HS, year: 2026, month: 10, supabase: sb });
  assert.equal(report.byCode.A2_condom.total, 0);
});

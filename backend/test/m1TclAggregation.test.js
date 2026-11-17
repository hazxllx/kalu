import assert from 'node:assert/strict';
import test from 'node:test';
import { getIndicator } from '../src/config/m1Catalog.js';
import {
  annualSummary,
  computeIndicator,
  drilldown,
  periodReport,
} from '../src/services/m1.service.js';

const hs = { role: 'health_supervisor', barangayId: 'b1', municipalityId: 'm1' };
const phn = { role: 'phn', municipalityId: 'm1' };

const database = (tables = {}) => ({
  from(table) {
    const predicates = [];
    const query = {
      select() { return query; },
      eq(field, value) { predicates.push((r) => r[field] === value); return query; },
      gte(field, value) { predicates.push((r) => r[field] != null && r[field] >= value); return query; },
      lte(field, value) { predicates.push((r) => r[field] != null && r[field] <= value); return query; },
      lt(field, value) { predicates.push((r) => r[field] != null && r[field] < value); return query; },
      in(field, values) { predicates.push((r) => values.includes(r[field])); return query; },
      limit() { return query; },
      order() { return query; },
      maybeSingle() {
        return Promise.resolve({
          data: (tables[table] || []).find((r) => predicates.every((p) => p(r))) || null,
          error: null,
        });
      },
      then(resolve, reject) {
        return Promise.resolve({
          data: (tables[table] || []).filter((r) => predicates.every((p) => p(r))),
          error: null,
        }).then(resolve, reject);
      },
    };
    return query;
  },
});

const baseTables = () => ({
  barangays: [
    { id: 'b1', municipality_id: 'm1', name: 'San Isidro', status: 'Active' },
    { id: 'b2', municipality_id: 'm1', name: 'San Antonio', status: 'Active' },
    { id: 'b3', municipality_id: 'm2', name: 'Foreign Barangay', status: 'Active' },
  ],
  m1_records: [],
  immunizations: [],
  households: [],
  household_members: [],
  household_member_health_profiles: [],
  maternal_records: [],
  m1_manual_entries: [],
  m1_indicator_remarks: [],
  tcl_entries: [
    // In-period June TB cases in b1 (res-1 appears twice -> must deduplicate to 1)
    {
      id: 'tcl-tb-1a',
      resident_id: 'res-1',
      barangay_id: 'b1',
      municipality_id: 'm1',
      program: 'TB Control',
      status: 'Active',
      priority: 'High',
      assigned_bhw: 'bhw-1',
      created_at: '2026-06-01T00:00:00.000Z',
      resident: { id: 'res-1', first_name: 'Juan', last_name: 'Dela Cruz', sex: 'Male', birth_date: '1985-04-01' },
    },
    {
      id: 'tcl-tb-1b',
      resident_id: 'res-1',
      barangay_id: 'b1',
      municipality_id: 'm1',
      program: 'Tuberculosis',
      status: 'Completed',
      priority: 'Medium',
      assigned_bhw: 'bhw-1',
      created_at: '2026-06-20T12:00:00.000Z',
      resident: { id: 'res-1', first_name: 'Juan', last_name: 'Dela Cruz', sex: 'Male', birth_date: '1985-04-01' },
    },
    {
      id: 'tcl-tb-2',
      resident_id: 'res-2',
      barangay_id: 'b1',
      municipality_id: 'm1',
      program: 'TB Prevention',
      status: 'Active',
      priority: 'High',
      assigned_bhw: 'bhw-1',
      created_at: '2026-06-30T23:59:59.999999Z',
      resident: { id: 'res-2', first_name: 'Ana', last_name: 'Santos', sex: 'Female', birth_date: '1990-02-10' },
    },
    // Earlier month (May) for same res-1 -> excluded from June monthly report, counted in May for annual
    {
      id: 'tcl-tb-may',
      resident_id: 'res-1',
      barangay_id: 'b1',
      municipality_id: 'm1',
      program: 'TB Patients',
      status: 'Active',
      created_at: '2026-05-31T23:59:59.999Z',
      resident: { id: 'res-1', first_name: 'Juan', last_name: 'Dela Cruz', sex: 'Male', birth_date: '1985-04-01' },
    },
    // After month (July) -> excluded from June monthly report
    {
      id: 'tcl-tb-jul',
      resident_id: 'res-3',
      barangay_id: 'b1',
      municipality_id: 'm1',
      program: 'TB',
      status: 'Active',
      created_at: '2026-07-01T00:00:00.000Z',
      resident: { id: 'res-3', first_name: 'Pedro', last_name: 'Reyes', sex: 'Male', birth_date: '1980-01-01' },
    },
    // Different barangay b2 -> excluded when scoped to b1, included for PHN municipality-wide
    {
      id: 'tcl-tb-b2',
      resident_id: 'res-b2',
      barangay_id: 'b2',
      municipality_id: 'm1',
      program: 'TB',
      status: 'Active',
      created_at: '2026-06-15T09:00:00.000Z',
      resident: { id: 'res-b2', first_name: 'Maria', last_name: 'Lopez', sex: 'Female', birth_date: '1988-09-09' },
    },
    // Diabetes cases (F_10)
    {
      id: 'tcl-dm-1',
      resident_id: 'res-4',
      barangay_id: 'b1',
      municipality_id: 'm1',
      program: 'Diabetes',
      status: 'Active',
      priority: 'Medium',
      created_at: '2026-06-10T08:00:00.000Z',
      resident: { id: 'res-4', first_name: 'Elena', last_name: 'Ramos', sex: 'Female', birth_date: '1970-05-15' },
    },
    {
      id: 'tcl-dm-2',
      resident_id: 'res-5',
      barangay_id: 'b1',
      municipality_id: 'm1',
      program: 'Type 2 Diabetes Mellitus',
      status: 'Active',
      priority: 'High',
      created_at: '2026-06-18T14:00:00.000Z',
      resident: { id: 'res-5', first_name: 'Carlos', last_name: 'Diaz', sex: 'Male', birth_date: '1968-11-22' },
    },
    // Unrelated program -> must NOT be counted by E5_1 or F_10
    {
      id: 'tcl-other',
      resident_id: 'res-6',
      barangay_id: 'b1',
      municipality_id: 'm1',
      program: 'Immunization',
      status: 'Active',
      created_at: '2026-06-12T10:00:00.000Z',
      resident: { id: 'res-6', first_name: 'Baby', last_name: 'Uno', sex: 'Female', birth_date: '2025-12-01' },
    },
  ],
});

test('P0-9: monthly periodReport aggregates E5_1 and F_10 from tcl_entries with date, unique resident, sex, and barangay scoping', async () => {
  const db = database(baseTables());
  const res = await periodReport({ user: hs, period: 'monthly', year: 2026, month: 6, supabase: db });

  assert.equal(res.byCode.E5_1.total, 2);
  assert.deepEqual(res.byCode.E5_1.bySex, { Male: 1, Female: 1, Other: 0, Unknown: 0 });

  assert.equal(res.byCode.F_10.total, 2);
  assert.deepEqual(res.byCode.F_10.bySex, { Male: 1, Female: 1, Other: 0, Unknown: 0 });
});

test('P0-9: PHN barangay filter isolates requested barangay vs municipality total and rejects out-of-scope barangay', async () => {
  const db = database(baseTables());
  const mun = await periodReport({ user: phn, period: 'monthly', year: 2026, month: 6, supabase: db });
  assert.equal(mun.byCode.E5_1.total, 3); // 2 in b1 + 1 in b2

  const b2Only = await periodReport({ user: phn, period: 'monthly', year: 2026, month: 6, barangayId: 'b2', supabase: db });
  assert.equal(b2Only.byCode.E5_1.total, 1);
  assert.equal(b2Only.byCode.F_10.total, 0);

  await assert.rejects(
    () => periodReport({ user: hs, period: 'monthly', year: 2026, month: 6, barangayId: 'b2', supabase: db }),
    (err) => err.statusCode === 403,
  );
});

test('P0-9: annualSummary computes monthly buckets and deduplicates unique residents across the year for E5_1 and F_10', async () => {
  const db = database(baseTables());
  const summary = await annualSummary({ user: hs, year: 2026, supabase: db });

  const e5 = summary.indicators.find((i) => i.code === 'E5_1');
  // May: res-1 (1), June: res-1 + res-2 (2), July: res-3 (1). Annual unique = 3 (res-1 not double-counted).
  assert.deepEqual(e5.months, [0, 0, 0, 0, 1, 2, 1, 0, 0, 0, 0, 0]);
  assert.equal(e5.annual, 3);
  assert.deepEqual(e5.bySex, { Male: 2, Female: 1, Other: 0, Unknown: 0 });

  const f10 = summary.indicators.find((i) => i.code === 'F_10');
  assert.deepEqual(f10.months, [0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0]);
  assert.equal(f10.annual, 2);
  assert.deepEqual(f10.bySex, { Male: 1, Female: 1, Other: 0, Unknown: 0 });
});

test('P0-9: drilldown returns matching tcl_entries records for E5_1 and F_10 within date range and barangay', async () => {
  const db = database(baseTables());
  const tbDrill = await drilldown({ user: hs, indicatorCode: 'E5_1', year: 2026, month: 6, supabase: db });
  assert.deepEqual(tbDrill.records.map((r) => r.id), ['tcl-tb-1a', 'tcl-tb-1b', 'tcl-tb-2']);
  assert.equal(tbDrill.records[0].detail.program, 'TB Control');

  const dmDrill = await drilldown({ user: hs, indicatorCode: 'F_10', year: 2026, month: 6, supabase: db });
  assert.deepEqual(dmDrill.records.map((r) => r.id), ['tcl-dm-1', 'tcl-dm-2']);
});

test('P0-9: unsupported indicator source throws instead of returning zero', () => {
  const badIndicator = { ...getIndicator('E5_1'), source: 'unknown_future_table' };
  assert.throws(
    () => computeIndicator(badIndicator, {
      recs: [], imms: [], households: [], mort: [], maternal: [], tclEntries: [], manual: [],
      fpPeople: [], rangeStart: '2026-06-01', rangeEnd: '2026-06-30', remark: '',
    }),
    /Unsupported M1 indicator source: unknown_future_table/,
  );
});

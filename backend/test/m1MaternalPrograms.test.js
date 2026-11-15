import assert from 'node:assert/strict';
import test from 'node:test';
import { M1_INDICATORS, getIndicator } from '../src/config/m1Catalog.js';
import { annualSummary, drilldown, getRecordsByProgram, periodReport } from '../src/services/m1.service.js';

const hs = { role: 'health_supervisor', barangayId: 'b1', municipalityId: 'm1' };
const phn = { role: 'phn', municipalityId: 'm1' };
const maternal = (id, fields = {}) => ({
  id, barangay_id: 'b1', municipality_id: 'm1', created_at: '2024-01-01T00:00:00Z',
  resident: { id: `resident-${id}`, birth_date: '2000-01-01', sex: 'Female' },
  ...fields,
});

// Execute predicates as well as recording them, so scope/date mistakes change
// returned results instead of merely satisfying query-shape assertions.
const database = (tables = {}) => {
  const calls = [];
  return {
    calls,
    from(table) {
      const predicates = [];
      const query = {
        select(value) { calls.push({ table, method: 'select', value }); return query; },
        eq(field, value) { calls.push({ table, method: 'eq', field, value }); predicates.push((row) => row[field] === value); return query; },
        gte(field, value) { calls.push({ table, method: 'gte', field, value }); predicates.push((row) => row[field] != null && row[field] >= value); return query; },
        lte(field, value) { calls.push({ table, method: 'lte', field, value }); predicates.push((row) => row[field] != null && row[field] <= value); return query; },
        in(field, value) { calls.push({ table, method: 'in', field, value }); predicates.push((row) => value.includes(row[field])); return query; },
        limit() { return query; },
        order() { return query; },
        maybeSingle() { return Promise.resolve({ data: (tables[table] || []).find((row) => predicates.every((fn) => fn(row))) || null, error: null }); },
        then(resolve, reject) {
          return Promise.resolve({ data: (tables[table] || []).filter((row) => predicates.every((fn) => fn(row))), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
};

const program = (supabase, overrides = {}) => getRecordsByProgram({
  user: hs, programId: 'prenatal', period: 'monthly', year: 2026, month: 6, ...overrides,
}, supabase);

test('prenatal returns the complete section B catalog with unchanged names and subsections', async () => {
  const result = await program(database());
  const expected = M1_INDICATORS.filter((row) => row.section === 'B');
  assert.deepEqual(Object.keys(result.indicators), expected.map((row) => row.code));
  for (const row of expected) {
    assert.equal(result.indicators[row.code].name, row.name);
    assert.equal(result.indicators[row.code].subsection, row.subsection);
    assert.equal(result.indicators[row.code].section, 'B');
  }
  assert.match(result.indicators.B1_1.name, /at least 4 prenatal/);
  assert.match(result.indicators.B3_28.name, /at least 2 postpartum/);
  assert.equal(result.indicators.B3_29.source, 'm1_manual');
  assert.equal(result.indicators.B3_1, undefined);
  assert.match(result.warnings.join(' '), /not approved mappings/);
  assert.deepEqual(result.period, { type: 'monthly', year: 2026, month: 6, quarter: null });
});

test('maternal program uses service dates and includes both month boundaries without timezone conversion', async () => {
  const db = database({ maternal_records: [
    maternal('before', { delivery_date: '2026-05-31' }),
    maternal('first', { delivery_date: '2026-06-01' }),
    maternal('last', { iron_folic_completed_date: '2026-06-30' }),
    maternal('after', { delivery_date: '2026-07-01' }),
    maternal('created-only', { created_at: '2026-06-15T00:00:00Z' }),
    maternal('postpartum', { pp_checkup_24h: '2026-05-31', pp_checkup_day3: '2026-06-02' }),
  ] });
  const result = await program(db);
  assert.deepEqual(result.records.map((row) => row.id), ['first', 'last', 'postpartum']);
  assert.equal(result.indicators.B2_18.total, 1);
  assert.equal(result.indicators.B1_5.total, 1);
  assert.equal(result.indicators.B3_28.total, 1);
  assert.equal(db.calls.some((call) => call.table === 'maternal_records' && call.field === 'created_at'), false);
  assert.ok(db.calls.some((call) => call.field === 'record_date' && call.method === 'gte' && call.value === '2026-06-01'));
  assert.ok(db.calls.some((call) => call.field === 'record_date' && call.method === 'lte' && call.value === '2026-06-30'));
});

test('maternal program scopes raw cases and aggregates by barangay or municipality', async () => {
  const rows = [
    maternal('own', { delivery_date: '2026-06-15' }),
    maternal('neighbor', { barangay_id: 'b2', delivery_date: '2026-06-15' }),
    maternal('outside', { barangay_id: 'b3', municipality_id: 'm2', delivery_date: '2026-06-15' }),
  ];
  const own = await program(database({ maternal_records: rows }));
  assert.deepEqual(own.records.map((row) => row.id), ['own']);
  assert.equal(own.indicators.B2_18.total, 1);
  const municipal = await program(database({ maternal_records: rows }), { user: phn });
  assert.deepEqual(municipal.records.map((row) => row.id), ['own', 'neighbor']);
  assert.equal(municipal.indicators.B2_18.total, 2);
  const selected = await program(database({ maternal_records: rows, barangays: [
    { id: 'b2', municipality_id: 'm1', status: 'Active' },
  ] }), { user: phn, barangayId: 'b2' });
  assert.deepEqual(selected.records.map((row) => row.id), ['neighbor']);
  await assert.rejects(program(database({ barangays: [
    { id: 'b3', municipality_id: 'm2', status: 'Active' },
  ] }), { user: phn, barangayId: 'b3' }), (error) => error.statusCode === 403);
});

test('quarterly maternal program includes April 1 and June 30, excluding adjacent quarters', async () => {
  const result = await program(database({ maternal_records: [
    maternal('march', { delivery_date: '2026-03-31' }),
    maternal('april', { delivery_date: '2026-04-01' }),
    maternal('june', { delivery_date: '2026-06-30' }),
    maternal('july', { delivery_date: '2026-07-01' }),
  ] }), { period: 'quarterly', month: null, quarter: 2 });
  assert.deepEqual(result.records.map((row) => row.id), ['april', 'june']);
  assert.equal(result.indicators.B2_18.total, 2);
});

test('annual summary and annual report isolate every derived maternal event to the requested year', async () => {
  const tables = { maternal_records: [2025, 2026, 2027].flatMap((year) => [
    maternal(`${year}-first`, { delivery_date: `${year}-01-01`, delivery_outcome: 'Live Birth', iron_folic_completed_date: `${year}-01-01`, vitamin_a_given_date: `${year}-01-01`, pp_checkup_24h: `${year}-01-01`, pp_checkup_day3: `${year}-01-02` }),
    maternal(`${year}-last`, { delivery_date: `${year}-12-31` }),
  ]) };
  const annual = await annualSummary({ user: hs, year: 2026, supabase: database(tables) });
  const report = await periodReport({ user: hs, period: 'annual', year: 2026, supabase: database(tables) });
  for (const code of ['B1_5', 'B2_18', 'B2_19', 'B3_28', 'B3_30']) {
    const row = annual.indicators.find((indicator) => indicator.code === code);
    assert.equal(row.annual, code === 'B2_18' ? 2 : 1, code);
    assert.equal(row.annual, report.byCode[code].total, code);
  }
  const result = await program(database(tables), { period: 'annual', month: null });
  assert.deepEqual(result.records.map((row) => row.id), ['2026-first', '2026-last']);
});

test('quarterly maternal drilldown uses completion date, scope, and catalog metadata', async () => {
  const result = await drilldown({ user: hs, indicatorCode: 'B3_28', period: 'quarterly', year: 2026, quarter: 2, supabase: database({ maternal_records: [
    maternal('before', { pp_checkup_24h: '2026-03-29', pp_checkup_day3: '2026-03-31' }),
    maternal('first', { pp_checkup_24h: '2026-03-30', pp_checkup_day3: '2026-04-01' }),
    maternal('last', { pp_checkup_24h: '2026-06-28', pp_checkup_day3: '2026-06-30' }),
    maternal('after', { pp_checkup_24h: '2026-06-29', pp_checkup_day3: '2026-07-01' }),
    maternal('outside', { barangay_id: 'b2', pp_checkup_24h: '2026-04-01', pp_checkup_day3: '2026-04-03' }),
  ] }) });
  assert.deepEqual(result.records.map((row) => row.id), ['first', 'last']);
  assert.deepEqual(result.period, { period: 'quarterly', year: 2026, quarter: 2 });
  assert.equal(result.indicator.name, getIndicator('B3_28').name);
  assert.equal(result.indicator.subsection, getIndicator('B3_28').subsection);
});

test('quarterly manual drilldown selects only the three reporting-month buckets', async () => {
  const result = await drilldown({ user: hs, indicatorCode: 'B3_29', period: 'quarterly', year: 2026, quarter: 2, supabase: database({ m1_manual_entries: [3, 4, 5, 6, 7].map((month) => ({
    id: `month-${month}`, indicator_code: 'B3_29', period_year: 2026, period_month: month, barangay_id: 'b1', value: month,
  })) }) });
  assert.deepEqual(result.records.map((row) => row.id), ['month-4', 'month-5', 'month-6']);
});

test('invalid periods fail instead of silently widening maternal retrieval', async () => {
  for (const overrides of [{ month: 13 }, { period: 'quarterly', quarter: 5 }, { year: 0 }, { period: 'unknown' }]) {
    await assert.rejects(program(database(), overrides), (error) => error.statusCode === 422);
  }
  await assert.rejects(drilldown({ user: hs, indicatorCode: 'B3_28', period: 'quarterly', year: 2026, quarter: 0, supabase: database() }), (error) => error.statusCode === 422);
});

test('environmental drilldown returns only qualifying households in the assigned barangay', async () => {
  const result = await drilldown({
    user: hs,
    indicatorCode: 'G_1_1',
    period: 'monthly',
    year: 2026,
    month: 11,
    supabase: database({ households: [
      { id: 'level-1', barangay_id: 'b1', water_source: 'level1', toilet_type: 'ws_own', head_name: 'Scoped household' },
      { id: 'level-2', barangay_id: 'b1', water_source: 'level2', toilet_type: 'ws_own', head_name: 'Other source' },
      { id: 'outside', barangay_id: 'b2', water_source: 'level1', toilet_type: 'ws_own', head_name: 'Outside household' },
    ] }),
  });

  assert.equal(result.indicator.code, 'G_1_1');
  assert.equal(result.count, 1);
  assert.deepEqual(result.records.map((record) => record.id), ['level-1']);
  assert.equal(result.records[0].detail.water_source, 'level1');

  await assert.rejects(
    drilldown({
      user: hs,
      indicatorCode: 'G_1_1',
      period: 'monthly',
      year: 2026,
      month: 11,
      barangayId: 'b2',
      supabase: database(),
    }),
    (error) => error.statusCode === 403,
  );
});

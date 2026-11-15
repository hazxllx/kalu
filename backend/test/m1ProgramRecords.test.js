import assert from 'node:assert/strict';
import test from 'node:test';
import { M1_INDICATORS, getIndicator } from '../src/config/m1Catalog.js';
import { SCHEMAS } from '../src/config/programFormSchemas.js';
import { getRecordsByProgram } from '../src/services/m1.service.js';

const hs = { role: 'health_supervisor', barangayId: 'b1', municipalityId: 'm1' };
const phn = { role: 'phn', municipalityId: 'm1' };
const row = (id, values = {}) => ({ id, barangay_id: 'b1', municipality_id: 'm1', ...values });
const database = (tables = {}, errors = {}) => {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.ok(!['program_enrollments', 'oral_health_encounters', 'cervical_breast_screening', 'visual_acuity_screening'].includes(table), `Nonexistent table: ${table}`);
      const predicates = [];
      const query = {
        select(value) { calls.push({ table, method: 'select', value }); return query; },
        eq(field, value) { predicates.push((r) => r[field] === value); return query; },
        gte(field, value) { calls.push({ table, method: 'gte', field, value }); predicates.push((r) => r[field] != null && r[field] >= value); return query; },
        lte(field, value) { predicates.push((r) => r[field] != null && r[field] <= value); return query; },
        lt(field, value) { predicates.push((r) => r[field] != null && r[field] < value); return query; },
        in(field, values) { predicates.push((r) => values.includes(r[field])); return query; },
        limit() { return query; },
        order() { return query; },
        maybeSingle() { return Promise.resolve({ data: (tables[table] || []).find((r) => predicates.every((p) => p(r))) || null, error: errors[table] || null }); },
        then(resolve, reject) { return Promise.resolve({ data: (tables[table] || []).filter((r) => predicates.every((p) => p(r))), error: errors[table] || null }).then(resolve, reject); },
      };
      return query;
    },
  };
};
const program = (db, programId, overrides = {}) => getRecordsByProgram({
  user: hs, programId, period: 'monthly', year: 2026, month: 6, ...overrides,
}, db);

test('enrollment reuses TCL, embeds resident FK, preserves records without querying unrelated report stores', async () => {
  const db = database({ tcl_entries: [
    row('before', { created_at: '2026-05-31T23:59:59.999Z' }),
    row('first', { created_at: '2026-06-01T00:00:00.000Z', program: 'Diabetes', resident: { id: 'r1', first_name: 'Test' } }),
    row('last', { created_at: '2026-06-30T23:59:59.999999Z' }),
    row('after', { created_at: '2026-07-01T00:00:00.000Z' }),
    row('outside', { barangay_id: 'b2', created_at: '2026-06-15T00:00:00.000Z' }),
  ] });
  const result = await program(db, 'enrollment');
  assert.deepEqual(result.records.map((r) => r.id), ['first', 'last']);
  assert.equal(result.records[0].program, 'Diabetes');
  assert.equal(result.records[0].resident.first_name, 'Test');
  assert.deepEqual(result.indicators, {});
  assert.deepEqual(result.count, { records: 2, indicators: 0 });
  assert.equal(result.section, null);
  assert.match(result.warnings[0], /existing TCL enrollments/);
  assert.ok(db.calls.every((call) => call.table === 'tcl_entries'));
  assert.match(db.calls.find((call) => call.method === 'select').value, /resident:residents\(id, first_name/);
});

test('oral uses existing consultation dates, not creation dates, and returns all catalog D indicators', async () => {
  const table = SCHEMAS['oral-health'].table;
  const db = database({ [table]: [
    row('first', { consultation_date: '2026-06-01', created_at: '2025-01-01T00:00:00Z' }),
    row('last', { consultation_date: '2026-06-30' }),
    row('old', { consultation_date: '2026-05-31', created_at: '2026-06-15T00:00:00Z' }),
    row('undated', { consultation_date: null }),
    row('outside', { consultation_date: '2026-06-15', barangay_id: 'b2' }),
  ] });
  const result = await program(db, 'oral');
  assert.deepEqual(result.records.map((r) => r.id), ['first', 'last']);
  assert.deepEqual(Object.keys(result.indicators), M1_INDICATORS.filter((r) => r.section === 'D').map((r) => r.code));
  assert.match(result.warnings[0], /not automatically derived/);
  assert.equal(result.indicators.D_1.source, 'm1_manual');
});

test('program membership uses configured disease categories, section F catalog, and canonical TCL schemas', async () => {
  const infectiousDiseaseCodes = M1_INDICATORS.filter((indicator) => indicator.section === 'E').map((indicator) => indicator.code);
  const cases = [
    ['ncd', 'ncd-risk', [...infectiousDiseaseCodes, 'F_1', 'F_2', 'F_3', 'F_4', 'F_9', 'F_10']],
    ['cervical', 'ncd-cervical', ['F_5', 'F_6', 'F_7', 'F_8']],
    ['visual', 'ncd-visual', ['F_11', 'F_12', 'F_13', 'F_14']],
  ];
  for (const [id, kind, codes] of cases) {
    const db = database({ [SCHEMAS[kind].table]: [row('valid', { assessment_date: '2026-06-30', created_at: '2025-01-01' }), row('old', { assessment_date: '2026-05-31' })] });
    const result = await program(db, id);
    assert.equal(result.section, 'F');
    assert.deepEqual(Object.keys(result.indicators), codes);
    assert.deepEqual(result.records.map((r) => r.id), ['valid']);
    for (const code of codes) {
      assert.equal(result.indicators[code].name, getIndicator(code).name);
      assert.equal(result.indicators[code].subsection, getIndicator(code).subsection);
      assert.equal(result.indicators[code].source, getIndicator(code).source);
    }
  }
});

test('enrollment and oral enforce municipal scope and validated barangay overrides', async () => {
  for (const [id, table, dates] of [
    ['enrollment', 'tcl_entries', { created_at: '2026-06-15T00:00:00.000Z' }],
    ['oral', 'oral_health_records', { consultation_date: '2026-06-15' }],
  ]) {
    const tables = { [table]: [row('own', dates), row('neighbor', { ...dates, barangay_id: 'b2' }), row('outside', { ...dates, municipality_id: 'm2', barangay_id: 'b3' })], barangays: [
      { id: 'b2', municipality_id: 'm1', status: 'Active' }, { id: 'b3', municipality_id: 'm2', status: 'Active' },
    ] };
    assert.deepEqual((await program(database(tables), id, { user: phn })).records.map((r) => r.id), ['own', 'neighbor']);
    assert.deepEqual((await program(database(tables), id, { user: phn, barangayId: 'b2' })).records.map((r) => r.id), ['neighbor']);
    await assert.rejects(program(database(tables), id, { user: phn, barangayId: 'b3' }), (e) => e.statusCode === 403);
    await assert.rejects(program(database(tables), id, { barangayId: 'b2' }), (e) => e.statusCode === 403);
  }
});

test('enrollment and oral honor quarter and year boundaries', async () => {
  for (const [id, table, field] of [['enrollment', 'tcl_entries', 'created_at'], ['oral', 'oral_health_records', 'consultation_date']]) {
    const tables = { [table]: ['2025-12-31', '2026-01-01', '2026-03-31', '2026-04-01', '2026-06-30', '2026-07-01', '2026-12-31', '2027-01-01'].map((date) => row(date, { [field]: field === 'created_at' ? `${date}T12:00:00.000Z` : date })) };
    assert.deepEqual((await program(database(tables), id, { period: 'quarterly', month: null, quarter: 2 })).records.map((r) => r.id), ['2026-04-01', '2026-06-30']);
    assert.equal((await program(database(tables), id, { period: 'annual', month: null })).records.length, 6);
  }
});

test('environmental exposes complete catalog G and current scoped household stock, not creation-period subset', async () => {
  const result = await program(database({ households: [row('existing', { created_at: '2020-01-01' }), row('outside', { barangay_id: 'b2' })] }), 'environmental');
  assert.deepEqual(result.records.map((r) => r.id), ['existing']);
  assert.deepEqual(Object.keys(result.indicators), M1_INDICATORS.filter((r) => r.section === 'G').map((r) => r.code));
  assert.match(result.warnings[0], /not a historical snapshot/);
});

test('environmental summary counts unique households instead of overlapping parent and child totals', async () => {
  const households = [
    row('level1', { water_source: 'level1', water_treated: false, toilet_type: 'ws_own' }),
    row('level2-a', { water_source: 'level2', water_treated: false, toilet_type: 'ws_own' }),
    row('level2-b', { water_source: 'level2', water_treated: false, toilet_type: 'ws_own' }),
    row('level3-a', { water_source: 'level3', water_treated: false, toilet_type: 'ws_own' }),
    row('level3-b', { water_source: 'level3', water_treated: false, toilet_type: 'ws_own' }),
    row('outside', { barangay_id: 'b2', water_source: 'level1', water_treated: true, toilet_type: 'ws_own' }),
  ];
  const result = await program(database({ households }), 'environmental');

  assert.equal(result.count.indicators, 12);
  assert.equal(result.count.contributingRecords, 5);
  assert.deepEqual(result.summary, {
    label: 'Unique contributing households',
    total: 5,
    note: 'Counts each household once even when it contributes to parent and child indicators.',
  });
  assert.equal(Object.values(result.indicators).reduce((sum, indicator) => sum + indicator.total, 0), 25);
});

test('missing canonical tables and permission errors remain failures, not empty successes', async () => {
  for (const code of ['PGRST205', '42501']) {
    await assert.rejects(program(database({}, { oral_health_records: { code, message: 'store unavailable' } }), 'oral'), (e) => e.statusCode === 500 && e.details.code === code);
  }
  await assert.rejects(program(database(), 'unknown'), (e) => e.statusCode === 400);
  await assert.rejects(program(database(), 'enrollment', { month: 13 }), (e) => e.statusCode === 422);
});

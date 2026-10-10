import assert from 'node:assert/strict';
import test from 'node:test';
import * as service from '../src/services/programForms.service.js';
import { SCHEMAS } from '../src/config/programFormSchemas.js';

/**
 * Unit tests for the program-forms validation + persistence layer. A fake
 * Supabase client is injected so the service runs without a live database:
 * these verify server-side validation (enum rejection, key whitelisting),
 * the resident/household scope guard, jsonb split, and the official
 * Environmental Masterlist derived-indicator rules.
 */

const STAFF_USER = { id: 'user-1', role: 'health_supervisor', barangay: 'San Isidro', barangayId: 'brgy-1', municipalityId: 'muni-1' };

const makeSupabase = ({ resident, household } = {}) => {
  const captured = { inserts: [], updates: [] };
  const builder = (table) => {
    const state = { table, payload: null, mode: null };
    const resolveTerminal = () => {
      if (table === 'residents') return { data: resident ?? null, error: null };
      if (table === 'households') return { data: household ?? null, error: null };
      if (table === 'health_audit_logs') return { error: null };
      if (state.mode === 'insert') return { data: { id: 'new-id', ...state.payload }, error: null };
      if (state.mode === 'update') return { data: { id: 'rec-1', ...state.payload }, error: null };
      return { data: null, error: null };
    };
    const api = {
      select() { return api; },
      insert(row) { state.mode = 'insert'; state.payload = row; captured.inserts.push({ table, row }); return api; },
      update(row) { state.mode = 'update'; state.payload = row; captured.updates.push({ table, row }); return api; },
      delete() { state.mode = 'delete'; return api; },
      eq() { return api; },
      gte() { return api; },
      lte() { return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle() { return Promise.resolve(resolveTerminal()); },
      single() { return Promise.resolve(resolveTerminal()); },
      then(onF, onR) { return Promise.resolve(resolveTerminal()).then(onF, onR); },
    };
    return api;
  };
  const supabase = { from: (table) => builder(table) };
  supabase.__captured = captured;
  return supabase;
};

const RESIDENT = { id: 'res-1', barangay: 'San Isidro', barangay_id: 'brgy-1', municipality_id: 'muni-1', auth_user_id: null };
const HOUSEHOLD = { id: 'hh-1', barangay: 'San Isidro', barangay_id: 'brgy-1', municipality_id: 'muni-1' };

test('all schema kinds are registered', () => {
  assert.deepEqual(Object.keys(SCHEMAS).sort(), ['environmental', 'ncd-cervical', 'ncd-risk', 'ncd-visual', 'oral-health']);
});

test('ncd-risk: valid payload splits columns vs jsonb and drops unknown keys', async () => {
  const supabase = makeSupabase({ resident: RESIDENT });
  const created = await service.create({
    user: STAFF_USER,
    kind: 'ncd-risk',
    supabase,
    payload: {
      residentId: 'res-1',
      assessment_date: '2026-01-15',
      family_serial_no: 'FS-100',
      se_status: 'NHTS',
      sex: 'F',
      age: 45,
      current_smoker: 'Y',
      binge_alcohol: 'N',
      weight_class: '2',
      htn_screening_date: '2026-01-15',
      htn_result: '+',
      malicious_key: 'DROP TABLE', // must be ignored
    },
  });
  const insert = supabase.__captured.inserts.find((i) => i.table === 'ncd_risk_assessments');
  assert.ok(insert, 'inserted into ncd_risk_assessments');
  assert.equal(insert.row.resident_id, 'res-1');
  assert.equal(insert.row.se_status, 'NHTS');
  assert.equal(insert.row.age, 45);
  // jsonb detail
  assert.equal(insert.row.data.current_smoker, 'Y');
  assert.equal(insert.row.data.weight_class, '2');
  assert.equal(insert.row.data.htn_result, '+');
  // unknown key never persisted
  assert.equal('malicious_key' in insert.row, false);
  assert.equal('malicious_key' in insert.row.data, false);
  assert.equal(created.id, 'new-id');
});

test('ncd-risk: invalid enum value is rejected (422)', async () => {
  const supabase = makeSupabase({ resident: RESIDENT });
  await assert.rejects(
    () => service.create({ user: STAFF_USER, kind: 'ncd-risk', supabase, payload: { residentId: 'res-1', se_status: 'MAYBE' } }),
    (err) => err.statusCode === 422,
  );
});

test('resident outside caller barangay scope is not found', async () => {
  const supabase = makeSupabase({ resident: { ...RESIDENT, barangay: 'Other Barangay' } });
  await assert.rejects(
    () => service.create({ user: STAFF_USER, kind: 'ncd-risk', supabase, payload: { residentId: 'res-1', se_status: 'NHTS' } }),
    (err) => err.statusCode === 404,
  );
});

test('non-staff role cannot create program records', async () => {
  const supabase = makeSupabase({ resident: RESIDENT });
  await assert.rejects(
    () => service.create({ user: { id: 'r', role: 'resident' }, kind: 'ncd-risk', supabase, payload: { residentId: 'res-1' } }),
    (err) => err.statusCode === 403,
  );
});

test('BHW (data-collection only) cannot create program records', async () => {
  const supabase = makeSupabase({ resident: RESIDENT });
  await assert.rejects(
    () => service.create({ user: { id: 'b', role: 'bhw', barangayId: 'brgy-1' }, kind: 'oral-health', supabase, payload: { residentId: 'res-1', consultation_date: '2026-01-10', age_group: '5-9' } }),
    (err) => err.statusCode === 403,
  );
});

test('environmental: complete sanitation derived only when all official conditions hold', async () => {
  const supabase = makeSupabase({ household: HOUSEHOLD });
  await service.create({
    user: STAFF_USER,
    kind: 'environmental',
    supabase,
    payload: {
      householdId: 'hh-1',
      se_status: 'Non-NHTS',
      water_supply_type: 'level3',
      within_premises: true,
      available_247: true,
      water_micro_result: 'ABSENT',
      water_physico_result: 'WITHIN',
      sanitary_facility_type: 'a',
      toilet_not_shared: true,
      excreta_disposal: 'a',
      waste_segregation: true,
      waste_backyard_composting: true,
      waste_recycling: true,
    },
  });
  const insert = supabase.__captured.inserts.find((i) => i.table === 'environmental_masterlist');
  assert.equal(insert.row.household_id, 'hh-1');
  assert.equal(insert.row.has_basic_safe_water, true);
  assert.equal(insert.row.has_sanitary_toilet, true);
  assert.equal(insert.row.complete_sanitation, true);
  assert.equal(insert.row.data.safely_managed_water, true);
  assert.equal(insert.row.data.safely_managed_sanitation, true);
});

test('environmental: incomplete waste practice => not complete sanitation', async () => {
  const supabase = makeSupabase({ household: HOUSEHOLD });
  await service.create({
    user: STAFF_USER,
    kind: 'environmental',
    supabase,
    payload: {
      householdId: 'hh-1',
      water_supply_type: 'level1',
      sanitary_facility_type: 'c',
      waste_segregation: true, // only segregation, no composting/recycling/collection
    },
  });
  const insert = supabase.__captured.inserts.find((i) => i.table === 'environmental_masterlist');
  assert.equal(insert.row.has_basic_safe_water, true);
  assert.equal(insert.row.has_sanitary_toilet, true);
  assert.equal(insert.row.complete_sanitation, false);
});

test('environmental: unimproved water source is not basic safe water', async () => {
  const supabase = makeSupabase({ household: HOUSEHOLD });
  await service.create({
    user: STAFF_USER,
    kind: 'environmental',
    supabase,
    payload: { householdId: 'hh-1', water_supply_type: 'others', water_supply_other: 'open dug well' },
  });
  const insert = supabase.__captured.inserts.find((i) => i.table === 'environmental_masterlist');
  assert.equal(insert.row.has_basic_safe_water, false);
});

test('update merges jsonb detail instead of wiping untouched keys', async () => {
  const supabase = makeSupabase({ resident: RESIDENT });
  // seed an existing record read
  supabase.from = ((orig) => (table) => {
    if (table === 'ncd_risk_assessments') {
      const api = orig(table);
      const origMaybe = api.maybeSingle;
      api.maybeSingle = () => Promise.resolve({ data: { id: 'rec-1', resident_id: 'res-1', data: { current_smoker: 'Y', binge_alcohol: 'N' } }, error: null });
      return api;
    }
    return orig(table);
  })(supabase.from);
  await service.update({ user: STAFF_USER, kind: 'ncd-risk', id: 'rec-1', supabase, payload: { residentId: 'res-1', htn_result: '-' } });
  const upd = supabase.__captured.updates.find((u) => u.table === 'ncd_risk_assessments');
  assert.equal(upd.row.data.current_smoker, 'Y'); // preserved
  assert.equal(upd.row.data.binge_alcohol, 'N'); // preserved
  assert.equal(upd.row.data.htn_result, '-'); // new
});

test('oral statistics compute counts from records with NHTS and sex breakdown, no fabricated targets', async () => {
  const rows = [
    // orally fit 12-59 (1-4), NHTS, male
    { age_group: '1-4', se_status: 'NHTS', resident: { sex: 'M' }, data: { orally_fit_exam_date: '2026-01-10', bohc: { '1-4': '2026-01-10' } } },
    // DMFT new case, 5-9, Non-NHTS, female + BOHC 5-9
    { age_group: '5-9', se_status: 'Non-NHTS', resident: { sex: 'F' }, data: { dmft_decayed: true, bohc: { '5-9': '2026-01-12' } } },
    // pregnant BOHC, NHTS, female
    { age_group: 'pregnant', se_status: 'NHTS', resident: { sex: 'F' }, data: { bohc: { pregnant: '2026-01-15' } } },
  ];
  const supabase = {
    from: () => {
      const api = {
        select() { return api; }, order() { return api; }, limit() { return api; },
        eq() { return api; }, gte() { return api; }, lte() { return api; },
        then(onF) { return Promise.resolve({ data: rows, error: null }).then(onF); },
      };
      return api;
    },
  };
  const stats = await service.oralStatistics({ user: STAFF_USER, supabase });
  assert.equal(stats.indicator_1_orally_fit_12_59.counts.total, 1);
  assert.equal(stats.indicator_1_orally_fit_12_59.counts.nhts, 1);
  assert.equal(stats.indicator_1_orally_fit_12_59.counts.m, 1);
  assert.equal(stats.indicator_2_dmft_new.counts.total, 1);
  assert.equal(stats.indicator_2_dmft_new.counts.f, 1);
  assert.equal(stats.bohc.bohc_1_4.counts.total, 1);
  assert.equal(stats.bohc.bohc_5_9.counts.total, 1);
  assert.equal(stats.bohc.pregnant.counts.total, 1);
  // No population supplied => targets are null (never fabricated)
  assert.equal(stats.bohc.bohc_1_4.target, null);
  assert.equal(stats.population, null);
});

test('oral statistics apply official population factors only when a denominator is supplied', async () => {
  const supabase = {
    from: () => {
      const api = {
        select() { return api; }, order() { return api; }, limit() { return api; },
        eq() { return api; }, gte() { return api; }, lte() { return api; },
        then(onF) { return Promise.resolve({ data: [], error: null }).then(onF); },
      };
      return api;
    },
  };
  const stats = await service.oralStatistics({ user: STAFF_USER, population: '10000', supabase });
  assert.equal(stats.population, 10000);
  // Infants 0-11: 10000 * 2.056% * 30% = 61.68 -> 62
  assert.equal(stats.bohc.bohc_0_11.target, Math.round(10000 * 0.02056 * 0.30));
  // Pregnant: 10000 * 2.056% = 205.6 -> 206
  assert.equal(stats.bohc.pregnant.target, Math.round(10000 * 0.02056));
});

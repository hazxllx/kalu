import assert from 'node:assert/strict';
import test from 'node:test';
import * as service from '../src/services/programForms.service.js';

/**
 * End-to-end create -> save -> reload -> edit round trip for every implemented
 * program TCL, exercised through the REAL service code (validation, scope
 * guard, jsonb split, environmental derived indicators, audit, update-merge).
 *
 * It runs against an isolated, stateful IN-MEMORY Supabase double seeded with
 * synthetic residents/households — no live production data is read or written.
 * The double emulates the DB scope trigger (copying municipality/barangay from
 * the linked resident/household on insert/update) so the role-scoped list query
 * returns the saved rows exactly as PostgREST would. This proves the data
 * mapping and reload/edit logic; it is NOT a substitute for a real Postgres/RLS
 * run (documented as such).
 */

// --- Stateful in-memory Supabase double -----------------------------------
const makeDb = (seed = {}) => {
  let seq = 0;
  const store = {
    residents: seed.residents || [],
    households: seed.households || [],
    health_audit_logs: [],
    ncd_risk_assessments: [],
    ncd_cervical_breast: [],
    ncd_visual_ppv: [],
    oral_health_records: [],
    environmental_masterlist: [],
  };
  const applyScope = (table, row) => {
    if (row.resident_id) {
      const r = store.residents.find((x) => x.id === row.resident_id);
      if (r) { row.municipality_id = r.municipality_id; row.barangay_id = r.barangay_id; }
    }
    if (row.household_id) {
      const h = store.households.find((x) => x.id === row.household_id);
      if (h) { row.municipality_id = h.municipality_id; row.barangay_id = h.barangay_id; }
    }
    return row;
  };
  const from = (table) => {
    const state = { table, op: 'select', filters: [], payload: null, created: null };
    const match = (row) => state.filters.every(([c, v]) => row[c] === v);
    const rows = () => (store[table] || []);
    const doInsert = () => {
      const row = applyScope(table, { id: `id-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), updated_at: new Date().toISOString(), ...state.payload });
      rows().push(row);
      return row;
    };
    const doUpdate = () => {
      const row = rows().find(match);
      if (!row) return null;
      Object.assign(row, state.payload, { updated_at: new Date().toISOString() });
      applyScope(table, row);
      return row;
    };
    const resolveSingle = () => {
      if (state.op === 'insert') { state.created = state.created || doInsert(); return { data: state.created, error: null }; }
      if (state.op === 'update') { return { data: doUpdate(), error: null }; }
      const found = rows().filter(match);
      return { data: found[0] || null, error: null };
    };
    const resolveMany = () => {
      if (state.op === 'insert') { state.created = state.created || doInsert(); return { data: null, error: null }; }
      if (state.op === 'delete') { const keep = rows().filter((r) => !match(r)); store[table] = keep; return { data: null, error: null }; }
      return { data: rows().filter(match), error: null };
    };
    const api = {
      select() { return api; },
      insert(row) { state.op = 'insert'; state.payload = row; return api; },
      update(row) { state.op = 'update'; state.payload = row; return api; },
      delete() { state.op = 'delete'; return api; },
      eq(c, v) { state.filters.push([c, v]); return api; },
      gte() { return api; }, lte() { return api; }, order() { return api; }, limit() { return api; },
      maybeSingle() { return Promise.resolve(resolveSingle()); },
      single() { return Promise.resolve(resolveSingle()); },
      then(f, r) { return Promise.resolve(resolveMany()).then(f, r); },
    };
    return api;
  };
  return { from, __store: store };
};

const HS = { id: 'user-hs', role: 'health_supervisor', barangay: 'San Isidro', barangayId: 'brgy-1', municipalityId: 'muni-1' };
const RES = { id: 'res-1', barangay: 'San Isidro', barangay_id: 'brgy-1', municipality_id: 'muni-1', auth_user_id: null, first_name: 'Juana', last_name: 'Cruz' };
const HH = { id: 'hh-1', barangay: 'San Isidro', barangay_id: 'brgy-1', municipality_id: 'muni-1', head_name: 'Pedro Reyes' };

const seedResident = () => makeDb({ residents: [{ ...RES }] });
const seedHousehold = () => makeDb({ households: [{ ...HH }] });

// --- Round-trip helper ------------------------------------------------------
const roundTrip = async ({ kind, db, createPayload, link, assertCreated, editPayload, assertEdited }) => {
  // 1) CREATE
  const created = await service.create({ user: HS, kind, supabase: db, payload: createPayload });
  assert.ok(created.id, 'created record has an id');
  assertCreated(created);

  // 2) RELOAD via the role-scoped list query
  const listed = await service.list({ user: HS, kind, supabase: db, ...link });
  const reloaded = listed.find((r) => r.id === created.id);
  assert.ok(reloaded, 'created record is returned by the reload (list) query');
  assertCreated(reloaded);

  // 3) EDIT
  const edited = await service.update({ user: HS, kind, id: created.id, supabase: db, payload: { ...link.linkPayload, ...editPayload } });
  assertEdited(edited);

  // 4) RELOAD AGAIN — edit persisted, untouched data preserved
  const listed2 = await service.list({ user: HS, kind, supabase: db, ...link });
  const reloaded2 = listed2.find((r) => r.id === created.id);
  assert.ok(reloaded2, 'record still present after edit');
  assertEdited(reloaded2);
  return { created, reloaded, edited, reloaded2 };
};

test('round trip: NCD Part 1 (risk-assessed)', async () => {
  const db = seedResident();
  await roundTrip({
    kind: 'ncd-risk', db,
    link: { residentId: 'res-1', linkPayload: { residentId: 'res-1' } },
    createPayload: { residentId: 'res-1', assessment_date: '2026-02-14', se_status: 'NHTS', sex: 'F', age: 48, current_smoker: 'N', binge_alcohol: 'N', weight_class: '1', htn_result: '+' },
    assertCreated: (r) => {
      assert.equal(r.se_status, 'NHTS'); assert.equal(r.age, 48); assert.equal(r.sex, 'F');
      assert.equal(r.data.current_smoker, 'N'); assert.equal(r.data.weight_class, '1'); assert.equal(r.data.htn_result, '+');
      assert.equal(r.barangay_id, 'brgy-1'); // scope trigger emulated
    },
    editPayload: { htn_result: '-', age: 49 },
    assertEdited: (r) => { assert.equal(r.data.htn_result, '-'); assert.equal(r.age, 49); assert.equal(r.data.current_smoker, 'N'); /* preserved */ },
  });
});

test('round trip: NCD Part 2 (cervical & breast)', async () => {
  const db = seedResident();
  await roundTrip({
    kind: 'ncd-cervical', db,
    link: { residentId: 'res-1', linkPayload: { residentId: 'res-1' } },
    createPayload: { residentId: 'res-1', assessment_date: '2026-03-03', age: 42, se_status: 'NHTS', risk_status: 'RISK', cervical_screening_type: 'V', cervical_result: 'N', breast_mass: 'N' },
    assertCreated: (r) => { assert.equal(r.data.cervical_screening_type, 'V'); assert.equal(r.data.cervical_result, 'N'); assert.equal(r.data.breast_mass, 'N'); },
    editPayload: { cervical_result: 'P' },
    assertEdited: (r) => { assert.equal(r.data.cervical_result, 'P'); assert.equal(r.data.cervical_screening_type, 'V'); /* preserved */ },
  });
});

test('round trip: NCD Part 3 (visual & PPV)', async () => {
  const db = seedResident();
  await roundTrip({
    kind: 'ncd-visual', db,
    link: { residentId: 'res-1', linkPayload: { residentId: 'res-1' } },
    createPayload: { residentId: 'res-1', assessment_date: '2026-01-20', osca_id_no: 'OSCA-2026-0097', se_status: 'Non-NHTS', sex: 'M', age: 67, eye_complaints: 'WITH', va_result: '20/50', with_eye_problem: 'WITH', pinhole: 'IMPROVED', ppv_date_given: '2026-01-20' },
    assertCreated: (r) => { assert.equal(r.osca_id_no, 'OSCA-2026-0097'); assert.equal(r.data.va_result, '20/50'); assert.equal(r.data.pinhole, 'IMPROVED'); assert.equal(r.data.ppv_date_given, '2026-01-20'); },
    editPayload: { va_result: '20/30', pinhole: 'NO_IMPROVEMENT' },
    assertEdited: (r) => { assert.equal(r.data.va_result, '20/30'); assert.equal(r.data.pinhole, 'NO_IMPROVEMENT'); assert.equal(r.data.ppv_date_given, '2026-01-20'); /* preserved */ },
  });
});

test('round trip: Oral Health client TCL', async () => {
  const db = seedResident();
  await roundTrip({
    kind: 'oral-health', db,
    link: { residentId: 'res-1', linkPayload: { residentId: 'res-1' } },
    createPayload: { residentId: 'res-1', consultation_date: '2026-02-10', age: 7, age_group: '5-9', se_status: 'NHTS', dmft_decayed: true, services: { OE: '2026-02-10', OHE: '2026-02-10' }, bohc: { '5-9': '2026-02-10' } },
    assertCreated: (r) => { assert.equal(r.age_group, '5-9'); assert.equal(r.data.dmft_decayed, true); assert.equal(r.data.services.OE, '2026-02-10'); assert.equal(r.data.bohc['5-9'], '2026-02-10'); },
    editPayload: { services: { TFA: '2026-02-11' } },
    assertEdited: (r) => { assert.equal(r.data.services.TFA, '2026-02-11'); assert.equal(r.data.bohc['5-9'], '2026-02-10'); /* untouched jsonb preserved */ assert.equal(r.data.dmft_decayed, true); },
  });
});

test('round trip: Environmental masterlist (household) with derived indicators', async () => {
  const db = seedHousehold();
  await roundTrip({
    kind: 'environmental', db,
    link: { householdId: 'hh-1', linkPayload: { householdId: 'hh-1' } },
    createPayload: { householdId: 'hh-1', assessment_date: '2026-02-18', se_status: 'Non-NHTS', water_supply_type: 'level2', within_premises: true, available_247: true, water_micro_result: 'ABSENT', water_physico_result: 'WITHIN', sanitary_facility_type: 'a', toilet_not_shared: true, excreta_disposal: 'a', waste_segregation: true, waste_backyard_composting: true, waste_recycling: true },
    assertCreated: (r) => {
      assert.equal(r.household_id, 'hh-1'); assert.equal(r.barangay_id, 'brgy-1');
      assert.equal(r.has_basic_safe_water, true); assert.equal(r.has_sanitary_toilet, true); assert.equal(r.complete_sanitation, true);
      assert.equal(r.data.safely_managed_water, true);
    },
    // Remove recycling -> waste practice fails -> complete sanitation recomputed false
    editPayload: { water_supply_type: 'level2', within_premises: true, available_247: true, water_micro_result: 'ABSENT', water_physico_result: 'WITHIN', sanitary_facility_type: 'a', toilet_not_shared: true, excreta_disposal: 'a', waste_segregation: true, waste_backyard_composting: false, waste_recycling: false },
    assertEdited: (r) => { assert.equal(r.complete_sanitation, false); assert.equal(r.has_basic_safe_water, true); },
  });
});

test('round trip rejects invalid enum before any save', async () => {
  const db = seedResident();
  await assert.rejects(
    () => service.create({ user: HS, kind: 'ncd-risk', supabase: db, payload: { residentId: 'res-1', se_status: 'BOGUS' } }),
    (e) => e.statusCode === 422,
  );
  assert.equal(db.__store.ncd_risk_assessments.length, 0, 'nothing persisted on validation failure');
});

test('round trip enforces barangay scope on reload', async () => {
  const db = seedResident();
  await service.create({ user: HS, kind: 'ncd-risk', supabase: db, payload: { residentId: 'res-1', se_status: 'NHTS', assessment_date: '2026-02-14' } });
  // A supervisor from another barangay must not see it.
  const other = { id: 'u2', role: 'health_supervisor', barangay: 'Other', barangayId: 'brgy-2', municipalityId: 'muni-1' };
  const listed = await service.list({ user: other, kind: 'ncd-risk', supabase: db });
  assert.equal(listed.length, 0, 'record is not visible outside its barangay scope');
});

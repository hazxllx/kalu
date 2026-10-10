import assert from 'node:assert/strict';
import test from 'node:test';

// Keep the service-layer notification helper inert (no live Supabase).
import env from '../src/config/env.js';
env.isSupabaseConfigured = false;

import { create } from '../src/services/healthServices.service.js';

/**
 * Facility/coverage derivation for creating a health service.
 *
 * The barangay is never submitted by the client: it is derived from the chosen
 * facility and the authenticated session. These tests drive the real `create`
 * through a small in-memory Supabase stub that supports the exact query chains
 * `create` -> `resolveScope`/`resolveOrCreateFacilityByName` -> `getById` use.
 */

const mho = { id: 'u-mho', name: 'MHO', role: 'mho', municipalityId: 'm1', barangayId: null };
const supervisor = { id: 'u-sup', name: 'Supervisor', role: 'health_supervisor', municipalityId: 'm1', barangayId: 'b1' };

const unescape = (pattern) => String(pattern).replace(/\\([\\%_])/g, '$1');

const makeSupabase = (seedFacilities = []) => {
  const store = {
    facilities: seedFacilities.map((f) => ({ barangay_id: null, type: 'barangay_health_station', ...f })),
    health_services: [],
    health_service_assignments: [],
  };
  let seq = 0;
  const inserts = { facilities: [], health_services: [] };

  const builder = (table) => {
    const state = { table, filters: new Map(), ilike: null, op: 'select', row: null };
    const run = () => {
      if (table === 'facilities') {
        if (state.op === 'insert') {
          const created = { id: `fac-new-${++seq}`, ...state.row };
          store.facilities.push(created);
          inserts.facilities.push(created);
          return { data: created, error: null };
        }
        let rows = store.facilities;
        if (state.filters.has('id')) rows = rows.filter((f) => f.id === state.filters.get('id'));
        if (state.filters.has('municipality_id')) rows = rows.filter((f) => f.municipality_id === state.filters.get('municipality_id'));
        if (state.ilike) {
          const want = unescape(state.ilike[1]).toLowerCase();
          rows = rows.filter((f) => String(f.name).toLowerCase() === want);
        }
        return { data: rows, error: null };
      }
      if (table === 'health_services') {
        if (state.op === 'insert') {
          const created = { id: `svc-${++seq}`, ...state.row };
          store.health_services.push(created);
          inserts.health_services.push(created);
          return { data: created, error: null };
        }
        let rows = store.health_services;
        if (state.filters.has('id')) rows = rows.filter((s) => s.id === state.filters.get('id'));
        return { data: rows, error: null };
      }
      if (table === 'health_service_assignments') {
        // No assignment lookups resolve to a row in these tests.
        return { data: [], error: null };
      }
      return { data: [], error: null };
    };
    const b = {
      select() { return b; },
      eq(col, val) { state.filters.set(col, val); return b; },
      in() { return b; },
      ilike(col, pat) { state.ilike = [col, pat]; return b; },
      order() { return b; },
      limit() { const { data, error } = run(); return Promise.resolve({ data, error }); },
      insert(row) { state.op = 'insert'; state.row = row; return b; },
      upsert() { state.op = 'upsert'; return b; },
      single() { const { data, error } = run(); return Promise.resolve({ data: Array.isArray(data) ? data[0] || null : data, error }); },
      maybeSingle() { const { data, error } = run(); return Promise.resolve({ data: Array.isArray(data) ? data[0] || null : data, error }); },
      then(onF, onR) { const { data, error } = run(); return Promise.resolve({ data, error }).then(onF, onR); },
    };
    return b;
  };

  return { client: { from: (t) => builder(t) }, store, inserts };
};

test('create: municipality-wide service has no facility and no barangay', async () => {
  const { client } = makeSupabase();
  const record = await create({ user: mho, payload: { name: 'Deworming', category: 'Other', municipalityWide: true }, supabase: client });
  assert.equal(record.facilityId, null);
  assert.equal(record.barangayId, null);
});

test('create: no facility chosen defaults to municipality-wide coverage', async () => {
  const { client } = makeSupabase();
  const record = await create({ user: mho, payload: { name: 'Nutrition Month', category: 'Other' }, supabase: client });
  assert.equal(record.facilityId, null);
  assert.equal(record.barangayId, null);
});

test('create: an RHU facility is treated as a facility, never a barangay', async () => {
  const { client } = makeSupabase([{ id: 'fac-rhu', municipality_id: 'm1', name: 'Main RHU', type: 'rhu', barangay_id: null }]);
  const record = await create({ user: mho, payload: { name: 'Consultation', category: 'Consultation', facilityId: 'fac-rhu' }, supabase: client });
  assert.equal(record.facilityId, 'fac-rhu');
  assert.equal(record.barangayId, null, 'RHU service must not carry a barangay');
});

test('create: an existing BHS facility scopes the service to its barangay', async () => {
  const { client } = makeSupabase([{ id: 'fac-bhs', municipality_id: 'm1', name: 'Barangay 1 Health Center', type: 'barangay_health_station', barangay_id: 'b1' }]);
  const record = await create({ user: mho, payload: { name: 'Prenatal', category: 'Maternal', facilityId: 'fac-bhs' }, supabase: client });
  assert.equal(record.facilityId, 'fac-bhs');
  assert.equal(record.barangayId, 'b1');
});

test('create: a supervisor typing a new facility creates a BHS in their own barangay', async () => {
  const { client, inserts } = makeSupabase();
  const record = await create({ user: supervisor, payload: { name: 'Prenatal', category: 'Maternal', facilityName: 'Purok 5 Health Post' }, supabase: client });
  assert.equal(inserts.facilities.length, 1, 'a new facility is created');
  assert.equal(inserts.facilities[0].type, 'barangay_health_station');
  assert.equal(inserts.facilities[0].barangay_id, 'b1', 'tied to the supervisor assigned barangay from the session');
  assert.equal(record.barangayId, 'b1');
});

test('create: an existing facility name is reused, never duplicated (case-insensitive)', async () => {
  const { client, inserts } = makeSupabase([{ id: 'fac-bhs', municipality_id: 'm1', name: 'Barangay 1 Health Center', type: 'barangay_health_station', barangay_id: 'b1' }]);
  const record = await create({ user: supervisor, payload: { name: 'Immunization', category: 'Immunization', facilityName: 'barangay 1 health center' }, supabase: client });
  assert.equal(inserts.facilities.length, 0, 'no duplicate facility is created');
  assert.equal(record.facilityId, 'fac-bhs');
  assert.equal(record.barangayId, 'b1');
});

test('create: a supervisor cannot attach a BHS from another barangay', async () => {
  const { client } = makeSupabase([{ id: 'fac-other', municipality_id: 'm1', name: 'Barangay 2 Health Center', type: 'barangay_health_station', barangay_id: 'b2' }]);
  await assert.rejects(
    () => create({ user: supervisor, payload: { name: 'Prenatal', category: 'Maternal', facilityId: 'fac-other' }, supabase: client }),
    /not in your assigned barangay/i,
  );
});

test('create: a facility outside the caller municipality is rejected', async () => {
  const { client } = makeSupabase([{ id: 'fac-x', municipality_id: 'm2', name: 'Other Town RHU', type: 'rhu', barangay_id: null }]);
  await assert.rejects(
    () => create({ user: mho, payload: { name: 'Consultation', category: 'Consultation', facilityId: 'fac-x' }, supabase: client }),
    /not in your municipality/i,
  );
});

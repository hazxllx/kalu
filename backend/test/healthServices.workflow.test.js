import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as hs from '../src/services/healthServices.service.js';

/**
 * Health services tests — scoped catalog + personnel assignment.
 *
 * Verifies that a created service is municipality/barangay scoped, a Health
 * Supervisor is forced to their own barangay, an ASSIGNED service appears in the
 * assignee's account (list mine), a municipality-wide role sees a barangay
 * service while an unrelated barangay-scoped user does not, and non-managers
 * cannot create. The Supabase client is an in-memory stub.
 */

const MHO = { id: 'mho-1', role: 'mho', municipalityId: 'mun-1' };
const PHN = { id: 'phn-1', role: 'phn', municipalityId: 'mun-1' };
const HS_A = { id: 'hs-a', role: 'health_supervisor', municipalityId: 'mun-1', barangayId: 'brgy-a' };
const HS_B = { id: 'hs-b', role: 'health_supervisor', municipalityId: 'mun-1', barangayId: 'brgy-b' };
const BHW = { id: 'bhw-1', role: 'bhw', municipalityId: 'mun-1', barangayId: 'brgy-a' };

let db;

const matches = (row, f) =>
  f.eq.every(([c, v]) => row[c] === v) && f.in.every(([c, arr]) => arr.includes(row[c]));

const makeBuilder = (table) => {
  const state = { table, op: 'select', payload: null, f: { eq: [], in: [] } };
  const rowsFor = () => (db[table] ||= []);
  const applied = () => rowsFor().filter((r) => matches(r, state.f));
  const genId = () => `${table}-${rowsFor().length + 1}`;
  const doInsert = (payload) => {
    const list = Array.isArray(payload) ? payload : [payload];
    const inserted = list.map((p) => ({ id: p.id || genId(), created_at: new Date().toISOString(), ...p }));
    rowsFor().push(...inserted);
    return inserted;
  };
  const doUpsert = (payload) => {
    const list = Array.isArray(payload) ? payload : [payload];
    for (const p of list) {
      const existing = rowsFor().find((r) => r.service_id === p.service_id && r.personnel_id === p.personnel_id);
      if (existing) Object.assign(existing, p);
      else rowsFor().push({ id: genId(), created_at: new Date().toISOString(), ...p });
    }
  };
  const b = {
    select() { return this; },
    insert(payload) { state.op = 'insert'; state.payload = payload; return this; },
    update(payload) { state.op = 'update'; state.payload = payload; return this; },
    upsert(payload) { state.op = 'upsert'; state.payload = payload; return this; },
    eq(c, v) { state.f.eq.push([c, v]); return this; },
    in(c, arr) { state.f.in.push([c, arr]); return this; },
    order() { return this; },
    maybeSingle() { return Promise.resolve({ data: applied()[0] || null, error: null }); },
    single() {
      if (state.op === 'insert') return Promise.resolve({ data: doInsert(state.payload)[0], error: null });
      return Promise.resolve({ data: applied()[0] || null, error: null });
    },
    then(resolve) {
      if (state.op === 'insert') return resolve({ data: doInsert(state.payload), error: null });
      if (state.op === 'upsert') { doUpsert(state.payload); return resolve({ data: null, error: null }); }
      if (state.op === 'update') {
        const targets = applied();
        targets.forEach((t) => Object.assign(t, state.payload));
        return resolve({ data: targets, error: null });
      }
      return resolve({ data: applied(), error: null });
    },
  };
  return b;
};

const supabase = { from: (table) => makeBuilder(table) };

beforeEach(() => {
  db = {
    health_services: [],
    health_service_assignments: [],
    facilities: [{ id: 'fac-rhu', municipality_id: 'mun-1', type: 'rhu' }],
    barangays: [
      { id: 'brgy-a', municipality_id: 'mun-1' },
      { id: 'brgy-b', municipality_id: 'mun-1' },
    ],
    profiles: [
      { id: 'phn-1', full_name: 'PHN One', email: 'phn@x', role: 'phn', municipality_id: 'mun-1', status: 'active', barangay_id: null },
      { id: 'hs-a', full_name: 'HS A', email: 'hsa@x', role: 'health_supervisor', municipality_id: 'mun-1', status: 'active', barangay_id: 'brgy-a' },
    ],
  };
});

test('a non-manager (BHW) cannot create a health service', async () => {
  await assert.rejects(
    () => hs.create({ user: BHW, payload: { name: 'X' }, supabase }),
    (e) => e.statusCode === 403,
  );
});

test('assignable personnel results are municipality-scoped and barangay-scoped for a Health Supervisor', async () => {
  const hsPersonnel = await hs.assignablePersonnel({ user: HS_A, supabase });
  assert.deepEqual(hsPersonnel.map((person) => person.id), ['hs-a']);

  const phnPersonnel = await hs.assignablePersonnel({ user: PHN, supabase });
  assert.deepEqual(phnPersonnel.map((person) => person.id).sort(), ['hs-a', 'phn-1']);
});

test('PHN creates a municipality-wide service (no barangay)', async () => {
  const svc = await hs.create({ user: PHN, payload: { name: 'Family Planning', category: 'Family Planning' }, supabase });
  assert.equal(svc.name, 'Family Planning');
  assert.equal(svc.category, 'Family Planning');
  assert.equal(svc.municipalityId, 'mun-1');
  assert.equal(svc.barangayId, null);
});

test('a Health Supervisor service is forced to their assigned barangay', async () => {
  // Even if the payload tries another barangay, HS is pinned to their own.
  const svc = await hs.create({ user: HS_A, payload: { name: 'Prenatal', category: 'Maternal', barangayId: 'brgy-b' }, supabase });
  assert.equal(svc.barangayId, 'brgy-a');
});

test('an assigned service appears in the assignee account (list mine)', async () => {
  const svc = await hs.create({ user: PHN, payload: { name: 'Immunization', category: 'Immunization' }, supabase });
  await hs.assign({ user: PHN, serviceId: svc.id, personnelId: 'hs-a', supabase });

  const mine = await hs.list({ user: HS_A, mine: true, supabase });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, svc.id);

  // A different supervisor has no assignment and no barangay match.
  const notMine = await hs.list({ user: HS_B, mine: true, supabase });
  assert.equal(notMine.length, 0);
});

test('municipality-wide role sees a barangay service; unrelated barangay user does not', async () => {
  const svc = await hs.create({ user: HS_A, payload: { name: 'Postpartum', category: 'Maternal' }, supabase });

  // MHO (municipality-wide) sees the brgy-a service.
  const mhoView = await hs.list({ user: MHO, supabase });
  assert.ok(mhoView.some((s) => s.id === svc.id));

  // HS in brgy-b does not see a brgy-a service (not assigned, different barangay).
  const hsBView = await hs.list({ user: HS_B, supabase });
  assert.equal(hsBView.some((s) => s.id === svc.id), false);
});

/* --------------------------- BUG-004 IDOR ------------------------------- */

test('BUG-004: a Health Supervisor cannot getById an out-of-barangay service (404)', async () => {
  const svc = await hs.create({ user: HS_A, payload: { name: 'Postpartum', category: 'Maternal' }, supabase });
  await assert.rejects(
    () => hs.getById({ user: HS_B, id: svc.id, supabase }),
    (e) => e.statusCode === 404,
  );
});

test('BUG-004: a role from another municipality cannot getById a service (404)', async () => {
  const svc = await hs.create({ user: PHN, payload: { name: 'Family Planning', category: 'Family Planning' }, supabase });
  const otherMuniMho = { id: 'mho-2', role: 'mho', municipalityId: 'mun-2' };
  await assert.rejects(
    () => hs.getById({ user: otherMuniMho, id: svc.id, supabase }),
    (e) => e.statusCode === 404,
  );
});

test('BUG-004: a Health Supervisor cannot assign/unassign on an out-of-barangay service (404)', async () => {
  const svc = await hs.create({ user: HS_A, payload: { name: 'Postpartum', category: 'Maternal' }, supabase });
  await assert.rejects(
    () => hs.assign({ user: HS_B, serviceId: svc.id, personnelId: 'phn-1', supabase }),
    (e) => e.statusCode === 404,
  );
  await assert.rejects(
    () => hs.unassign({ user: HS_B, serviceId: svc.id, personnelId: 'phn-1', supabase }),
    (e) => e.statusCode === 404,
  );
});

test('BUG-004: a Health Supervisor cannot manage a municipality-wide service (404)', async () => {
  const svc = await hs.create({ user: PHN, payload: { name: 'Immunization', category: 'Immunization' }, supabase });
  await assert.rejects(
    () => hs.assign({ user: HS_A, serviceId: svc.id, personnelId: 'phn-1', supabase }),
    (e) => e.statusCode === 404,
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

// Keep the service-layer notification helper inert (no live Supabase).
import env from '../src/config/env.js';
env.isSupabaseConfigured = false;

import { update, remove } from '../src/services/healthServices.service.js';

/**
 * In-place update + safe delete for a health service.
 *
 * These drive the real `update`/`remove` through a small stub that supports the
 * exact query chains they use: manageableService (scope read), the TABLE
 * update/delete, personnel upsert/deactivate, dependent-record counts, and the
 * getById re-read. The stub mutates an in-memory `current` row so the returned
 * record reflects the write.
 */

const SERVICE_ID = '11111111-1111-1111-1111-111111111111';
const mho = { id: 'u-mho', name: 'MHO', role: 'mho', municipalityId: 'm1', barangayId: null };
const supervisor = { id: 'u-sup', name: 'Supervisor', role: 'health_supervisor', municipalityId: 'm1', barangayId: 'b1' };

const baseService = () => ({
  id: SERVICE_ID,
  name: 'Prenatal',
  category: 'Maternal',
  description: 'Old description',
  municipality_id: 'm1',
  facility_id: null,
  barangay_id: 'b1',
  start_date: '2026-02-01',
  start_time: '08:00',
  end_date: '2026-02-01',
  end_time: '12:00',
  registration_deadline: null,
  active: true,
  created_by: 'u-sup',
  created_at: '2026-01-01T00:00:00Z',
  health_service_assignments: [],
});

const makeSupabase = ({ service, dependents = { visit_plans: 0, health_service_attendance: 0, appointments: 0 } }) => {
  let current = { ...service };
  const calls = { updates: [], deletes: [], assignUpserts: [], assignUpdates: [], countTables: [] };

  const from = (table) => {
    const ctx = { table, op: 'select', payload: null, filters: { eq: {}, in: {} } };
    const resolve = () => {
      if (table === 'health_services') {
        if (ctx.op === 'update') { calls.updates.push(ctx.payload); current = { ...current, ...ctx.payload }; return { data: null, error: null }; }
        if (ctx.op === 'delete') { calls.deletes.push({ ...ctx.filters.eq }); return { data: null, error: null }; }
        return { data: current, error: null };
      }
      if (table === 'health_service_assignments') {
        if (ctx.op === 'upsert') { calls.assignUpserts.push(ctx.payload); return { data: null, error: null }; }
        if (ctx.op === 'update') { calls.assignUpdates.push({ patch: ctx.payload, filters: { ...ctx.filters } }); return { data: null, error: null }; }
        return { data: [], error: null };
      }
      if (table === 'visit_plans') { calls.countTables.push('visit_plans'); return { data: [], count: dependents.visit_plans, error: null }; }
      if (table === 'health_service_attendance') { calls.countTables.push('attendance'); return { data: [], count: dependents.health_service_attendance, error: null }; }
      if (table === 'appointments') { calls.countTables.push('appointments'); return { data: [], count: dependents.appointments, error: null }; }
      return { data: [], error: null };
    };
    const chain = {
      select() { return chain; },
      update(p) { ctx.op = 'update'; ctx.payload = p; return chain; },
      upsert(p) { ctx.op = 'upsert'; ctx.payload = p; return chain; },
      delete() { ctx.op = 'delete'; return chain; },
      insert(p) { ctx.op = 'insert'; ctx.payload = p; return chain; },
      eq(c, v) { ctx.filters.eq[c] = v; return chain; },
      in(c, v) { ctx.filters.in[c] = v; return chain; },
      order() { return chain; },
      limit() { return Promise.resolve(resolve()); },
      maybeSingle() { const r = resolve(); return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }); },
      single() { const r = resolve(); return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }); },
      then(onF, onR) { return Promise.resolve(resolve()).then(onF, onR); },
    };
    return chain;
  };
  return { client: { from }, calls, getCurrent: () => current };
};

test('update: edits content in place, preserving the service id (never creates a new row)', async () => {
  const { client, calls } = makeSupabase({ service: baseService() });
  const record = await update({
    user: supervisor,
    serviceId: SERVICE_ID,
    payload: { name: 'Prenatal Care', description: 'New description' },
    supabase: client,
  });
  assert.equal(record.id, SERVICE_ID, 'id is preserved');
  assert.equal(record.name, 'Prenatal Care');
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].name, 'Prenatal Care');
  assert.equal(calls.updates[0].description, 'New description');
  // No coverage fields were sent, so the barangay must not be touched.
  assert.ok(!('barangay_id' in calls.updates[0]), 'coverage is left untouched when not edited');
});

test('update: a status-only payload toggles active without altering the schedule', async () => {
  const { client, calls } = makeSupabase({ service: baseService() });
  await update({ user: supervisor, serviceId: SERVICE_ID, payload: { active: false }, supabase: client });
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].active, false);
  assert.ok(!('name' in calls.updates[0]));
  assert.ok(!('start_date' in calls.updates[0]));
});

test('update: reconciles personnel — adds new, deactivates removed', async () => {
  const service = baseService();
  service.health_service_assignments = [
    { id: 'a1', personnel_id: 'p-old', active: true, personnel: { full_name: 'Old', role: 'bhw' } },
  ];
  const { client, calls } = makeSupabase({ service });
  await update({
    user: supervisor,
    serviceId: SERVICE_ID,
    payload: { name: 'Prenatal', personnelIds: ['p-new'] },
    supabase: client,
  });
  // p-new is added via upsert, p-old is deactivated (soft remove, never deleted).
  assert.equal(calls.assignUpserts.length, 1);
  assert.deepEqual(calls.assignUpserts[0].map((r) => r.personnel_id), ['p-new']);
  assert.equal(calls.assignUpdates.length, 1);
  assert.equal(calls.assignUpdates[0].patch.active, false);
  assert.deepEqual(calls.assignUpdates[0].filters.in.personnel_id, ['p-old']);
});

test('update: a supervisor cannot edit a service outside their barangay (404)', async () => {
  const service = baseService();
  service.barangay_id = 'b2'; // different barangay
  const { client } = makeSupabase({ service });
  await assert.rejects(
    () => update({ user: supervisor, serviceId: SERVICE_ID, payload: { name: 'Hijack' }, supabase: client }),
    (err) => err.statusCode === 404,
  );
});

test('remove: hard-deletes a service with no dependent records', async () => {
  const { client, calls } = makeSupabase({ service: baseService() });
  const result = await remove({ user: mho, serviceId: SERVICE_ID, supabase: client });
  assert.equal(result.deleted, true);
  assert.equal(result.id, SERVICE_ID);
  assert.equal(calls.deletes.length, 1, 'the service row is deleted');
  assert.equal(calls.deletes[0].id, SERVICE_ID);
});

test('remove: refuses to delete a service that has registrations (409), preserving records', async () => {
  const { client, calls } = makeSupabase({ service: baseService(), dependents: { visit_plans: 3, health_service_attendance: 0 } });
  await assert.rejects(
    () => remove({ user: mho, serviceId: SERVICE_ID, supabase: client }),
    (err) => err.statusCode === 409 && /deactivate/i.test(err.message),
  );
  assert.equal(calls.deletes.length, 0, 'nothing is deleted when dependents exist');
});

test('remove: refuses to delete a service that has attendance records (409)', async () => {
  const { client, calls } = makeSupabase({ service: baseService(), dependents: { visit_plans: 0, health_service_attendance: 2 } });
  await assert.rejects(
    () => remove({ user: mho, serviceId: SERVICE_ID, supabase: client }),
    (err) => err.statusCode === 409,
  );
  assert.equal(calls.deletes.length, 0);
});

test('remove: refuses to delete a service that has booked appointments (409)', async () => {
  const { client, calls } = makeSupabase({ service: baseService(), dependents: { visit_plans: 0, health_service_attendance: 0, appointments: 1 } });
  await assert.rejects(
    () => remove({ user: mho, serviceId: SERVICE_ID, supabase: client }),
    (err) => err.statusCode === 409,
  );
  assert.equal(calls.deletes.length, 0);
});

test('remove: a supervisor cannot delete a service outside their barangay (404)', async () => {
  const service = baseService();
  service.barangay_id = 'b2';
  const { client, calls } = makeSupabase({ service });
  await assert.rejects(
    () => remove({ user: supervisor, serviceId: SERVICE_ID, supabase: client }),
    (err) => err.statusCode === 404,
  );
  assert.equal(calls.deletes.length, 0);
});

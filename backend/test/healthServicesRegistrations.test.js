import assert from 'node:assert/strict';
import test from 'node:test';

// Keep the service-layer notification helper inert (no live Supabase).
import env from '../src/config/env.js';
env.isSupabaseConfigured = false;

import { listServiceRegistrations } from '../src/services/healthServices.service.js';

/**
 * Thenable Supabase builder stub (same shape as visitPlans.test.js). The
 * resolver returns { data, error } based on the table + accumulated filters;
 * both `await chain` and `.single()/.maybeSingle()` are supported.
 */
const makeSupabase = (resolve) => {
  const makeChain = (table) => {
    const ctx = { table, op: 'select', filters: { eq: {}, in: {} }, payload: null, single: false };
    const chain = {
      ctx,
      select() { return chain; },
      insert(p) { ctx.op = 'insert'; ctx.payload = p; return chain; },
      update(p) { ctx.op = 'update'; ctx.payload = p; return chain; },
      delete() { ctx.op = 'delete'; return chain; },
      eq(c, v) { ctx.filters.eq[c] = v; return chain; },
      in(c, v) { ctx.filters.in[c] = v; return chain; },
      gte(c, v) { ctx.filters.gte = { c, v }; return chain; },
      lte(c, v) { ctx.filters.lte = { c, v }; return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle() { ctx.single = true; return Promise.resolve(resolve(ctx)); },
      single() { ctx.single = true; return Promise.resolve(resolve(ctx)); },
      then(onF, onR) { return Promise.resolve(resolve(ctx)).then(onF, onR); },
    };
    return chain;
  };
  return { from(table) { return makeChain(table); } };
};

const ok = (data) => ({ data, error: null });

const SERVICE_ID = '11111111-1111-1111-1111-111111111111';
const bhcService = { id: SERVICE_ID, name: 'Blood Pressure Monitoring', municipality_id: 'm1', barangay_id: 'b1', active: true };

const mho = { id: 'u-mho', role: 'mho', municipalityId: 'm1', barangayId: null };
const supervisor = { id: 'u-sup', role: 'health_supervisor', municipalityId: 'm1', barangayId: 'b1' };

const plans = [
  { id: 'p1', resident_id: 'r1', barangay_id: 'b1', facility_type: 'BHC', planned_date: '2026-01-12', note: 'Bringing my child', status: 'Planned', created_at: '2026-01-05T08:00:00Z' },
  { id: 'p2', resident_id: 'r2', barangay_id: 'b1', facility_type: 'BHC', planned_date: '2026-01-13', note: '', status: 'Planned', created_at: '2026-01-05T09:00:00Z' },
  { id: 'p3', resident_id: 'r3', barangay_id: 'b1', facility_type: 'BHC', planned_date: '2026-01-10', note: '', status: 'Cancelled', created_at: '2026-01-04T09:00:00Z' },
];
const residents = [
  { id: 'r1', first_name: 'Juana', middle_name: '', last_name: 'Dela Cruz', barangay: 'San Isidro' },
  { id: 'r2', first_name: 'Pedro', middle_name: 'S', last_name: 'Santos', barangay: 'San Isidro' },
  { id: 'r3', first_name: 'Maria', middle_name: '', last_name: 'Reyes', barangay: 'San Isidro' },
];
const attendance = [
  { id: 'a1', resident_id: 'r1', attendance_status: 'attended', attended_at: '2026-01-12T08:30:00Z', scheduled_date: '2026-01-12' },
];

test('listServiceRegistrations returns registered residents with attendance and counts (municipality-wide role)', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'health_services') return ok(bhcService);
    if (ctx.table === 'visit_plans') return ok(plans);
    if (ctx.table === 'residents') return ok(residents);
    if (ctx.table === 'health_service_attendance') return ok(attendance);
    return ok(null);
  });

  const result = await listServiceRegistrations({ user: mho, serviceId: SERVICE_ID, supabase });

  assert.equal(result.registrations.length, 3);
  const r1 = result.registrations.find((r) => r.residentId === 'r1');
  assert.equal(r1.residentName, 'Juana Dela Cruz');
  assert.equal(r1.barangay, 'San Isidro');
  assert.equal(r1.status, 'Planned');
  assert.equal(r1.attendance.status, 'attended');
  assert.equal(r1.registeredAt, '2026-01-05T08:00:00Z');

  // Counts: two active (Planned) registrations, one attended, one not recorded,
  // one cancelled.
  assert.equal(result.counts.registered, 2);
  assert.equal(result.counts.attended, 1);
  assert.equal(result.counts.pendingAttendance, 1);
  assert.equal(result.counts.cancelled, 1);
});

test('listServiceRegistrations confines a barangay-scoped role to their own barangay', async () => {
  let planFilters = null;
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'health_services') return ok(bhcService);
    if (ctx.table === 'visit_plans') {
      planFilters = ctx.filters.eq;
      return ok(plans);
    }
    if (ctx.table === 'residents') return ok(residents);
    if (ctx.table === 'health_service_attendance') return ok(attendance);
    return ok(null);
  });

  await listServiceRegistrations({ user: supervisor, serviceId: SERVICE_ID, supabase });
  assert.equal(planFilters.service_id, SERVICE_ID);
  assert.equal(planFilters.barangay_id, 'b1'); // scoped to the supervisor's own barangay
});

test('listServiceRegistrations rejects a service outside the caller scope with 404', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'health_services') return ok({ ...bhcService, municipality_id: 'other' });
    if (ctx.table === 'health_service_assignments') return ok(null); // not assigned
    return ok(null);
  });
  await assert.rejects(
    () => listServiceRegistrations({ user: mho, serviceId: SERVICE_ID, supabase }),
    (err) => err.statusCode === 404,
  );
});

test('listServiceRegistrations returns an empty roster for a barangay-scoped caller with no barangay', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'health_services') return ok({ ...bhcService, barangay_id: null });
    return ok(null);
  });
  const result = await listServiceRegistrations({ user: { ...supervisor, barangayId: null }, serviceId: SERVICE_ID, supabase });
  assert.deepEqual(result.registrations, []);
  assert.equal(result.counts.registered, 0);
});

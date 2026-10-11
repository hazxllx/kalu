// Resident visit-plan (Health Services) registration — backend logic tests.
//
// These exercise the REAL service functions (serviceAvailability + createPlan)
// with an injected in-memory Supabase stub and a fixed `now`, so the
// registration-window math is verified without a live database.
//
// Focus: the registration deadline is honored correctly (a deadline date keeps
// registration open through that whole day, in Philippine local time), while
// the legitimate restrictions (closed, past deadline, duplicate, out-of-window)
// are preserved. Run with the project's node test runner:
//   node --test tests/visitPlans.availability.test.js

import assert from 'node:assert/strict';
import test from 'node:test';

import { serviceAvailability, createPlan } from '../src/services/visitPlans.service.js';

// --- minimal chainable Supabase stub ----------------------------------------
function baseBuilder(data) {
  const asArray = Array.isArray(data) ? data : data == null ? [] : [data];
  const single = Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
  const b = {};
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit']) b[m] = () => b;
  b.maybeSingle = async () => ({ data: single, error: null });
  b.single = async () => ({ data: single, error: null });
  b.then = (resolve, reject) => Promise.resolve({ data: asArray, error: null }).then(resolve, reject);
  return b;
}

function makeSupabase(config = {}) {
  const inserts = [];
  const client = {
    _inserts: inserts,
    from(table) {
      if (table === 'visit_plans') {
        const cfg = config.visit_plans || {};
        const b = baseBuilder(cfg.existing || []);
        b.insert = (row) => {
          inserts.push(row);
          return baseBuilder({ ...row, id: cfg.insertedId || 'plan-1' });
        };
        return b;
      }
      return baseBuilder(config[table]);
    },
  };
  return client;
}

const USER = { id: 'auth-1', role: 'resident' };
const RESIDENT = {
  id: 'res-1',
  auth_user_id: 'auth-1',
  barangay_id: 'brgy-1',
  municipality_id: 'mun-1',
  barangay: 'Barangay 1',
  first_name: 'Ana',
  last_name: 'Cruz',
};

// A one-time ("dated") barangay program in the resident's own barangay.
const datedService = (overrides = {}) => ({
  id: 'svc-1',
  name: 'Immunization Day',
  description: '',
  active: true,
  visit_policy: 'walk_in',
  municipality_id: 'mun-1',
  barangay_id: 'brgy-1',
  start_date: '2026-10-25',
  start_time: '09:00',
  end_date: '2026-10-25',
  end_time: '12:00',
  registration_deadline: '2026-10-20T00:00:00',
  ...overrides,
});

// Fixed instant: 2026-10-15 02:00 UTC === 2026-10-15 10:00 Philippine time.
const NOW = new Date('2026-10-15T02:00:00Z');

test('open: future deadline (date picked at midnight) keeps registration open', async () => {
  const supabase = makeSupabase({ residents: RESIDENT, health_services: datedService(), appointment_blackouts: [] });
  const res = await serviceAvailability({ user: USER, serviceId: 'svc-1', supabase, now: NOW });
  assert.equal(res.availability.open, true);
  assert.equal(res.availability.reason, null);
  assert.equal(res.available, true);
  assert.ok(res.dates.some((d) => d.date === '2026-10-25'));
});

test('bug fix: a deadline of TODAY (stored midnight) stays open all of today', async () => {
  // Before the fix this closed at 00:00 (start of the deadline day), so a
  // resident at 10:00 was wrongly rejected. The event itself is today.
  const service = datedService({
    registration_deadline: '2026-10-15T00:00:00',
    start_date: '2026-10-15',
    end_date: '2026-10-15',
  });
  const supabase = makeSupabase({ residents: RESIDENT, health_services: service, appointment_blackouts: [] });
  const res = await serviceAvailability({ user: USER, serviceId: 'svc-1', supabase, now: NOW });
  assert.equal(res.availability.open, true, 'registration must stay open through the deadline day');
  assert.equal(res.available, true);
});

test('closed: a deadline earlier today is correctly past (registration_closed)', async () => {
  const service = datedService({ registration_deadline: '2026-10-15T08:00:00' }); // 08:00 < now 10:00 PH
  const supabase = makeSupabase({ residents: RESIDENT, health_services: service, appointment_blackouts: [] });
  const res = await serviceAvailability({ user: USER, serviceId: 'svc-1', supabase, now: NOW });
  assert.equal(res.availability.open, false);
  assert.equal(res.availability.reason, 'registration_closed');
});

test('createPlan: eligible resident registers and the row is persisted', async () => {
  const supabase = makeSupabase({
    residents: RESIDENT,
    health_services: datedService(),
    appointment_blackouts: [],
    visit_plans: { existing: [] },
    profiles: [],
  });
  const result = await createPlan({ user: USER, serviceId: 'svc-1', plannedDate: '2026-10-25', note: 'See you', supabase, now: NOW });
  assert.equal(result.plan.serviceId, 'svc-1');
  assert.equal(result.plan.plannedDate, '2026-10-25');
  assert.equal(supabase._inserts.length, 1);
  assert.equal(supabase._inserts[0].resident_id, 'res-1');
  assert.equal(supabase._inserts[0].service_id, 'svc-1');
  assert.equal(supabase._inserts[0].planned_date, '2026-10-25');
  assert.equal(supabase._inserts[0].status, 'Planned');
});

test('createPlan: closed registration is rejected and nothing is persisted', async () => {
  const supabase = makeSupabase({
    residents: RESIDENT,
    health_services: datedService({ registration_deadline: '2026-10-10T17:00:00' }),
    appointment_blackouts: [],
    visit_plans: { existing: [] },
    profiles: [],
  });
  await assert.rejects(
    () => createPlan({ user: USER, serviceId: 'svc-1', plannedDate: '2026-10-25', supabase, now: NOW }),
    /closed/i,
  );
  assert.equal(supabase._inserts.length, 0);
});

test('createPlan: duplicate active plan is rejected (no overbooking of the same service)', async () => {
  const supabase = makeSupabase({
    residents: RESIDENT,
    health_services: datedService(),
    appointment_blackouts: [],
    visit_plans: { existing: [{ id: 'plan-0', planned_date: '2026-10-25' }] },
    profiles: [],
  });
  await assert.rejects(
    () => createPlan({ user: USER, serviceId: 'svc-1', plannedDate: '2026-10-25', supabase, now: NOW }),
    /already have a visit plan/i,
  );
  assert.equal(supabase._inserts.length, 0);
});

test('createPlan: a day outside the service window is rejected', async () => {
  const supabase = makeSupabase({
    residents: RESIDENT,
    health_services: datedService(), // event only on 2026-10-25
    appointment_blackouts: [],
    visit_plans: { existing: [] },
    profiles: [],
  });
  await assert.rejects(
    () => createPlan({ user: USER, serviceId: 'svc-1', plannedDate: '2026-10-26', supabase, now: NOW }),
    /not offered on the selected day/i,
  );
  assert.equal(supabase._inserts.length, 0);
});

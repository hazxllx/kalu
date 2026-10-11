import assert from 'node:assert/strict';
import test from 'node:test';

// Neutralize the real notification side-effect helper so the unit tests never
// touch a live Supabase project (notifyResident is a no-op when unconfigured).
import env from '../src/config/env.js';
env.isSupabaseConfigured = false;

import {
  listDirectory,
  serviceAvailability,
  createPlan,
  removePlan,
  listOwnPlans,
} from '../src/services/visitPlans.service.js';
import {
  createPlanValidator,
  availabilityQueryValidator,
  listQueryValidator,
  idParamValidator,
} from '../src/validators/visitPlans.validators.js';

/**
 * Thenable Supabase builder stub (same shape as appointments.test.js). The
 * resolver returns { data, error } based on the table + operation + accumulated
 * filters; both `await chain` and `.single()/.maybeSingle()` are supported.
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

// Monday, 5 Jan 2026 (UTC). Weekdays: Mon=1, Wed=3, Fri=5.
const NOW = new Date(Date.UTC(2026, 0, 5));

const resident = {
  id: 'r1', auth_user_id: 'u1', barangay_id: 'b1', municipality_id: 'm1', barangay: 'San Isidro',
  first_name: 'Juana', middle_name: '', last_name: 'Dela Cruz',
};
const residentUser = { id: 'u1', role: 'resident' };

const bhcService = { id: 'svc-bhc', name: 'Blood Pressure Monitoring', description: 'Check-up.', municipality_id: 'm1', barangay_id: 'b1', active: true, visit_policy: 'walk_in' };
const rhuService = { id: 'svc-rhu', name: 'Prenatal Care', description: 'For expecting mothers.', municipality_id: 'm1', barangay_id: null, active: true, visit_policy: 'by_notice' };

test('listDirectory groups services by facility and embeds the resident plan', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'health_services') return ok([bhcService, rhuService]);
    if (ctx.table === 'appointment_schedules') {
      return ok([
        { service_id: 'svc-bhc', weekday: 1, start_time: '08:00:00', end_time: '11:00:00', barangay_id: 'b1', active: true },
        { service_id: 'svc-rhu', weekday: 3, start_time: '13:00:00', end_time: '15:00:00', barangay_id: null, active: true },
      ]);
    }
    if (ctx.table === 'appointment_blackouts') return ok([]);
    if (ctx.table === 'visit_plans') return ok([{ id: 'p1', service_id: 'svc-bhc', planned_date: '2026-01-12', note: 'Bringing my child', status: 'Planned' }]);
    if (ctx.table === 'facilities') return ok([{ name: 'Sta. Maria', type: 'rhu', municipality_id: 'm1' }]);
    return ok(null);
  });

  const result = await listDirectory({ user: residentUser, supabase, now: NOW });
  assert.equal(result.facilities.length, 2);
  const bhc = result.facilities[0];
  const rhu = result.facilities[1];
  assert.equal(bhc.type, 'BHC');
  assert.equal(bhc.name, 'San Isidro');
  assert.equal(bhc.services[0].facilityType, 'BHC');
  assert.equal(bhc.services[0].plan.plannedDate, '2026-01-12');
  assert.equal(bhc.services[0].hasUpcoming, true);
  assert.deepEqual(bhc.services[0].weekdays, [1]);
  assert.equal(rhu.type, 'RHU');
  assert.equal(rhu.name, 'Sta. Maria');
  assert.equal(rhu.services[0].visitPolicy, 'by_notice');
  assert.equal(rhu.services[0].plan, null);
});

test('listDirectory: an UNRELATED past attendance record does not mislabel a future plan (stays Registered + cancelable)', async () => {
  // The resident attended this service on an earlier date, then registered
  // again for a future day. The future plan must stay "Registered" (so the
  // "Cancel registration" action shows) — the stale attendance record for the
  // old date must not leak onto the new plan.
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'health_services') return ok([bhcService]);
    if (ctx.table === 'appointment_schedules') {
      return ok([{ service_id: 'svc-bhc', weekday: 1, start_time: '08:00:00', end_time: '11:00:00', barangay_id: 'b1', active: true }]);
    }
    if (ctx.table === 'appointment_blackouts') return ok([]);
    if (ctx.table === 'visit_plans') return ok([{ id: 'p1', service_id: 'svc-bhc', planned_date: '2026-01-12', note: '', status: 'Planned' }]);
    if (ctx.table === 'health_service_attendance') {
      return ok([{ service_id: 'svc-bhc', attendance_status: 'attended', scheduled_date: '2025-12-01' }]);
    }
    if (ctx.table === 'facilities') return ok([{ name: 'Sta. Maria', type: 'rhu', municipality_id: 'm1' }]);
    return ok(null);
  });

  const result = await listDirectory({ user: residentUser, supabase, now: NOW });
  const svc = result.facilities[0].services[0];
  assert.equal(svc.plan.plannedDate, '2026-01-12');
  assert.equal(svc.plan.status, 'Registered');
  assert.equal(svc.plan.attendanceStatus, null);
});

test('listDirectory: an attendance record ON the plan date drives the plan status (Attended)', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'health_services') return ok([bhcService]);
    if (ctx.table === 'appointment_schedules') {
      return ok([{ service_id: 'svc-bhc', weekday: 1, start_time: '08:00:00', end_time: '11:00:00', barangay_id: 'b1', active: true }]);
    }
    if (ctx.table === 'appointment_blackouts') return ok([]);
    if (ctx.table === 'visit_plans') return ok([{ id: 'p1', service_id: 'svc-bhc', planned_date: '2026-01-12', note: '', status: 'Planned' }]);
    if (ctx.table === 'health_service_attendance') {
      return ok([{ service_id: 'svc-bhc', attendance_status: 'attended', scheduled_date: '2026-01-12' }]);
    }
    if (ctx.table === 'facilities') return ok([{ name: 'Sta. Maria', type: 'rhu', municipality_id: 'm1' }]);
    return ok(null);
  });

  const result = await listDirectory({ user: residentUser, supabase, now: NOW });
  const svc = result.facilities[0].services[0];
  assert.equal(svc.plan.status, 'Attended');
  assert.equal(svc.plan.attendanceStatus, 'attended');
});

test('listDirectory returns no facilities when the resident has no municipality', async () => {
  const supabase = makeSupabase((ctx) => (ctx.table === 'residents' ? ok({ ...resident, municipality_id: null }) : ok(null)));
  const result = await listDirectory({ user: residentUser, supabase, now: NOW });
  assert.deepEqual(result.facilities, []);
});

test('serviceAvailability lists only the service weekdays within two weeks, minus closures', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'health_services') return ok(bhcService);
    if (ctx.table === 'appointment_schedules') return ok([{ service_id: 'svc-bhc', weekday: 1, start_time: '08:00:00', end_time: '11:00:00', barangay_id: 'b1', active: true }]);
    if (ctx.table === 'appointment_blackouts') return ok([{ service_id: 'svc-bhc', blackout_date: '2026-01-12', barangay_id: 'b1' }]);
    return ok(null);
  });
  const result = await serviceAvailability({ user: residentUser, serviceId: 'svc-bhc', supabase, now: NOW });
  // Mondays in [2026-01-05, 2026-01-18]: Jan 5 and Jan 12; Jan 12 is a closure.
  assert.deepEqual(result.dates.map((d) => d.date), ['2026-01-05']);
  assert.equal(result.available, true);
  assert.deepEqual(result.weekdays, [1]);
});

test('serviceAvailability rejects a service outside the resident scope with 403', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'health_services') return ok({ ...bhcService, barangay_id: 'OTHER' });
    return ok(null);
  });
  await assert.rejects(
    () => serviceAvailability({ user: residentUser, serviceId: 'svc-bhc', supabase, now: NOW }),
    (err) => err.statusCode === 403,
  );
});

test('serviceAvailability returns 404 for an unknown or inactive service', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'health_services') return ok({ ...bhcService, active: false });
    return ok(null);
  });
  await assert.rejects(
    () => serviceAvailability({ user: residentUser, serviceId: 'svc-bhc', supabase, now: NOW }),
    (err) => err.statusCode === 404,
  );
});

test('createPlan saves a Planned plan on an active weekday and returns a confirmation', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'health_services') return ok(bhcService);
    if (ctx.table === 'appointment_schedules') return ok([{ service_id: 'svc-bhc', weekday: 1, start_time: '08:00:00', end_time: '11:00:00', barangay_id: 'b1', active: true }]);
    if (ctx.table === 'appointment_blackouts') return ok([]);
    if (ctx.table === 'visit_plans' && ctx.op === 'select') return ok([]); // no duplicate
    if (ctx.table === 'visit_plans' && ctx.op === 'insert') return ok({ id: 'p9', service_id: 'svc-bhc', facility_type: 'BHC', planned_date: '2026-01-12', note: 'Bringing my child', status: 'Planned' });
    if (ctx.table === 'profiles') return ok([]);
    return ok(null);
  });
  const result = await createPlan({ user: residentUser, serviceId: 'svc-bhc', plannedDate: '2026-01-12', note: 'Bringing my child', supabase, now: NOW });
  assert.equal(result.plan.status, 'Planned');
  assert.equal(result.plan.facilityType, 'BHC');
  assert.match(result.message, /notified/i);
});

test('createPlan rejects a date that is not an active weekday (422)', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'health_services') return ok(bhcService);
    if (ctx.table === 'appointment_schedules') return ok([{ service_id: 'svc-bhc', weekday: 1, start_time: '08:00:00', end_time: '11:00:00', barangay_id: 'b1', active: true }]);
    if (ctx.table === 'appointment_blackouts') return ok([]);
    return ok(null);
  });
  // 2026-01-06 is a Tuesday — the service only runs on Mondays.
  await assert.rejects(
    () => createPlan({ user: residentUser, serviceId: 'svc-bhc', plannedDate: '2026-01-06', supabase, now: NOW }),
    (err) => err.statusCode === 422,
  );
});

test('createPlan rejects a closure (blackout) date (422)', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'health_services') return ok(bhcService);
    if (ctx.table === 'appointment_schedules') return ok([{ service_id: 'svc-bhc', weekday: 1, start_time: '08:00:00', end_time: '11:00:00', barangay_id: 'b1', active: true }]);
    if (ctx.table === 'appointment_blackouts') return ok([{ service_id: 'svc-bhc', blackout_date: '2026-01-12', barangay_id: 'b1' }]);
    return ok(null);
  });
  await assert.rejects(
    () => createPlan({ user: residentUser, serviceId: 'svc-bhc', plannedDate: '2026-01-12', supabase, now: NOW }),
    (err) => err.statusCode === 422,
  );
});

test('createPlan rejects a past date and a date beyond the two-week window (422)', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'health_services') return ok(bhcService);
    return ok(null);
  });
  await assert.rejects(
    () => createPlan({ user: residentUser, serviceId: 'svc-bhc', plannedDate: '2026-01-01', supabase, now: NOW }),
    (err) => err.statusCode === 422,
  );
  await assert.rejects(
    () => createPlan({ user: residentUser, serviceId: 'svc-bhc', plannedDate: '2026-02-10', supabase, now: NOW }),
    (err) => err.statusCode === 422,
  );
});

test('createPlan rejects a duplicate active plan for the same service (409)', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'health_services') return ok(bhcService);
    if (ctx.table === 'appointment_schedules') return ok([{ service_id: 'svc-bhc', weekday: 1, start_time: '08:00:00', end_time: '11:00:00', barangay_id: 'b1', active: true }]);
    if (ctx.table === 'appointment_blackouts') return ok([]);
    if (ctx.table === 'visit_plans' && ctx.op === 'select') return ok([{ id: 'existing', planned_date: '2026-01-12' }]);
    return ok(null);
  });
  await assert.rejects(
    () => createPlan({ user: residentUser, serviceId: 'svc-bhc', plannedDate: '2026-01-12', supabase, now: NOW }),
    (err) => err.statusCode === 409,
  );
});

test('createPlan rejects an out-of-scope service with 403', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'health_services') return ok({ ...bhcService, barangay_id: 'OTHER' });
    return ok(null);
  });
  await assert.rejects(
    () => createPlan({ user: residentUser, serviceId: 'svc-bhc', plannedDate: '2026-01-12', supabase, now: NOW }),
    (err) => err.statusCode === 403,
  );
});

test('removePlan cancels the resident own future plan', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'visit_plans' && ctx.op === 'select') return ok({ id: 'p1', resident_id: 'r1', planned_date: '2026-01-12', status: 'Planned' });
    if (ctx.table === 'visit_plans' && ctx.op === 'update') return ok({ id: 'p1', service_id: 'svc-bhc', facility_type: 'BHC', planned_date: '2026-01-12', status: 'Cancelled' });
    return ok(null);
  });
  const result = await removePlan({ user: residentUser, id: 'p1', supabase, now: NOW });
  assert.equal(result.removed, true);
  assert.equal(result.plan.status, 'Cancelled');
});

test('removePlan enforces ownership: another resident plan yields 404', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'visit_plans') return ok({ id: 'p1', resident_id: 'OTHER', planned_date: '2026-01-12', status: 'Planned' });
    return ok(null);
  });
  await assert.rejects(
    () => removePlan({ user: residentUser, id: 'p1', supabase, now: NOW }),
    (err) => err.statusCode === 404,
  );
});

test('removePlan refuses to remove a plan whose date has passed (409)', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'visit_plans') return ok({ id: 'p1', resident_id: 'r1', planned_date: '2026-01-01', status: 'Planned' });
    return ok(null);
  });
  await assert.rejects(
    () => removePlan({ user: residentUser, id: 'p1', supabase, now: NOW }),
    (err) => err.statusCode === 409,
  );
});

test('listOwnPlans filters to the caller resident active plans', async () => {
  let captured = null;
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'visit_plans') {
      captured = ctx.filters.eq;
      return ok([{ id: 'p1', service_id: 'svc-bhc', facility_type: 'BHC', planned_date: '2026-01-12', note: '', status: 'Planned' }]);
    }
    return ok(null);
  });
  const rows = await listOwnPlans({ user: residentUser, supabase, now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(captured.resident_id, 'r1');
  assert.equal(captured.status, 'Planned');
});

// --- validators ------------------------------------------------------------
test('createPlanValidator rejects malformed input and accepts a clean request', () => {
  assert.ok(createPlanValidator({}).error);
  assert.ok(createPlanValidator({ serviceId: 'nope', plannedDate: '2026-01-12' }).error);
  assert.ok(createPlanValidator({ serviceId: '11111111-1111-1111-1111-111111111111', plannedDate: 'bad' }).error);
  const long = 'x'.repeat(141);
  assert.ok(createPlanValidator({ serviceId: '11111111-1111-1111-1111-111111111111', plannedDate: '2026-01-12', note: long }).error);
  const good = createPlanValidator({ serviceId: '11111111-1111-1111-1111-111111111111', plannedDate: '2026-01-12', note: 'ok' });
  assert.equal(good.error, undefined);
  assert.equal(good.value.plannedDate, '2026-01-12');
});

test('availabilityQueryValidator accepts empty and valid ranges, rejects bad dates', () => {
  assert.equal(availabilityQueryValidator({}).error, undefined);
  assert.equal(availabilityQueryValidator({ from: '2026-01-05', to: '2026-01-18' }).error, undefined);
  assert.ok(availabilityQueryValidator({ from: 'nope' }).error);
});

test('listQueryValidator rejects a non-uuid service filter', () => {
  assert.equal(listQueryValidator({}).error, undefined);
  assert.ok(listQueryValidator({ service_id: 'nope' }).error);
  assert.equal(listQueryValidator({ service_id: '11111111-1111-1111-1111-111111111111' }).error, undefined);
});

test('idParamValidator requires a uuid', () => {
  assert.ok(idParamValidator({ id: 'nope' }).error);
  assert.equal(idParamValidator({ id: '11111111-1111-1111-1111-111111111111' }).error, undefined);
});

// ---------------------------------------------------------------------------
// One-time / dated service availability (regression for the "Registration
// Closed" bug). A service created through the Add Health Service modal records
// a concrete start/end date-time + registration deadline on the service row and
// has NO recurring appointment_schedules rows. Availability must therefore come
// from the service's own configured window, not from recurring weekday rows.
//
// NOTE: there is no "registration opens" field in the data model, so the
// "before registration opening time" case is not applicable and is intentionally
// not asserted here (documented rather than invented).
// ---------------------------------------------------------------------------

/**
 * Supabase stub for a single in-scope service. `health_services` returns one
 * row (single reads) or a one-element list (directory). Visit-plan selects
 * return no existing/other plans; an insert echoes a Planned row.
 */
const singleServiceSupabase = ({ service, schedules = [], blackouts = [], plans = [] }) =>
  makeSupabase((ctx) => {
    switch (ctx.table) {
      case 'residents':
        return ok(resident);
      case 'health_services':
        return ok(ctx.single ? service : [service]);
      case 'appointment_schedules':
        return ok(schedules);
      case 'appointment_blackouts':
        return ok(blackouts);
      case 'visit_plans':
        if (ctx.op === 'insert') {
          return ok({
            id: 'new-plan',
            service_id: service.id,
            facility_type: 'BHC',
            planned_date: ctx.payload.planned_date,
            note: ctx.payload.note,
            status: 'Planned',
          });
        }
        return ok(plans);
      case 'facilities':
        return ok([{ name: 'Sta. Maria', type: 'rhu', municipality_id: 'm1' }]);
      case 'profiles':
        return ok([]);
      default:
        return ok(null);
    }
  });

// A one-day BHC immunization drive on Thu 8 Jan 2026 (NOW is Mon 5 Jan 2026).
const datedService = (overrides = {}) => ({
  id: 'svc-dated',
  name: 'Measles Immunization Drive',
  description: 'One-day drive.',
  municipality_id: 'm1',
  barangay_id: 'b1',
  active: true,
  visit_policy: 'walk_in',
  start_date: '2026-01-08',
  start_time: '09:00:00',
  end_date: '2026-01-08',
  end_time: '12:00:00',
  registration_deadline: null,
  ...overrides,
});

test('availability: a valid one-time service with no appointment_schedules is OPEN from its own date', async () => {
  const supabase = singleServiceSupabase({ service: datedService() });
  const result = await listDirectory({ user: residentUser, supabase, now: NOW });
  const svc = result.facilities[0].services[0];
  assert.equal(svc.availability.open, true);
  assert.equal(svc.availability.reason, null);
  assert.equal(svc.hasUpcoming, true);
  assert.deepEqual(svc.weekdays, []); // it is not a recurring service
});

test('serviceAvailability offers a one-time service own date(s) without recurring rows', async () => {
  const supabase = singleServiceSupabase({ service: datedService() });
  const result = await serviceAvailability({ user: residentUser, serviceId: 'svc-dated', supabase, now: NOW });
  assert.deepEqual(result.dates.map((d) => d.date), ['2026-01-08']);
  assert.equal(result.available, true);
  assert.equal(result.availability.open, true);
  assert.deepEqual(result.weekdays, []);
});

test('createPlan registers a resident for a one-time service on its configured date', async () => {
  const supabase = singleServiceSupabase({ service: datedService() });
  const result = await createPlan({ user: residentUser, serviceId: 'svc-dated', plannedDate: '2026-01-08', supabase, now: NOW });
  assert.equal(result.plan.status, 'Planned');
  assert.equal(result.plan.facilityType, 'BHC');
});

test('createPlan rejects a day outside the one-time service window (422)', async () => {
  const supabase = singleServiceSupabase({ service: datedService() }); // Jan 8 only
  await assert.rejects(
    () => createPlan({ user: residentUser, serviceId: 'svc-dated', plannedDate: '2026-01-09', supabase, now: NOW }),
    (err) => err.statusCode === 422,
  );
});

test('availability: registration CLOSES once the deadline has passed; the deadline minute itself is still open', async () => {
  const closed = singleServiceSupabase({
    service: datedService({ start_date: '2026-01-20', end_date: '2026-01-20', registration_deadline: '2026-01-04T23:59' }),
  });
  const after = await serviceAvailability({ user: residentUser, serviceId: 'svc-dated', supabase: closed, now: NOW });
  assert.equal(after.availability.open, false);
  assert.equal(after.availability.reason, 'registration_closed');
  assert.equal(after.available, false);

  const atNow = singleServiceSupabase({
    service: datedService({ start_date: '2026-01-20', end_date: '2026-01-20', registration_deadline: '2026-01-05T00:00' }),
  });
  const at = await serviceAvailability({ user: residentUser, serviceId: 'svc-dated', supabase: atNow, now: NOW });
  assert.equal(at.availability.open, true);
});

test('createPlan refuses registration after the deadline has passed (422)', async () => {
  const supabase = singleServiceSupabase({
    service: datedService({ start_date: '2026-01-20', end_date: '2026-01-20', registration_deadline: '2026-01-04T23:59' }),
  });
  await assert.rejects(
    () => createPlan({ user: residentUser, serviceId: 'svc-dated', plannedDate: '2026-01-20', supabase, now: NOW }),
    (err) => err.statusCode === 422,
  );
});

test('availability: a one-time service whose date has passed is CLOSED as ended', async () => {
  const supabase = singleServiceSupabase({ service: datedService({ start_date: '2026-01-02', end_date: '2026-01-02' }) });
  const result = await serviceAvailability({ user: residentUser, serviceId: 'svc-dated', supabase, now: NOW });
  assert.equal(result.availability.open, false);
  assert.equal(result.availability.reason, 'ended');
});

test('createPlan refuses registration once a one-time service has ended (422)', async () => {
  const supabase = singleServiceSupabase({ service: datedService({ start_date: '2026-01-02', end_date: '2026-01-02' }) });
  await assert.rejects(
    () => createPlan({ user: residentUser, serviceId: 'svc-dated', plannedDate: '2026-01-05', supabase, now: NOW }),
    (err) => err.statusCode === 422,
  );
});

test('availability: a one-time service whose only date is a blackout is CLOSED', async () => {
  const supabase = singleServiceSupabase({
    service: datedService(),
    blackouts: [{ service_id: 'svc-dated', blackout_date: '2026-01-08', barangay_id: 'b1' }],
  });
  const result = await serviceAvailability({ user: residentUser, serviceId: 'svc-dated', supabase, now: NOW });
  assert.equal(result.availability.open, false);
  assert.equal(result.availability.reason, 'blackout');
  assert.equal(result.dates.length, 0);
});

test('availability: a recurring service with a valid weekday is OPEN (reason null)', async () => {
  const supabase = singleServiceSupabase({
    service: { id: 'svc-rec', name: 'BP Monitoring', municipality_id: 'm1', barangay_id: 'b1', active: true, visit_policy: 'walk_in' },
    schedules: [{ service_id: 'svc-rec', weekday: 1, start_time: '08:00:00', end_time: '11:00:00', barangay_id: 'b1', active: true }],
  });
  const result = await listDirectory({ user: residentUser, supabase, now: NOW });
  const view = result.facilities[0].services[0];
  assert.equal(view.availability.open, true);
  assert.equal(view.availability.reason, null);
  assert.deepEqual(view.weekdays, [1]);
});

test('availability: a recurring (appointment-based) service with all upcoming days blacked out reports no_slots', async () => {
  const supabase = singleServiceSupabase({
    service: { id: 'svc-rec', name: 'BP Monitoring', municipality_id: 'm1', barangay_id: 'b1', active: true, visit_policy: 'walk_in' },
    schedules: [{ service_id: 'svc-rec', weekday: 2, start_time: '08:00:00', end_time: '11:00:00', barangay_id: 'b1', active: true }],
    // Tuesdays in [2026-01-05, 2026-01-18]: Jan 6 and Jan 13 — both closed.
    blackouts: [
      { service_id: 'svc-rec', blackout_date: '2026-01-06', barangay_id: 'b1' },
      { service_id: 'svc-rec', blackout_date: '2026-01-13', barangay_id: 'b1' },
    ],
  });
  const result = await listDirectory({ user: residentUser, supabase, now: NOW });
  const view = result.facilities[0].services[0];
  assert.equal(view.availability.open, false);
  assert.equal(view.availability.reason, 'no_slots');
});

test('availability: a service with neither a date nor a recurring schedule is UNCONFIGURED (closed, never auto-opened)', async () => {
  const supabase = singleServiceSupabase({
    service: { id: 'svc-x', name: 'Unscheduled', municipality_id: 'm1', barangay_id: 'b1', active: true, visit_policy: 'walk_in' },
  });
  const result = await listDirectory({ user: residentUser, supabase, now: NOW });
  const view = result.facilities[0].services[0];
  assert.equal(view.availability.open, false);
  assert.equal(view.availability.reason, 'unconfigured');
});

test('availability: an inactive one-time service is reported inactive (defensive)', async () => {
  // listDirectory filters active=true at the query, so this exercises the
  // evaluator's defensive inactive branch directly through the directory view.
  const supabase = singleServiceSupabase({ service: datedService({ active: false }) });
  const result = await listDirectory({ user: residentUser, supabase, now: NOW });
  const view = result.facilities[0].services[0];
  assert.equal(view.availability.open, false);
  assert.equal(view.availability.reason, 'inactive');
});

test('availability (timezone/boundary): a date-only registration deadline is inclusive through the end of that day', async () => {
  // The deadline is today's date; registration must remain open all of today
  // (no accidental UTC shift that closes it at midnight).
  const supabase = singleServiceSupabase({
    service: datedService({ start_date: '2026-01-05', end_date: '2026-01-05', registration_deadline: '2026-01-05' }),
  });
  const result = await serviceAvailability({ user: residentUser, serviceId: 'svc-dated', supabase, now: NOW });
  assert.equal(result.availability.open, true);
  assert.deepEqual(result.dates.map((d) => d.date), ['2026-01-05']);
});

test('availability: a Postgres-style (space-separated) deadline timestamp parses correctly', async () => {
  const supabase = singleServiceSupabase({
    service: datedService({ start_date: '2026-01-20', end_date: '2026-01-20', registration_deadline: '2026-01-20 08:00:00' }),
  });
  const result = await serviceAvailability({ user: residentUser, serviceId: 'svc-dated', supabase, now: NOW });
  assert.equal(result.availability.open, true);
});

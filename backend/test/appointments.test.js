import assert from 'node:assert/strict';
import test from 'node:test';

// Neutralize the real notification side-effect helper so the unit tests never
// touch a live Supabase project (notifyResident is a no-op when unconfigured).
import env from '../src/config/env.js';
env.isSupabaseConfigured = false;

import {
  availability,
  book,
  listOwn,
  cancelOwn,
  respondToProposal,
  staffList,
  approve,
  setOutcome,
  propose,
} from '../src/services/appointments.service.js';
import {
  bookValidator,
  declineValidator,
  outcomeValidator,
  scheduleValidator,
  availabilityQueryValidator,
} from '../src/validators/appointments.validators.js';

/**
 * Thenable Supabase builder stub. `resolve(ctx)` returns { data, error } based
 * on the table + operation + accumulated filters. Both `await chain` (list) and
 * `chain.maybeSingle()/single()` (row) are supported, matching the real
 * PostgREST builder the service uses.
 */
const makeSupabase = (resolve, rpc) => {
  const makeChain = (table) => {
    const ctx = { table, op: 'select', filters: { eq: {}, in: {} }, payload: null, single: false };
    const chain = {
      ctx,
      select() { return chain; },
      insert(p) { ctx.op = 'insert'; ctx.payload = p; return chain; },
      update(p) { ctx.op = 'update'; ctx.payload = p; return chain; },
      delete() { ctx.op = 'delete'; return chain; },
      upsert(p) { ctx.op = 'upsert'; ctx.payload = p; return chain; },
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
  return {
    from(table) { return makeChain(table); },
    rpc(name, params) { return Promise.resolve(rpc ? rpc(name, params) : { data: null, error: null }); },
  };
};

const resident = { id: 'r1', auth_user_id: 'u1', barangay_id: 'b1', municipality_id: 'm1', barangay: 'San Jose' };
const residentUser = { id: 'u1', role: 'resident' };
const bhwUser = { id: 'bhw1', role: 'bhw', barangayId: 'b1', municipalityId: 'm1', name: 'BHW One' };

const ok = (data) => ({ data, error: null });

test('availability generates slots and reflects remaining capacity', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'health_services') return ok({ id: 'svc1', municipality_id: 'm1', barangay_id: null, active: true });
    if (ctx.table === 'appointment_schedules') {
      return ok([{ weekday: 1, start_time: '09:00:00', end_time: '10:00:00', slot_minutes: 30, capacity_per_slot: 2, barangay_id: null, active: true }]);
    }
    if (ctx.table === 'appointment_blackouts') return ok([]);
    if (ctx.table === 'appointments') {
      // one active booking already at 09:00
      return ok([{ requested_date: '2099-01-04', requested_time: '09:00:00', confirmed_date: null, confirmed_time: null }]);
    }
    return ok(null);
  });

  const result = await availability({ user: residentUser, serviceId: 'svc1', date: '2099-01-04', supabase });
  assert.equal(result.available, true);
  assert.equal(result.slots.length, 2);
  const nine = result.slots.find((s) => s.time === '09:00');
  const nineThirty = result.slots.find((s) => s.time === '09:30');
  assert.equal(nine.capacity, 2);
  assert.equal(nine.remaining, 1);
  assert.equal(nineThirty.remaining, 2);
});

test('availability reports a blackout date as unavailable', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'health_services') return ok({ id: 'svc1', municipality_id: 'm1', barangay_id: null, active: true });
    if (ctx.table === 'appointment_schedules') return ok([{ weekday: 1, start_time: '09:00:00', end_time: '10:00:00', slot_minutes: 30, capacity_per_slot: 2, barangay_id: null, active: true }]);
    if (ctx.table === 'appointment_blackouts') return ok([{ blackout_date: '2099-01-04', barangay_id: null, reason: 'Holiday' }]);
    if (ctx.table === 'appointments') return ok([]);
    return ok(null);
  });
  const result = await availability({ user: residentUser, serviceId: 'svc1', date: '2099-01-04', supabase });
  assert.equal(result.available, false);
  assert.match(result.message, /Holiday/);
});

test('book maps the SLOT_FULL RPC error to a 409 conflict', async () => {
  const supabase = makeSupabase(
    (ctx) => (ctx.table === 'residents' ? ok(resident) : ok(null)),
    () => ({ data: null, error: { message: 'ERROR: SLOT_FULL' } }),
  );
  await assert.rejects(
    () => book({ user: residentUser, serviceId: 'svc1', date: '2099-01-04', time: '09:00', supabase }),
    (err) => err.statusCode === 409,
  );
});

test('book persists a pending request and returns the reference', async () => {
  const inserted = { id: 'a1', reference: 'APT-00001', service_id: 'svc1', requested_date: '2099-01-04', requested_time: '09:00:00', status: 'pending', barangay_id: 'b1', municipality_id: 'm1' };
  const supabase = makeSupabase(
    (ctx) => {
      if (ctx.table === 'residents') return ok(resident);
      if (ctx.table === 'appointments' && ctx.single) return ok({ ...inserted, service: { name: 'Prenatal' }, barangay: { name: 'San Jose' } });
      if (ctx.table === 'health_service_assignments') return ok([]);
      return ok(null);
    },
    (name) => (name === 'book_resident_appointment' ? ok(inserted) : ok(null)),
  );
  const result = await book({ user: residentUser, serviceId: 'svc1', date: '2099-01-04', time: '09:00', supabase });
  assert.equal(result.reference, 'APT-00001');
  assert.equal(result.status, 'pending');
  assert.equal(result.service, 'Prenatal');
});

test('listOwn returns only the caller resident appointments mapped to view models', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'appointments') {
      assert.equal(ctx.filters.eq.resident_id, 'r1');
      return ok([{ id: 'a1', reference: 'APT-1', status: 'pending', requested_date: '2099-01-04', requested_time: '09:00:00', service: { name: 'Prenatal' } }]);
    }
    return ok(null);
  });
  const rows = await listOwn({ user: residentUser, supabase });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].service, 'Prenatal');
});

test('a resident cannot directly cancel an already-approved appointment', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'appointments') return ok({ id: 'a1', resident_id: 'r1', status: 'approved' });
    return ok(null);
  });
  await assert.rejects(
    () => cancelOwn({ user: residentUser, id: 'a1', supabase }),
    (err) => err.statusCode === 409,
  );
});

test('a resident can cancel their own pending request', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'appointments' && ctx.op === 'select') return ok({ id: 'a1', resident_id: 'r1', status: 'pending', barangay_id: 'b1' });
    if (ctx.table === 'appointments' && ctx.op === 'update') return ok({ id: 'a1', resident_id: 'r1', status: 'cancelled' });
    return ok(null);
  });
  const res = await cancelOwn({ user: residentUser, id: 'a1', supabase });
  assert.equal(res.status, 'cancelled');
});

test('respondToProposal rejects when there is no proposal pending', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'appointments') return ok({ id: 'a1', resident_id: 'r1', status: 'pending' });
    return ok(null);
  });
  await assert.rejects(
    () => respondToProposal({ user: residentUser, id: 'a1', decision: 'accept', supabase }),
    (err) => err.statusCode === 409,
  );
});

test('ownership is enforced: another resident appointment id yields 404', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'residents') return ok(resident);
    if (ctx.table === 'appointments') return ok({ id: 'a9', resident_id: 'OTHER', status: 'pending' });
    return ok(null);
  });
  await assert.rejects(
    () => cancelOwn({ user: residentUser, id: 'a9', supabase }),
    (err) => err.statusCode === 404,
  );
});

test('staffList forces the barangay scope for a barangay-scoped worker', async () => {
  let captured = null;
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'appointments') {
      captured = ctx.filters.eq;
      return ok([]);
    }
    return ok(null);
  });
  await staffList({ user: bhwUser, query: { status: 'pending' }, supabase });
  assert.equal(captured.barangay_id, 'b1');
  assert.equal(captured.status, 'pending');
});

test('staffList refuses a resident role', async () => {
  const supabase = makeSupabase(() => ok([]));
  await assert.rejects(
    () => staffList({ user: residentUser, query: {}, supabase }),
    (err) => err.statusCode === 403,
  );
});

test('approve rejects an invalid transition from a terminal status', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'appointments') return ok({ id: 'a1', barangay_id: 'b1', municipality_id: 'm1', status: 'completed', service: { name: 'X' } });
    return ok(null);
  });
  await assert.rejects(
    () => approve({ user: bhwUser, id: 'a1', supabase }),
    (err) => err.statusCode === 409,
  );
});

test('setOutcome only applies to an approved appointment', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'appointments') return ok({ id: 'a1', barangay_id: 'b1', municipality_id: 'm1', status: 'pending', service: { name: 'X' } });
    return ok(null);
  });
  await assert.rejects(
    () => setOutcome({ user: bhwUser, id: 'a1', status: 'completed', supabase }),
    (err) => err.statusCode === 409,
  );
});

test('propose rejects a non-pending appointment', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'appointments') return ok({ id: 'a1', barangay_id: 'b1', municipality_id: 'm1', status: 'approved', service: { name: 'X' } });
    return ok(null);
  });
  await assert.rejects(
    () => propose({ user: bhwUser, id: 'a1', date: '2099-01-05', time: '09:00', supabase }),
    (err) => err.statusCode === 409,
  );
});

test('a staff appointment outside the caller barangay is not found', async () => {
  const supabase = makeSupabase((ctx) => {
    if (ctx.table === 'appointments') return ok({ id: 'a1', barangay_id: 'OTHER', municipality_id: 'm1', status: 'pending', service: { name: 'X' } });
    return ok(null);
  });
  await assert.rejects(
    () => approve({ user: bhwUser, id: 'a1', supabase }),
    (err) => err.statusCode === 404,
  );
});

// --- validators ------------------------------------------------------------
test('bookValidator rejects malformed input and accepts a clean request', () => {
  assert.ok(bookValidator({}).error);
  assert.ok(bookValidator({ serviceId: 'not-a-uuid', date: '2099-01-04', time: '09:00' }).error);
  const good = bookValidator({ serviceId: '11111111-1111-1111-1111-111111111111', date: '2099-01-04', time: '09:00' });
  assert.equal(good.error, undefined);
  assert.equal(good.value.time, '09:00');
});

test('declineValidator requires a reason', () => {
  assert.ok(declineValidator({}).error);
  assert.equal(declineValidator({ reason: 'Clinic full' }).value.reason, 'Clinic full');
});

test('outcomeValidator only accepts completed or missed', () => {
  assert.ok(outcomeValidator({ status: 'approved' }).error);
  assert.equal(outcomeValidator({ status: 'completed' }).value.status, 'completed');
});

test('scheduleValidator enforces time ordering and bounds', () => {
  const bad = scheduleValidator({ serviceId: '11111111-1111-1111-1111-111111111111', weekday: 1, startTime: '12:00', endTime: '09:00', slotMinutes: 30, capacityPerSlot: 1 });
  assert.ok(bad.error);
  const good = scheduleValidator({ serviceId: '11111111-1111-1111-1111-111111111111', weekday: 1, startTime: '08:00', endTime: '12:00', slotMinutes: 30, capacityPerSlot: 2 });
  assert.equal(good.error, undefined);
  assert.equal(good.value.capacityPerSlot, 2);
});

test('availabilityQueryValidator validates the service id and date', () => {
  assert.ok(availabilityQueryValidator({ serviceId: 'x', date: 'y' }).error);
  const good = availabilityQueryValidator({ serviceId: '11111111-1111-1111-1111-111111111111', date: '2099-01-04' });
  assert.equal(good.error, undefined);
});

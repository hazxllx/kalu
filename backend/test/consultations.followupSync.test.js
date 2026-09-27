import test from 'node:test';
import assert from 'node:assert/strict';

import { planFollowUpSync, syncConsultationFollowUp } from '../src/services/consultations.service.js';

/**
 * Consultation -> canonical follow-up reconciliation.
 *
 * A consultation follow-up REQUIRES resident confirmation: it lives in the
 * existing "awaiting resident response" state (status 'Pending',
 * requires_resident_response = true, resident_decision 'pending') so the
 * resident sees Confirm / Reject. De-duplication uses only existing columns
 * (resident_id + created_by + purpose, live/non-terminal), so no migration is
 * needed and a consultation save can never 500 because of the follow-up step.
 */

const withDate = { nextVisitDate: '2026-09-29', chiefComplaint: 'Fever' };
const noDate = { nextVisitDate: '', chiefComplaint: 'Fever' };

// ---- pure decision --------------------------------------------------------
test('first save with a next visit date creates a new (awaiting) follow-up', () => {
  assert.deepEqual(planFollowUpSync(null, withDate), { action: 'create' });
});

test('an undecided live follow-up is (re)asserted into the awaiting-confirmation state', () => {
  // pre-confirmation-rule rows (Scheduled, no decision) and Pending rows both -> await
  assert.deepEqual(planFollowUpSync({ id: 'fu-1', status: 'Scheduled' }, withDate), { action: 'await' });
  assert.deepEqual(planFollowUpSync({ id: 'fu-2', status: 'Pending', resident_decision: 'pending' }, withDate), { action: 'await' });
});

test('a follow-up the resident already approved is only rescheduled (kept confirmed)', () => {
  assert.deepEqual(
    planFollowUpSync({ id: 'fu-1', status: 'Scheduled', resident_decision: 'approved' }, withDate),
    { action: 'reschedule' },
  );
});

test('a terminal (cancelled/completed) follow-up is history — a new one is created', () => {
  assert.deepEqual(planFollowUpSync({ id: 'fu-1', status: 'Cancelled' }, withDate), { action: 'create' });
  assert.deepEqual(planFollowUpSync({ id: 'fu-1', status: 'Completed' }, withDate), { action: 'create' });
});

test('Follow-up Required = No cancels a live follow-up; otherwise no-op', () => {
  assert.deepEqual(planFollowUpSync({ id: 'fu-1', status: 'Scheduled' }, noDate), { action: 'cancel' });
  assert.deepEqual(planFollowUpSync(null, noDate), { action: 'noop' });
  assert.deepEqual(planFollowUpSync({ id: 'fu-1', status: 'Cancelled' }, noDate), { action: 'noop' });
});

// ---- orchestration (injected supabase + operational stub) -----------------
const makeSupabase = (rows, { throwOnSelect = false } = {}) => {
  const updates = [];
  const from = () => ({
    select() { return this; },
    eq() { return this; },
    order() {
      return throwOnSelect
        ? Promise.resolve({ data: null, error: { message: 'boom' } })
        : Promise.resolve({ data: rows, error: null });
    },
    update(payload) {
      updates.push(payload);
      return { eq: () => Promise.resolve({ error: null }) };
    },
  });
  return { client: { from }, updates };
};
const makeOps = () => {
  const calls = { create: [], update: [] };
  return {
    calls,
    create: async (args) => { calls.create.push(args); return { id: 'new-fu' }; },
    update: async (args) => { calls.update.push(args); return { id: args.id }; },
  };
};
const VISIT = { id: 'SUB-1', residentId: 'RES-1' };
const USER = { id: 'staff-1', name: 'Barangay Health Supervisor', role: 'health_supervisor' };

test('create: no existing follow-up -> ops.create for the SAME resident, awaiting confirmation', async () => {
  const ops = makeOps();
  const sb = makeSupabase([]);
  await syncConsultationFollowUp({ user: USER, visit: VISIT, payload: withDate, supabase: sb.client, ops });
  assert.equal(ops.calls.create.length, 1);
  const p = ops.calls.create[0].payload;
  assert.equal(p.residentId, 'RES-1'); // owned by the consultation's resident
  assert.equal(p.scheduled_date, '2026-09-29');
  assert.equal(p.purpose, 'Fever follow-up');
  assert.equal(p.requiresResidentResponse, true);
});

test('await: an existing undecided follow-up is converted to awaiting-confirmation (Confirm/Reject appear)', async () => {
  const ops = makeOps();
  const sb = makeSupabase([{ id: 'fu-1', status: 'Scheduled', resident_decision: null, created_at: '2026-09-20' }]);
  await syncConsultationFollowUp({ user: USER, visit: VISIT, payload: withDate, supabase: sb.client, ops });
  assert.equal(ops.calls.create.length, 0);
  assert.equal(ops.calls.update.length, 0);
  assert.equal(sb.updates.length, 1);
  assert.equal(sb.updates[0].status, 'Pending');
  assert.equal(sb.updates[0].requires_resident_response, true);
  assert.equal(sb.updates[0].resident_decision, 'pending');
  assert.equal(sb.updates[0].scheduled_date, '2026-09-29');
});

test('reschedule: an already-approved follow-up is only rescheduled via the operational service', async () => {
  const ops = makeOps();
  const sb = makeSupabase([{ id: 'fu-1', status: 'Scheduled', resident_decision: 'approved', created_at: '2026-09-20' }]);
  await syncConsultationFollowUp({ user: USER, visit: VISIT, payload: withDate, supabase: sb.client, ops });
  assert.equal(sb.updates.length, 0);
  assert.equal(ops.calls.update.length, 1);
  assert.equal(ops.calls.update[0].payload.scheduled_date, '2026-09-29');
});

test('cancel: Follow-up Required = No cancels the live follow-up', async () => {
  const ops = makeOps();
  const sb = makeSupabase([{ id: 'fu-1', status: 'Pending', resident_decision: 'pending', created_at: '2026-09-20' }]);
  await syncConsultationFollowUp({ user: USER, visit: VISIT, payload: noDate, supabase: sb.client, ops });
  assert.equal(ops.calls.update.length, 1);
  assert.equal(ops.calls.update[0].payload.status, 'Cancelled');
});

test('best-effort: a follow-up lookup failure never throws (consultation save is protected)', async () => {
  const ops = makeOps();
  const sb = makeSupabase([], { throwOnSelect: true });
  await assert.doesNotReject(() =>
    syncConsultationFollowUp({ user: USER, visit: VISIT, payload: withDate, supabase: sb.client, ops }),
  );
  assert.equal(ops.calls.create.length, 0);
  assert.equal(ops.calls.update.length, 0);
});

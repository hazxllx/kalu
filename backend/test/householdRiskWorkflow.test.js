import test from 'node:test';
import assert from 'node:assert/strict';

import * as workflow from '../src/services/householdRiskWorkflow.service.js';

/**
 * BUG-009 — the household risk-cluster workflow (follow-up / assignment /
 * escalation / resolution) is persisted in PostgreSQL and scope-enforced. These
 * tests use an in-memory stub for public.household_risk_workflow and a stub
 * scopeCheck standing in for households.service.getHousehold (which enforces
 * municipality/barangay scope and 404s out-of-scope households).
 */

const makeStub = () => {
  const rows = new Map();
  return {
    _rows: rows,
    from(table) {
      assert.equal(table, 'household_risk_workflow');
      const q = {
        _id: null,
        _row: null,
        select() { return this; },
        eq(_c, v) { this._id = v; return this; },
        maybeSingle() { return Promise.resolve({ data: rows.get(this._id) || null, error: null }); },
        upsert(row) { this._row = { ...rows.get(row.household_id), ...row }; return this; },
        single() { rows.set(this._row.household_id, this._row); return Promise.resolve({ data: this._row, error: null }); },
      };
      return q;
    },
  };
};

const HS = { id: 'hs-a', role: 'health_supervisor', barangayId: 'brgy-a' };
const RESIDENT = { id: 'res-1', role: 'resident' };

// In-scope household -> resolves; out-of-scope -> 404 (mirrors getHousehold).
const inScope = async () => ({ id: 'HH-001' });
const outOfScope = async () => { throw Object.assign(new Error('not found'), { statusCode: 404 }); };

test('BUG-009: saveWorkflow persists follow-up state and getWorkflow reads it back', async () => {
  const supabase = makeStub();
  const saved = await workflow.saveWorkflow({
    id: 'HH-001', user: HS, supabase, scopeCheck: inScope,
    patch: { workflowStatus: 'Follow-up Scheduled', followUpCount: 1, lastNote: 'Visited', lastFollowUpAt: '2026-09-25' },
  });
  assert.equal(saved.workflowStatus, 'Follow-up Scheduled');
  assert.equal(saved.followUpCount, 1);

  const read = await workflow.getWorkflow({ id: 'HH-001', user: HS, supabase, scopeCheck: inScope });
  assert.equal(read.workflowStatus, 'Follow-up Scheduled');
  assert.equal(read.lastNote, 'Visited');
});

test('BUG-009: assignment and escalation persist', async () => {
  const supabase = makeStub();
  await workflow.saveWorkflow({ id: 'HH-001', user: HS, supabase, scopeCheck: inScope, patch: { assignedWorker: 'Nurse X', assignedWorkerRole: 'PHN', assignmentAt: new Date().toISOString() } });
  const escalated = await workflow.saveWorkflow({ id: 'HH-001', user: HS, supabase, scopeCheck: inScope, patch: { workflowStatus: 'Escalated', escalation: { reason: 'High risk', assignment: 'PHN' } } });
  assert.equal(escalated.assignedWorker, 'Nurse X');
  assert.equal(escalated.workflowStatus, 'Escalated');
  assert.equal(escalated.escalation.reason, 'High risk');
});

test('BUG-009: an out-of-scope household is 404 for read and write', async () => {
  const supabase = makeStub();
  await assert.rejects(
    () => workflow.getWorkflow({ id: 'HH-OTHER', user: HS, supabase, scopeCheck: outOfScope }),
    (e) => e.statusCode === 404,
  );
  await assert.rejects(
    () => workflow.saveWorkflow({ id: 'HH-OTHER', user: HS, supabase, scopeCheck: outOfScope, patch: { workflowStatus: 'x' } }),
    (e) => e.statusCode === 404,
  );
});

test('BUG-009: a resident cannot write the workflow (403)', async () => {
  const supabase = makeStub();
  await assert.rejects(
    () => workflow.saveWorkflow({ id: 'HH-001', user: RESIDENT, supabase, scopeCheck: inScope, patch: { workflowStatus: 'x' } }),
    (e) => e.statusCode === 403,
  );
});

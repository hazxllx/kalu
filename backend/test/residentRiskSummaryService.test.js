import assert from 'node:assert/strict';
import test from 'node:test';
import { getResidentRiskSummaryRecords } from '../src/services/residentRisk.service.js';

const user = (role = 'phn') => ({ id: 'actor-id', role, municipalityId: 'municipality-id', barangayId: 'barangay-id' });

test('resident risk summary denies unsupported roles before any database call', async () => {
  let called = false;
  await assert.rejects(
    getResidentRiskSummaryRecords({ user: user('resident'), supabase: { rpc: async () => { called = true; } } }),
    (error) => error.statusCode === 403,
  );
  assert.equal(called, false);
});

test('resident risk summary forwards scoped filters and returns database summary unchanged', async () => {
  let invocation;
  const expected = { summary: { totalResidents: 3, incomplete: 1 }, rows: [], total: 3, limit: 25, offset: 0 };
  const result = await getResidentRiskSummaryRecords({
    user: user('health_supervisor'),
    filters: { barangayId: null, zone: 2, riskLevel: 'High', assessmentStatus: 'assessed', from: '2026-11-01', to: null, indicator: 'bloodPressure', search: 'R-1', limit: 25, offset: 0 },
    supabase: { rpc: async (name, args) => { invocation = { name, args }; return { data: expected, error: null }; } },
  });
  assert.equal(invocation.name, 'resident_risk_summary_records');
  assert.equal(invocation.args.p_actor_id, 'actor-id');
  assert.equal(invocation.args.p_barangay_id, null);
  assert.equal(invocation.args.p_zone, 2);
  assert.equal(invocation.args.p_risk_level, 'High');
  assert.equal(invocation.args.p_assessment_status, 'assessed');
  assert.equal(invocation.args.p_from, '2026-11-01');
  assert.equal(invocation.args.p_indicator, 'bloodPressure');
  assert.equal(result, expected);
});

test('resident risk summary preserves database geographic-scope denial', async () => {
  await assert.rejects(
    getResidentRiskSummaryRecords({ user: user('phn'), supabase: { rpc: async () => ({ data: null, error: { code: '42501' } }) } }),
    (error) => error.statusCode === 403 && /outside the current account scope/i.test(error.message),
  );
});

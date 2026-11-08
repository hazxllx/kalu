import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createAnalyticsController } from '../src/controllers/analytics.controller.js';
import {
  buildCommunityMapTrends, getCommunityMap, getCommunityMapTrends,
  getEarlyWarning, getHouseholdMap, riskFromVitals, topConditionFrom,
} from '../src/services/analytics.service.js';

const actorId = '00000000-0000-4000-8000-000000000001';
const kinds = [
  ['early-warning', getEarlyWarning, { summary: {}, consultationTrends: [], diseaseDistribution: [], riskDistribution: [] }],
  ['community-map', getCommunityMap, { summary: {}, barangays: [], conditionTotals: [] }],
  ['community-map-trends', getCommunityMapTrends, { monthly: [] }],
  ['household-map', getHouseholdMap, { summary: {}, locations: [] }],
];
const rowlessRepo = (mode = 'supabase') => new Proxy({ mode }, {
  get(target, key) {
    if (key in target) return target[key];
    throw new Error(`Production analytics must not access repository.${String(key)}`);
  },
});

test('every production analytics endpoint uses only the injected aggregate RPC, never row repository methods', async () => {
  for (const [kind, service, payload] of kinds) {
    let calls = 0;
    const result = await service({
      actorId, municipalityId: 'client-or-stale-municipality', barangay: 'San Antonio',
      condition: 'Tuberculosis', status: 'completed', riskLevel: 'High',
      from: '2026-05-01', to: '2026-05-31', year: 2026, distinctResidents: true,
    }, { repo: rowlessRepo(), rpc: async (name, params) => {
      calls += 1;
      assert.equal(name, 'scoped_aggregate_analytics');
      assert.equal(params.p_kind, kind);
      assert.equal(params.p_actor_id, actorId);
      assert.equal(params.p_barangay, 'San Antonio');
      assert.equal(Object.keys(params).some((key) => /municipality|limit|offset/i.test(key)), false);
      if (kind === 'community-map' || kind === 'community-map-trends') {
        assert.equal(params.p_condition, 'Tuberculosis');
        assert.equal(params.p_from, '2026-05-01');
        assert.equal(params.p_to, '2026-05-31');
        assert.equal(params.p_distinct_residents, true);
      }
      return { data: payload, error: null };
    } });
    assert.equal(calls, 1);
    assert.equal(result, payload);
  }
});

test('the shipped driver selector also selects PostgreSQL, and unknown modes never fall back to a row scan', async () => {
  for (const repo of [{ driver: 'supabase' }, { mode: 'unknown' }, {}]) {
    const payload = kinds[0][2];
    assert.equal(await getEarlyWarning({ actorId }, {
      repo, rpc: async () => ({ data: payload }),
    }), payload);
  }
});

test('a missing actor is refused before any service-role RPC executes', async () => {
  for (const [, service] of kinds) {
    await assert.rejects(() => service({}, { repo: rowlessRepo(), rpc: async () => {
      assert.fail('RPC must not execute without an authenticated actor');
    } }), (error) => error.statusCode === 401);
  }
});

test('RPC errors, unavailable migrations and malformed responses cannot fabricate empty success or fetch a fallback', async () => {
  const failedResponses = [
    { data: null }, { data: {} }, { data: [] },
    { error: { code: 'PGRST202', message: 'RPC not installed' } },
    { error: { code: '42P01', message: 'Missing source table' } },
  ];
  for (const [, service] of kinds) {
    for (const response of failedResponses) {
      await assert.rejects(() => service({ actorId }, {
        repo: rowlessRepo(), rpc: async () => response,
      }), (error) => error.statusCode === 503);
    }
    await assert.rejects(() => service({ actorId }, {
      repo: rowlessRepo(), rpc: async () => { throw new Error('Transport failed'); },
    }), (error) => error.statusCode === 503);
  }
  for (const [code, statusCode] of [['42501', 403], ['22023', 422]]) {
    await assert.rejects(() => getCommunityMap({ actorId }, {
      repo: rowlessRepo(), rpc: async () => ({ error: { code, message: 'Scope or filter denied' } }),
    }), (error) => error.statusCode === statusCode);
  }
});

test('controller injection passes the authenticated actor and filters, never query actor/municipality overrides', async () => {
  const calls = [];
  const controller = createAnalyticsController({ repo: rowlessRepo(), rpc: async (name, params) => {
    calls.push(params);
    return { data: kinds.find(([kind]) => kind === params.p_kind)[2] };
  } });
  const request = {
    user: { id: actorId, municipalityId: 'authenticated-municipality' }, assignedBarangay: 'San Antonio',
    query: { actorId: 'forged-actor', municipalityId: 'foreign-municipality', barangay: 'San Antonio' },
  };
  const response = { status(code) { assert.equal(code, 200); return this; }, json(body) { assert.ok(body.data); } };
  await controller.getEarlyWarning(request, response);
  await controller.getCommunityMap(request, response);
  await controller.getCommunityMapTrends(request, response);
  await controller.getHouseholdMap(request, response);
  assert.equal(calls.length, 4);
  for (const params of calls) {
    assert.equal(params.p_actor_id, actorId);
    assert.equal(params.p_barangay, 'San Antonio');
    assert.equal(params.p_year, null, 'missing year is resolved in the database reporting timezone');
    assert.equal(JSON.stringify(params).includes('foreign-municipality'), false);
    assert.equal(JSON.stringify(params).includes('authenticated-municipality'), false);
  }
});

test('controllers reject invalid dates, ranges, years and filters instead of silently defaulting', async () => {
  const controller = createAnalyticsController({ repo: rowlessRepo(), rpc: async () => assert.fail('Invalid filters must not query') });
  for (const query of [
    { from: '2026-02-29' }, { from: '2026-05-02', to: '2026-05-01' },
    { to: '2026-05-01T12:00:00Z' }, { year: 'not-a-year' }, { year: '0000' },
    { riskLevel: 'Critical' }, { condition: 'Invented condition' }, { status: 'accepted' },
    { distinctResidents: 'yes' }, { barangay: 'Unknown Barangay' },
  ]) {
    await assert.rejects(() => controller.getCommunityMapTrends({ user: { id: actorId }, query }, {}),
      (error) => error.statusCode === 422);
  }
  for (const name of ['getEarlyWarning', 'getHouseholdMap']) {
    await assert.rejects(() => controller[name]({ user: { id: actorId }, query: { barangay: 'Unknown Barangay' } }, {}),
      (error) => error.statusCode === 422);
  }
});

test('pure classification exports preserve configured thresholds, Unassessed and deterministic real top conditions', () => {
  const config = { thresholds: { moderateMin: 5, highMin: 10 }, criteria: [
    { field: 'temperature', operator: 'gte', value: 38, weight: 5, enabled: true },
    { field: 'pulse', operator: 'gt', value: 100, weight: 5, enabled: true },
    { field: 'systolic', operator: 'gte', value: 1, weight: 1000, enabled: false },
  ] };
  assert.equal(riskFromVitals({}, config), null);
  assert.equal(riskFromVitals({ temperature: 38 }, config), 'Moderate');
  assert.equal(riskFromVitals({ temperature: 38, hr: 101 }, config), 'High');
  assert.deepEqual(topConditionFrom([{ name: 'Others', value: 100 }, { name: 'Malaria', value: 5 }, { name: 'Dengue', value: 5 }]),
    { name: 'Dengue', value: 5 });
  assert.deepEqual(topConditionFrom([{ name: 'Others', value: 100 }]), { name: 'No recorded condition', value: 0 });
});

test('pure trend helper uses inclusive Manila dates and unique TB residents without suppressing unrelated conditions', () => {
  const result = buildCommunityMapTrends({
    barangays: [{ id: 'b1', name: 'San Antonio', municipality_id: 'm1' }],
    residents: [{ id: 'r1', barangayId: 'b1', municipalityId: 'm1' }, { id: 'r2', barangayId: 'b1', municipalityId: 'm1' }],
    visits: [
      { id: 'before', residentId: 'r1', chiefComplaint: 'TB', visitDate: '2026-04-30T15:59:59.999Z' },
      { id: 'start', residentId: 'r1', chiefComplaint: 'TB', visitDate: '2026-04-30T16:00:00Z' },
      { id: 'end', residentId: 'r1', chiefComplaint: 'TB', visitDate: '2026-05-01T15:59:59.999Z' },
      { id: 'next', residentId: 'r1', chiefComplaint: 'TB', visitDate: '2026-05-01T16:00:00Z' },
      { id: 'other-condition', residentId: 'r2', chiefComplaint: 'Cough', visitDate: '2026-04-30T16:00:00Z' },
    ],
    tclEntries: [
      { residentId: 'r1', program: 'TB', status: 'Active', createdAt: '2026-04-30T16:00:00Z' },
      { residentId: 'r2', program: 'TB', status: 'Active', createdAt: '2026-04-30T16:00:00Z' },
      { residentId: 'r2', program: 'TB', status: 'Active', createdAt: '2026-04-30T16:00:00Z' },
    ], municipalityId: 'm1', year: 2026, from: '2026-05-01', to: '2026-05-01',
  });
  assert.equal(result.monthly[4].cases, 3, 'one TB visit resident, one respiratory visit, one extra TB enrollment resident');
  assert.equal(result.monthly.reduce((sum, month) => sum + month.cases, 0), 3);
});

test('aggregate migration has no table paging/caps, legacy referral reads or resident/household identity output', async () => {
  const sql = await readFile(new URL('../../supabase/migrations/20261106030000_scoped_aggregate_analytics.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /\b(?:limit|offset)\b|\b5000\b/i);
  assert.doesNotMatch(sql, /\b(?:from|join)\s+(?:public\.)?referrals\b/i);
  assert.doesNotMatch(sql, /\b(?:first_name|last_name|head_name|cellphone_no|patient_snapshot|visit_snapshot|street_address)\b/i);
  assert.match(sql, /public\.health_referrals/);
  assert.match(sql, /Asia\/Manila/);
});

test('early-warning activity reporting filters are validated and forwarded without a client municipality', async () => {
  let params;
  const controller = createAnalyticsController({ repo: rowlessRepo(), rpc: async (name, input) => {
    params = input;
    return { data: kinds[0][2] };
  } });
  const response = { status() { return this; }, json() {} };
  await controller.getEarlyWarning({ user: { id: actorId }, query: {
    from: '2026-05-01', to: '2026-05-31', year: '2026', municipalityId: 'foreign',
  } }, response);
  assert.equal(params.p_kind, 'early-warning');
  assert.equal(params.p_from, '2026-05-01');
  assert.equal(params.p_to, '2026-05-31');
  assert.equal(params.p_year, 2026);
  assert.equal(JSON.stringify(params).includes('foreign'), false);
  for (const query of [{ from: '2026-02-29' }, { from: '2026-05-02', to: '2026-05-01' },
    { year: 'bad' }, { year: '0000' }, { to: '2026-05-01T00:00:00Z' }]) {
    await assert.rejects(() => controller.getEarlyWarning({ user: { id: actorId }, query }, response),
      (error) => error.statusCode === 422);
  }
});

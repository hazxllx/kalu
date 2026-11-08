import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Test pure adapters with injected transports, without importing Vite/Auth or
// making network requests. The production module bodies are otherwise intact.
const monitoringSource = await readFile(new URL('../../src/services/api/monitoringApi.js', import.meta.url), 'utf8');
const monitoring = await import(`data:text/javascript;base64,${Buffer.from(monitoringSource.replace(
  /import \{ fetchEarlyWarningData \} from ['"]\.\/earlyWarningApi['"];?/, 'const fetchEarlyWarningData = async () => { throw new Error("Inject the aggregate API"); };',
)).toString('base64')}`);
const apiSource = await readFile(new URL('../../src/services/api/earlyWarningApi.js', import.meta.url), 'utf8');
const analyticsApi = await import(`data:text/javascript;base64,${Buffer.from(apiSource.replace(
  /import api from ['"]\.\/apiClient['"];?/, 'let apiGet; const api = { get: (...args) => apiGet(...args) }; export const setApiGet = (fn) => { apiGet = fn; };',
)).toString('base64')}`);

const payload = () => ({
  scope: { barangay: 'San Antonio' },
  summary: { residents: 6050, highRiskResidents: 4500, consultationsThisMonth: 7000, referralsThisMonth: 6500,
    topCondition: 'Tuberculosis', topConditionCases: 6100 },
  riskDistribution: [{ name: 'Low Risk', value: 500 }, { name: 'Moderate Risk', value: 1000 },
    { name: 'High Risk', value: 4500 }, { name: 'Unassessed', value: 50 }],
  diseaseDistribution: [{ name: 'Tuberculosis', value: 6100 }],
  consultationTrends: [{ month: 'Nov', consultations: 7000, referrals: 6500 }],
  monitoring: { verifiedResidents: 6000, totalHouseholds: 6000, householdRisk: { High: 1, Moderate: 2, Low: 5997 },
    activeFollowUps: 6200, pendingFollowUps: 6100, overdueFollowUps: 6000, upcomingFollowUps: 100,
    pendingReferrals: 6100, totalReferrals: 6500, maternalCases: 6100, activeMaternalCases: 6000, immunizationRecords: 6300 },
});

test('monitoring preserves the existing view-model with exact 6000+ aggregate counts, not capped row counts', () => {
  const result = monitoring.buildBarangayHealthOverview(payload());
  assert.deepEqual(result, {
    assignedBarangay: 'San Antonio',
    metrics: { totalResidents: 6050, verifiedResidents: 6000, totalHouseholds: 6000,
      householdRisk: { High: 1, Moderate: 2, Low: 5997 }, residentRisk: { high: 4500, moderate: 1000, low: 500, assessed: 6000 },
      consultationsThisMonth: 7000, referralsThisMonth: 6500, activeFollowUps: 6200, pendingFollowUps: 6100,
      overdueFollowUps: 6000, upcomingFollowUps: 100, pendingReferrals: 6100, totalReferrals: 6500,
      maternalCases: 6100, activeMaternalCases: 6000, immunizationRecords: 6300, topCondition: 'Tuberculosis', topConditionCases: 6100 },
    diseaseDistribution: [{ name: 'Tuberculosis', value: 6100 }],
    consultationTrends: [{ month: 'Nov', consultations: 7000, referrals: 6500 }],
    sources: { earlyWarning: true, residents: true, households: true, followUps: true, maternal: true, immunizations: true, referrals: true },
  });
});

test('monitoring performs one aggregate fetch and never sends label-only scope or loads PII row endpoints', async () => {
  let calls = 0;
  const result = await monitoring.getBarangayHealthOverview('Display label', { load: async (...args) => {
    assert.deepEqual(args, []);
    calls += 1;
    return payload();
  } });
  assert.equal(calls, 1);
  assert.equal(result.assignedBarangay, 'Display label');
  assert.equal(result.metrics.totalResidents, 6050);
  assert.doesNotMatch(monitoringSource, /residentsApi|householdsApi|referralsApi|operationalApi|\.list\(|\blimit\b|\bsafe\(/);
});

test('missing monitoring/source failures or malformed counts reject instead of creating successful zero metrics', async () => {
  for (const value of [null, {}, { ...payload(), monitoring: undefined },
    { ...payload(), monitoring: { ...payload().monitoring, verifiedResidents: null } },
    { ...payload(), summary: { ...payload().summary, residents: -1 } }]) {
    assert.throws(() => monitoring.buildBarangayHealthOverview(value), /unavailable/);
  }
  await assert.rejects(() => monitoring.getBarangayHealthOverview(null, { load: async () => { throw new Error('RPC unavailable'); } }), /RPC unavailable/);
});

test('real zero aggregates remain valid, and private source data is not copied into the view-model', () => {
  const value = payload();
  for (const key of Object.keys(value.summary)) if (typeof value.summary[key] === 'number') value.summary[key] = 0;
  for (const key of Object.keys(value.monitoring)) if (typeof value.monitoring[key] === 'number') value.monitoring[key] = 0;
  value.monitoring.householdRisk = { High: 0, Moderate: 0, Low: 0 };
  value.riskDistribution = value.riskDistribution.map((row) => ({ ...row, value: 0 }));
  value.diseaseDistribution = [];
  value.consultationTrends = [];
  value.residentNames = ['PRIVATE IDENTITY'];
  value.monitoring.residentRows = [{ name: 'PRIVATE IDENTITY' }];
  const result = monitoring.buildBarangayHealthOverview(value);
  assert.equal(result.metrics.totalResidents, 0);
  assert.equal(result.metrics.assessedResidents, undefined);
  assert.equal(result.metrics.residentRisk.assessed, 0);
  assert.equal(result.sources.earlyWarning, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE IDENTITY|residentRows|residentNames/);
});

test('analytics API adapters reject null/partial responses and transport failures, not fabricated empty success', async () => {
  const methods = ['fetchEarlyWarningData', 'fetchCommunityMap', 'fetchCommunityMapTrends', 'fetchHouseholdMap', 'fetchConditions'];
  for (const method of methods) {
    for (const malformed of [null, {}, []]) {
      analyticsApi.setApiGet(async () => malformed);
      await assert.rejects(() => analyticsApi[method](), /unavailable/);
    }
    analyticsApi.setApiGet(async () => { throw new Error('Aggregate RPC unavailable'); });
    await assert.rejects(() => analyticsApi[method](), /RPC unavailable/);
  }
});

test('analytics API adapters preserve payloads and only send supported filters, never client municipality IDs', async () => {
  const calls = [];
  const mapPayload = { summary: { totalCases: 6000 }, conditionTotals: [], barangays: [] };
  analyticsApi.setApiGet(async (...args) => { calls.push(args); return mapPayload; });
  assert.equal(await analyticsApi.fetchCommunityMap({ barangay: 'San Antonio', condition: 'Tuberculosis', distinctResidents: true,
    riskLevel: 'High', status: 'completed', from: '2026-05-01', to: '2026-05-31', municipalityId: 'foreign' }), mapPayload);
  assert.deepEqual(calls[0], ['/analytics/community-map', { params: { barangay: 'San Antonio', condition: 'Tuberculosis',
    distinctResidents: 'true', status: 'completed', riskLevel: 'High', from: '2026-05-01', to: '2026-05-31' } }]);
  const trendsPayload = { monthly: [{ month: 'May', cases: 6000 }], year: 2026 };
  analyticsApi.setApiGet(async (...args) => { calls.push(args); return trendsPayload; });
  assert.equal(await analyticsApi.fetchCommunityMapTrends({ distinctResidents: true, year: 2026 }), trendsPayload);
  assert.deepEqual(calls[1], ['/analytics/community-map/trends', { params: { distinctResidents: 'true', year: 2026 } }]);
});

test('activity is preserved by both adapters and reporting filters never turn the display label into query scope', async () => {
  const value = payload();
  value.activity = { schemaVersion: 1, timeZone: 'Asia/Manila', reportingPeriod: { from: '2026-05-01', to: '2026-05-31' },
    months: ['2026-05'], scopeComplete: true, rows: [{ barangay: 'San Antonio', month: '2026-05',
      followUps: { scheduled: 0, completed: 0, completionPercent: null }, immunizations: { records: 6000, residents: 5900 } }] };
  assert.equal(monitoring.buildBarangayHealthOverview(value).activity, value.activity);
  let request;
  analyticsApi.setApiGet(async (...args) => { request = args; return value; });
  assert.equal(await analyticsApi.fetchEarlyWarningData('San Antonio', {
    from: '2026-05-01', to: '2026-05-31', year: 2026, municipalityId: 'foreign',
  }), value);
  assert.deepEqual(request, ['/analytics/early-warning', { params: {
    barangay: 'San Antonio', from: '2026-05-01', to: '2026-05-31', year: 2026,
  } }]);
  const result = await monitoring.getBarangayHealthOverview('Display only', { from: '2026-05-01', to: '2026-05-31', year: 2026,
    load: async (...args) => {
      assert.deepEqual(args, [undefined, { from: '2026-05-01', to: '2026-05-31', year: 2026 }]);
      return value;
    } });
  assert.equal(result.assignedBarangay, 'Display only');
  assert.equal(result.activity, value.activity);
  assert.equal(result.activity.rows[0].followUps.completionPercent, null);
  assert.equal(result.activity.rows[0].immunizations.records, 6000);
});

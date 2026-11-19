import assert from 'node:assert/strict';
import test from 'node:test';
import { assessHealthData, assessVitals, healthDataFromVitals } from '../src/utils/residentRisk.js';
import { attachRiskToResidents, assessResidentById, getRiskSummary } from '../src/services/residentRisk.service.js';
import { assessPhnVisitRisk } from '../src/services/phnQueue.service.js';
import { getCommunityMap, getEarlyWarning, riskFromVitals, matchesCommunityMapRecord } from '../src/services/analytics.service.js';
import { DEFAULT_RISK_CONFIG } from '../src/config/riskConfig.js';

const residents = ['R-TEST-013', 'R-TEST-014', 'R-TEST-015', 'R-TEST-NO-VISIT'].map((id) => ({
  id, municipalityId: 'synthetic-municipality', barangay: 'San Antonio',
}));
const visits = [
  { id: 'V-013', residentId: 'R-TEST-013', visitDate: '2026-06-01T00:00:00Z', vitals: { bp: '120/80', o2sat: 98 } },
  { id: 'V-014', residentId: 'R-TEST-014', visitDate: '2026-06-01T00:00:00Z', vitals: { bp: '120/80' } },
  { id: 'V-015', residentId: 'R-TEST-015', visitDate: '2026-06-01T00:00:00Z', vitals: { bp: null, o2sat: null } },
];
const repo = {
  mode: 'file', driver: 'file',
  listVisits: async () => ({ rows: visits }),
  listReferrals: async () => ({ rows: [] }),
  searchResidents: async () => residents,
  listRiskCriteria: async () => [], getRiskSettings: async () => null,
};

test('KFT-014 complete, partial and absent inputs share the configured resident, PHN and map assessment', async () => {
  const attached = await attachRiskToResidents(residents, { repo });
  for (const [index, visit] of visits.entries()) {
    const result = assessVitals(visit.vitals);
    const phn = assessPhnVisitRisk(visit, DEFAULT_RISK_CONFIG);
    const detail = await assessResidentById({ id: visit.residentId, repo });
    assert.equal(result.level, index === 0 ? 'Low' : null);
    assert.equal(result.status, ['assessed', 'incomplete', 'unavailable'][index]);
    for (const assessment of [attached[index], phn, detail]) {
      assert.equal(assessment.riskLevel, result.level);
      assert.equal(assessment.riskScore, result.score);
      assert.equal(assessment.riskAssessmentStatus, result.status);
      assert.deepEqual(assessment.missingMeasurements, result.missingMeasurements);
      assert.equal(assessment.riskReason, result.reason);
      assert.equal(assessment.riskAssessedAt, result.level === null ? null : visit.visitDate);
    }
    assert.equal(riskFromVitals(visit.vitals), result.level);
    assert.equal(matchesCommunityMapRecord(visit, { riskLevel: 'Low' }), index === 0);
    assert.equal(matchesCommunityMapRecord(visit, { riskLevel: 'Unassessed' }), index !== 0);
  }
  assert.equal(attached[3].riskLevel, null);
});

test('KFT-014 null, invalid, unavailable and unrelated measurements cannot establish Low', () => {
  for (const vitals of [null, undefined, {}, { o2sat: null }, { o2sat: '' }, { o2sat: 'N/A' },
    { o2sat: true }, { o2sat: [] }, { o2sat: {} }, { o2sat: Infinity }, { o2sat: NaN },
    { o2sat: 0 }, { o2sat: -1 }, { o2sat: '0x62' }, { bp: 'text120/80junk' }, { bp: '000/00' },
    { temperature: 36.5, hr: 72, rr: 16, heightCm: 170, weightKg: 60 }]) {
    const result = assessVitals(vitals);
    assert.equal(result.level, null, JSON.stringify(vitals));
    assert.equal(result.status, 'unavailable');
    assert.equal(result.score, null);
  }
  assert.equal(healthDataFromVitals({ heightCm: true, weightKg: 60 }).bmi, null);
  assert.equal(assessHealthData({ systolic: true, o2sat: 98 }).level, null);
});

test('KFT-014 active criteria determine required measurements without adding clinical thresholds', () => {
  const config = { thresholds: { moderateMin: 12, highMin: 30 }, criteria: [
    { code: 'configured', name: 'Configured temperature rule', field: 'temperature', operator: 'gte', value: 38, weight: 12 },
    { code: 'disabled', field: 'o2sat', operator: 'lt', value: 95, weight: 70, enabled: false },
  ] };
  assert.equal(assessVitals({ temperature: 36.5 }, config).level, 'Low');
  assert.equal(assessVitals({ temperature: 38 }, config).level, 'Moderate');
  assert.equal(assessVitals({ bp: '120/80', o2sat: 98 }, config).level, null);
  assert.equal(assessVitals({ bp: '120/80', o2sat: 98 }, { ...config, criteria: [] }).level, null);
});

test('KFT-014 positive configured findings remain visible with explicit missing-input metadata', () => {
  for (const [bp, expected] of [['135/80', 'Moderate'], ['145/95', 'High']]) {
    const result = assessVitals({ bp });
    assert.equal(result.level, expected);
    assert.equal(result.status, 'assessed');
    assert.deepEqual(result.missingMeasurements, ['o2sat']);
    assert.match(result.reason, /Missing measurements: oxygen saturation/);
  }
});

test('KFT-014 community distribution includes no-visit residents as Unassessed and excludes partial Low', async () => {
  const summary = await getRiskSummary({ repo, municipalityId: 'synthetic-municipality' });
  assert.equal(summary.totalResidents, 4);
  assert.equal(summary.assessed, 1);
  assert.equal(summary.low, 1);
  assert.equal(summary.high, 0);
  assert.equal(summary.unassessed, 3);
  const analytics = await getEarlyWarning({ municipalityId: 'synthetic-municipality' }, { repo, now: new Date('2026-06-15T00:00:00Z') });
  assert.deepEqual(analytics.riskDistribution, summary.distribution);
});

test('KFT-014 individual and community reads select the same latest visit across offsets and ties', async () => {
  const sameInstant = '2026-06-01T08:00:00+08:00';
  const orderedVisits = [
    { id: 'a', residentId: 'R-TEST-013', visitDate: sameInstant, updatedAt: '2026-06-02T00:00:00Z', vitals: { bp: '120/80', o2sat: 98 } },
    { id: 'z', residentId: 'R-TEST-013', visitDate: '2026-06-01T00:00:00Z', updatedAt: '2026-06-02T00:00:00Z', vitals: { bp: '145/95', o2sat: 98 } },
  ];
  for (const rows of [orderedVisits, [...orderedVisits].reverse()]) {
    const tieRepo = { ...repo, listVisits: async () => ({ rows }) };
    const detail = await assessResidentById({ id: 'R-TEST-013', repo: tieRepo });
    const summary = await getRiskSummary({ repo: tieRepo });
    const analytics = await getEarlyWarning({}, { repo: tieRepo });
    assert.equal(detail.riskLevel, 'High');
    assert.equal(summary.high, 1);
    assert.equal(analytics.riskDistribution.find((row) => row.name === 'High Risk').value, 1);
  }
});

test('KFT-014 unavailable source cannot fall back to stale stored Low risk', async () => {
  await assert.rejects(attachRiskToResidents([{ id: 'R-TEST-014', riskLevel: 'Low' }], {
    repo: { ...repo, listVisits: async () => { throw new Error('Synthetic unavailable source'); } },
  }), { statusCode: 503, code: 'RISK_SOURCE_UNAVAILABLE' });
});

test('KFT-014 a distribution without assessed residents has no percentage denominator', async () => {
  const summary = await getRiskSummary({ repo: { ...repo, listVisits: async () => ({ rows: [] }) } });
  assert.equal(summary.assessed, 0);
  assert.equal(summary.unassessed, 4);
  assert.equal(summary.highRiskPercentage, null);
});

test('KFT-015 selected reporting year uses the latest assessment within that Manila reporting period', async () => {
  const periodRepo = { ...repo, listVisits: async () => ({ rows: [
    { id: 'old', residentId: 'R-TEST-013', visitDate: '2025-12-31T15:59:59.999Z', vitals: { bp: '145/95', o2sat: 98 } },
    { id: 'start', residentId: 'R-TEST-013', visitDate: '2025-12-31T16:00:00Z', vitals: { bp: '120/80', o2sat: 98 } },
    { id: 'partial', residentId: 'R-TEST-014', visitDate: '2026-06-01T00:00:00Z', vitals: { bp: '120/80' } },
    { id: 'future', residentId: 'R-TEST-013', visitDate: '2026-12-31T16:00:00Z', vitals: { bp: '145/95', o2sat: 98 } },
  ] }) };
  const options = { repo: periodRepo, now: new Date('2026-11-19T00:00:00Z') };
  const current = await getEarlyWarning({ year: 2026 }, options);
  assert.deepEqual(current.reportingPeriod, { from: '2026-01-01', to: '2026-12-31', year: 2026 });
  assert.deepEqual(current.reportingRiskDistribution.map((row) => row.value), [1, 0, 0, 3]);
  assert.equal(current.riskDistribution.find((row) => row.name === 'High Risk').value, 1);
  const previous = await getEarlyWarning({ year: 2025 }, options);
  assert.deepEqual(previous.reportingRiskDistribution.map((row) => row.value), [0, 0, 1, 3]);
  const empty = await getEarlyWarning({ from: '2024-01-01', to: '2024-12-31' }, options);
  assert.deepEqual(empty.reportingRiskDistribution.map((row) => row.value), [0, 0, 0, 4]);
  const mapRepo = { ...periodRepo,
    listBarangays: async () => [{ id: 'synthetic-barangay', name: 'San Antonio', municipality_id: 'synthetic-municipality' }],
    listTclEntries: async () => ({ rows: [] }),
  };
  const mapOptions = { ...options, repo: mapRepo };
  const map = await getCommunityMap({ municipalityId: 'synthetic-municipality', from: '2026-01-01', to: '2026-12-31' }, mapOptions);
  const barangay = map.barangays.find((row) => row.name === 'San Antonio');
  assert.equal(barangay.highRiskResidents, 1, 'legacy current classification remains explicit');
  assert.equal(barangay.reportingHighRiskResidents, 0);
  assert.equal(barangay.riskCounts.Low, 1);
  assert.equal(barangay.riskCounts.Unassessed, 1);
});

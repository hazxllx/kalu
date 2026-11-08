import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { optionalSeries, healthTrendScope, lastActivityPeriod } from '../../src/lib/legacyAnalytics.js';

const fixture = () => ({
  scope: { barangay: 'San Isidro' },
  summary: { consultationsThisMonth: 2, referralsThisMonth: 3, topConditionCases: 0, highRiskResidents: 1 },
  consultationTrends: [{ month: 'Jan', consultations: 1 }, { month: 'Feb', consultations: 2 }],
  riskDistribution: [], diseaseDistribution: [],
  activity: { schemaVersion: 1, scopeComplete: true, months: ['2026-01', '2026-02'], rows: [
    { month: '2026-01', barangay: 'San Isidro', followUps: { scheduled: 10, completed: 2 }, referrals: { created: 10, completed: 2 },
      maternal: { records: 8, residents: 3 }, consultations: { minor: { records: 9, residents: 4 }, senior: { records: 4, residents: 2 } },
      immunizations: { records: 3000, residents: 900 }, tcl: { enrolledResidents: 4, participatingResidents: 5 } },
    { month: '2026-02', barangay: 'San Isidro', followUps: { scheduled: 90, completed: 8 }, referrals: { created: 90, completed: 8 },
      maternal: { records: 12, residents: 5 }, consultations: { minor: { records: 15, residents: 7 }, senior: { records: 7, residents: 3 } },
      immunizations: { records: 4000, residents: 1200 }, tcl: { enrolledResidents: 5, participatingResidents: 6 } },
  ] },
});

test('monthly follow-up charts consume activity and preserve null completion denominators', () => {
  const data = fixture();
  const rows = optionalSeries(data, 'followUpCompletion', 12, ['San Isidro', 'Poblacion']);
  assert.equal(rows[0]['San Isidro'], 20);
  assert.equal(rows[0].denominator, 10);
  assert.equal(rows[0].numerator, 2);
  assert.equal(rows[0]['Poblacion'], null);
  data.activity.rows = [];
  assert.equal(optionalSeries(data, 'followUpCompletion')[0].value, null);
});

test('referral comparison is weighted by real cohort totals, not averaged monthly percentages', () => {
  const rows = optionalSeries(fixture(), 'referralCompletion');
  assert.equal(rows[0].value, 10);
  assert.equal(rows[0].numerator, 10);
  assert.equal(rows[0].denominator, 100);
});

test('maternal and senior monthly trends use recorded resident counts and stay visible above percentage bounds', () => {
  const data = fixture();
  assert.deepEqual(optionalSeries(data, 'maternalTrend').map((row) => row.count), [3, 5]);
  assert.deepEqual(optionalSeries(data, 'seniorTrend').map((row) => row.count), [2, 3]);
  const view = healthTrendScope(data, 1);
  assert.equal(view.maternalTrend[0].count, 5);
  assert.equal(view.seniorTrend[0].count, 3);
});

test('immunization, minor and TCL charts use the latest month counts, never fabricated coverage/compliance rates', () => {
  const data = fixture();
  assert.equal(optionalSeries(data, 'vaccinationCoverage')[0].value, 4000);
  assert.equal(optionalSeries(data, 'vaccinationCoverage')[0].denominator, null);
  assert.equal(optionalSeries(data, 'childHealthCoverage')[0].value, 7);
  assert.equal(optionalSeries(data, 'programParticipation')[0].value, 6);
  assert.equal(optionalSeries(data, 'programCompliance')[0].value, 5);
});

test('zero count bars require a complete readable scope; incomplete and malformed data stay unavailable', () => {
  const data = fixture();
  assert.equal(optionalSeries(data, 'vaccinationCoverage', 12, ['Poblacion']).find((row) => row.name === 'Poblacion').value, 0);
  data.activity.scopeComplete = false;
  assert.equal(optionalSeries(data, 'vaccinationCoverage'), null);
  data.activity.scopeComplete = true;
  data.activity.rows[0].month = 'invalid';
  assert.equal(optionalSeries(data, 'vaccinationCoverage'), null);
});

test('duplicate aggregate cells and missing observed counts cannot silently become valid chart figures', () => {
  const data = fixture();
  data.activity.rows.push(data.activity.rows[0]);
  assert.equal(optionalSeries(data, 'maternalTrend'), null);
  data.activity.rows.pop();
  delete data.activity.rows[1].immunizations.records;
  assert.equal(optionalSeries(data, 'vaccinationCoverage')[0].value, null);
});

test('activity periods use Manila month boundaries and retain exactly the requested reporting months', () => {
  assert.deepEqual(lastActivityPeriod(3, new Date('2026-10-31T16:05:00Z')), { from: '2026-09-01', to: '2026-11-01' });
  assert.deepEqual(lastActivityPeriod(12, new Date('2027-01-31T10:00:00Z')), { from: '2026-02-01', to: '2027-01-31' });
});

test('retained chart pages load the real activity adapter, label counts accurately, and do not clip counts at 100', async () => {
  const analytics = await readFile(new URL('../../src/features/analytics/pages/Analytics.jsx', import.meta.url), 'utf8');
  const trends = await readFile(new URL('../../src/features/analytics/pages/HealthTrends.jsx', import.meta.url), 'utf8');
  assert.match(analytics, /earlyWarning\(lastActivityPeriod\(\)/);
  assert.match(analytics, /title="Recorded Immunizations"/);
  assert.match(analytics, /not administered doses or official coverage/);
  assert.match(analytics, /domain=\{\[0, "auto"\]\}/);
  assert.doesNotMatch(analytics, /domain=\{\[60, 100\]\}/);
  assert.match(trends, /lastActivityPeriod\(period ===/);
  assert.match(trends, /Recorded TCL Enrollments/);
  assert.match(trends, /dataKey="value" name="Residents"/);
  assert.doesNotMatch(trends, /Completion Rate \(%\)/);
});

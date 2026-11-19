import assert from 'node:assert/strict';
import test from 'node:test';
import { assessPhnVisitRisk } from '../src/services/phnQueue.service.js';

const config = {
  thresholds: { moderateMin: 40, highMin: 70 },
  criteria: [
    { code: 'bp_high', name: 'High blood pressure', field: 'systolic', operator: 'gte', value: 140, weight: 70, enabled: true },
    { code: 'oxygen_low', name: 'Low oxygen saturation', field: 'o2sat', operator: 'lt', value: 95, weight: 70, enabled: true },
  ],
};

test('PHN assessment reports unavailable when all configured measurements are absent', () => {
  const result = assessPhnVisitRisk({ id: 'visit-1', vitals: {} }, config);
  assert.equal(result.riskLevel, null);
  assert.equal(result.riskAssessmentStatus, 'unavailable');
  assert.match(result.riskReason, /No measurements/);
});

test('PHN assessment does not report Low when a configured risk input is missing', () => {
  const result = assessPhnVisitRisk({ id: 'visit-2', vitals: { bp: '120/80' } }, config);
  assert.equal(result.riskLevel, null);
  assert.equal(result.riskAssessmentStatus, 'incomplete');
  assert.match(result.riskReason, /oxygen saturation/);
});

test('PHN assessment keeps configured classifications and explains when no factor matched', () => {
  const result = assessPhnVisitRisk({ id: 'visit-3', visitDate: '2026-11-19T08:00:00Z', vitals: { bp: '120/80', o2sat: 98 } }, config);
  assert.equal(result.riskLevel, 'Low');
  assert.equal(result.riskScore, 0);
  assert.equal(result.riskAssessmentStatus, 'assessed');
  assert.match(result.riskReason, /No configured risk criteria matched/);
  assert.equal(result.riskAssessedAt, '2026-11-19T08:00:00Z');
});

test('PHN assessment returns the factor label and existing configured classification', () => {
  const result = assessPhnVisitRisk({ id: 'visit-4', vitals: { bp: '150/95', o2sat: 98 } }, config);
  assert.equal(result.riskLevel, 'High');
  assert.equal(result.riskAssessmentStatus, 'assessed');
  assert.equal(result.riskFactors[0].name, 'High blood pressure');
  assert.match(result.riskReason, /High blood pressure/);
});

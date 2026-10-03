import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessVitals,
  assessHealthData,
  classifyLevel,
  healthDataFromVitals,
  evaluateCriterion,
} from '../src/utils/residentRisk.js';
import { DEFAULT_RISK_CONFIG } from '../src/config/riskConfig.js';

/**
 * Resident risk engine — the single authoritative, rule-based classifier.
 *
 * These exercise the required behavior: a resident with no applicable factors
 * is Low, moderate factors are Moderate, high factors are High, and both a
 * criterion weight change and a threshold change re-classify the resident
 * (propagation), all from the one engine.
 */

test('TEST 1 — no applicable risk factors is Low', () => {
  const { score, level } = assessVitals({ bp: '120/80', o2sat: 98 }, DEFAULT_RISK_CONFIG);
  assert.equal(score, 0);
  assert.equal(level, 'Low');
});

test('TEST 2 — moderate applicable factors is Moderate', () => {
  // Elevated systolic (130-139) contributes 40 -> Moderate (40..69).
  const { score, level } = assessVitals({ bp: '135/88', o2sat: 98 }, DEFAULT_RISK_CONFIG);
  assert.equal(score, 40);
  assert.equal(level, 'Moderate');
});

test('TEST 3 — high applicable factors is High', () => {
  const high = assessVitals({ bp: '150/95', o2sat: 98 }, DEFAULT_RISK_CONFIG);
  assert.equal(high.level, 'High');
  const lowO2 = assessVitals({ bp: '120/80', o2sat: 90 }, DEFAULT_RISK_CONFIG);
  assert.equal(lowO2.level, 'High');
});

test('reproduces the original vitals heuristic exactly at the boundaries', () => {
  assert.equal(assessVitals({ bp: '129/80' }, DEFAULT_RISK_CONFIG).level, 'Low');
  assert.equal(assessVitals({ bp: '130/80' }, DEFAULT_RISK_CONFIG).level, 'Moderate');
  assert.equal(assessVitals({ bp: '139/80' }, DEFAULT_RISK_CONFIG).level, 'Moderate');
  assert.equal(assessVitals({ bp: '140/80' }, DEFAULT_RISK_CONFIG).level, 'High');
  assert.equal(assessVitals({ o2sat: 94 }, DEFAULT_RISK_CONFIG).level, 'High');
  assert.equal(assessVitals({ o2sat: 95 }, DEFAULT_RISK_CONFIG).level, 'Low');
});

test('TEST 6 — changing a THRESHOLD re-classifies a resident (propagation)', () => {
  const vitals = { bp: '135/88' }; // score 40
  assert.equal(assessVitals(vitals, DEFAULT_RISK_CONFIG).level, 'Moderate');
  // Administrator lowers the High cutoff to 40 -> the same resident is now High.
  const config = { thresholds: { moderateMin: 20, highMin: 40 }, criteria: DEFAULT_RISK_CONFIG.criteria };
  assert.equal(assessVitals(vitals, config).level, 'High');
});

test('TEST 5 — changing a CRITERION weight re-classifies a resident (propagation)', () => {
  const vitals = { bp: '135/88' };
  // Base: elevated BP = 40 -> Moderate.
  assert.equal(assessVitals(vitals, DEFAULT_RISK_CONFIG).level, 'Moderate');
  // Administrator raises the elevated-BP weight 40 -> 75; now it crosses High (70).
  const criteria = DEFAULT_RISK_CONFIG.criteria.map((c) =>
    c.code === 'bp_systolic_elevated' ? { ...c, weight: 75 } : c);
  const result = assessVitals(vitals, { thresholds: DEFAULT_RISK_CONFIG.thresholds, criteria });
  assert.equal(result.score, 75);
  assert.equal(result.level, 'High');
});

test('disabled criteria never contribute', () => {
  const criteria = DEFAULT_RISK_CONFIG.criteria.map((c) =>
    c.code === 'bp_systolic_high' ? { ...c, enabled: false } : c);
  const result = assessVitals({ bp: '150/95' }, { thresholds: DEFAULT_RISK_CONFIG.thresholds, criteria });
  assert.equal(result.score, 0);
  assert.equal(result.level, 'Low');
});

test('factors list only the criteria that applied, with their weights', () => {
  const { factors } = assessVitals({ bp: '150/95', o2sat: 90 }, DEFAULT_RISK_CONFIG);
  const codes = factors.map((f) => f.code).sort();
  assert.deepEqual(codes, ['bp_systolic_high', 'o2sat_low']);
  assert.equal(factors.reduce((s, f) => s + f.weight, 0), 140);
});

test('classifyLevel honours custom thresholds', () => {
  const t = { moderateMin: 10, highMin: 20 };
  assert.equal(classifyLevel(5, t), 'Low');
  assert.equal(classifyLevel(10, t), 'Moderate');
  assert.equal(classifyLevel(20, t), 'High');
});

test('healthDataFromVitals parses BP and numeric vitals', () => {
  const d = healthDataFromVitals({ bp: '142/91', o2sat: '96', hr: '88' });
  assert.equal(d.systolic, 142);
  assert.equal(d.diastolic, 91);
  assert.equal(d.o2sat, 96);
  assert.equal(d.pulse, 88);
});

test('evaluateCriterion handles between + missing data', () => {
  const c = { field: 'systolic', operator: 'between', value: 130, value2: 139 };
  assert.equal(evaluateCriterion(c, { systolic: 135 }), true);
  assert.equal(evaluateCriterion(c, { systolic: 140 }), false);
  assert.equal(evaluateCriterion(c, {}), false);
});

test('no assessable data scores 0 / Low (not an error)', () => {
  const { score, level } = assessHealthData({}, DEFAULT_RISK_CONFIG);
  assert.equal(score, 0);
  assert.equal(level, 'Low');
});

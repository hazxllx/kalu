import assert from 'node:assert/strict';
import test from 'node:test';

import { computeHouseholdRisk, riskLevelFromScore } from '../src/utils/householdRisk.js';

// Issue 12B — regression + boundary guard for the AUTHORITATIVE household
// sanitation-risk model. These lock the documented weights/thresholds (no value
// is changed here); the frontend display copy is guarded by an equivalent
// parity test asserting the SAME expected outputs, so the two cannot drift.

test('riskLevelFromScore boundaries: 40 => Moderate, 60 => High', () => {
  assert.equal(riskLevelFromScore(0), 'Low');
  assert.equal(riskLevelFromScore(39), 'Low');
  assert.equal(riskLevelFromScore(40), 'Moderate'); // lower boundary inclusive
  assert.equal(riskLevelFromScore(59), 'Moderate');
  assert.equal(riskLevelFromScore(60), 'High'); // upper boundary inclusive
  assert.equal(riskLevelFromScore(100), 'High');
});

test('empty / missing household data scores 0 (Low) — never defaulted to normal risk', () => {
  const r = computeHouseholdRisk({});
  assert.equal(r.score, 0);
  assert.equal(r.level, 'Low');
  assert.deepEqual(r.factors, []);
});

test('documented factor weights sum deterministically', () => {
  // unimproved water (40) + income < 5000 (20) = 60 => High (boundary).
  assert.deepEqual(
    (() => { const { score, level } = computeHouseholdRisk({ waterSource: 'unimproved', income: 4000 }); return { score, level }; })(),
    { score: 60, level: 'High' },
  );
  // level1 water (30) + open_pit toilet (25) = 55 => Moderate.
  assert.deepEqual(
    (() => { const { score, level } = computeHouseholdRisk({ waterSource: 'level1', toilet: 'open_pit' }); return { score, level }; })(),
    { score: 55, level: 'Moderate' },
  );
  // level2 water (15) + shared toilet (10) + shared sanitation (10) = 35 => Low.
  assert.deepEqual(
    (() => { const { score, level } = computeHouseholdRisk({ waterSource: 'level2', toilet: 'ws_shared', sanitationAccess: 'Shared with other household' }); return { score, level }; })(),
    { score: 35, level: 'Low' },
  );
});

test('vulnerable members and income add their documented weights', () => {
  const r = computeHouseholdRisk({
    toilet: 'none', // 40
    members: [{ classification: 'P' }, { classification: 'SC', pwd: true }], // P 15 + SC 10 + PWD 10
    income: 9000, // < 10000 => 10
  });
  assert.equal(r.score, 40 + 15 + 10 + 10 + 10);
  assert.equal(r.level, 'High');
});

test('invalid / non-positive income contributes nothing', () => {
  assert.equal(computeHouseholdRisk({ income: 0 }).score, 0);
  assert.equal(computeHouseholdRisk({ income: -500 }).score, 0);
  assert.equal(computeHouseholdRisk({ income: 'NaN' }).score, 0);
});

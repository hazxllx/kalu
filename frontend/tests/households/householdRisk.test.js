// Issue 12B — client/server PARITY guard for the household sanitation-risk model.
//
// The frontend display copy (householdOptions.computeHouseholdRisk) must produce
// the SAME score/level as the server-authoritative model
// (backend/src/utils/householdRisk.js). The expected values below are identical
// to those asserted in backend/test/householdRisk.test.js, so if either copy's
// weights/thresholds drift, one of the two suites fails. No value is changed.
//
// Run: node --test tests/households/householdRisk.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { computeHouseholdRisk, riskFromScore } from "../../src/features/households/lib/householdOptions.js";

test("riskFromScore boundaries match the authoritative 40/60 cut-offs", () => {
  assert.equal(riskFromScore(0), "Low");
  assert.equal(riskFromScore(39), "Low");
  assert.equal(riskFromScore(40), "Moderate");
  assert.equal(riskFromScore(59), "Moderate");
  assert.equal(riskFromScore(60), "High");
});

test("empty household scores 0 (Low)", () => {
  const r = computeHouseholdRisk({});
  assert.equal(r.score, 0);
  assert.equal(r.level, "Low");
});

test("parity: documented factor combinations match the server model", () => {
  const a = computeHouseholdRisk({ waterSource: "unimproved", income: 4000 });
  assert.deepEqual({ score: a.score, level: a.level }, { score: 60, level: "High" });

  const b = computeHouseholdRisk({ waterSource: "level1", toilet: "open_pit" });
  assert.deepEqual({ score: b.score, level: b.level }, { score: 55, level: "Moderate" });

  const c = computeHouseholdRisk({ waterSource: "level2", toilet: "ws_shared", sanitationAccess: "Shared with other household" });
  assert.deepEqual({ score: c.score, level: c.level }, { score: 35, level: "Low" });
});

test("parity: vulnerable members + income weights match the server model", () => {
  const r = computeHouseholdRisk({
    toilet: "none",
    members: [{ classification: "P" }, { classification: "SC", pwd: true }],
    income: 9000,
  });
  assert.equal(r.score, 40 + 15 + 10 + 10 + 10);
  assert.equal(r.level, "High");
});

test("parity: invalid income contributes nothing", () => {
  assert.equal(computeHouseholdRisk({ income: 0 }).score, 0);
  assert.equal(computeHouseholdRisk({ income: -500 }).score, 0);
});

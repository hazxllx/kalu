import assert from "node:assert/strict";
import test from "node:test";

import { consultationRiskLevel } from "../../src/features/consultations/lib/consultationRisk.js";

test("consultation risk uses the saved encounter assessment and normalizes its category", () => {
  for (const [level, expected] of [["Low", "Low"], ["Medium", "Moderate"], ["HIGH", "High"]]) {
    assert.equal(consultationRiskLevel({ clinicalAssessment: { level } }), expected);
  }
});

test("consultation risk reads legacy JSON property names and assessment history", () => {
  assert.equal(consultationRiskLevel({
    consultation_details: { clinicalAssessmentHistory: [{ level: "High Risk" }] },
  }), "High");
  assert.equal(consultationRiskLevel({ clinical_assessment: { risk_level: "moderate" } }), "Moderate");
  assert.equal(consultationRiskLevel({ risk_level: "low" }), "Low");
});

test("consultation risk stays unassessed without an encounter assessment", () => {
  assert.equal(consultationRiskLevel({
    resident: { riskLevel: "High" },
    vitals: { bp: "190/120", o2sat: 80 },
    nextVisitDate: "2026-11-30",
  }), null);
  assert.equal(consultationRiskLevel({ clinicalAssessment: { level: null }, riskLevel: null }), null);
});

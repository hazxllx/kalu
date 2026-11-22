import assert from "node:assert/strict";
import test from "node:test";

import { consultationRiskLevel, consultationRiskReasons, consultationServiceName, consultationHealthServiceLabel, consultationTemperatureWarningVisible, consultationFollowUp } from "../../src/features/consultations/lib/consultationRisk.js";

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

test("saved clinical reasons, joined service and actual follow-up status use persisted fields", () => {
  const row = { consultationRiskAssessment: { level: "Medium", reasons: [{ ruleId: "bp_stage2", message: "BP requires clinical monitoring." }] },
    healthService: { name: "Actual Registered Service" }, followUpRequired: "No", nextVisitDate: "2026-11-22", followUps: [{ status: "Completed", scheduled_date: "2026-11-24" }] };
  assert.equal(consultationRiskLevel(row), "Moderate");
  assert.equal(consultationRiskReasons(row), "BP requires clinical monitoring.");
  assert.equal(consultationServiceName(row), "Actual Registered Service");
  assert.deepEqual(consultationFollowUp(row), { has: true, date: "2026-11-24", status: "Completed" });
});

test("follow-up display distinguishes unrequired, pending, scheduled and overdue states", () => {
  assert.deepEqual(consultationFollowUp({ followUpRequired: "No" }), { has: false, date: "", status: "No" });
  assert.deepEqual(consultationFollowUp({ followUpRequired: "Yes" }), { has: true, date: "", status: "Pending" });
  assert.deepEqual(consultationFollowUp({ followUpRequired: true }), { has: true, date: "", status: "Pending" });
  assert.deepEqual(consultationFollowUp({ followUps: [{ status: "Pending", scheduled_date: "2026-11-24" }] }),
    { has: true, date: "2026-11-24", status: "Pending" });
  assert.deepEqual(consultationFollowUp({ followUpRequired: "Yes", nextVisitDate: "2026-11-30" }),
    { has: true, date: "2026-11-30", status: "Scheduled" });
  assert.deepEqual(consultationFollowUp({ followUpRequired: "No", nextVisitDate: "2026-11-30" }),
    { has: false, date: "", status: "No" });
  assert.deepEqual(consultationFollowUp({ followUps: [{ status: "Pending", scheduled_date: "2026-11-24", is_overdue: true }] }),
    { has: true, date: "2026-11-24", status: "Overdue" });
});

test("historical scalar reasons do not crash or fabricate a new assessment", () => {
  assert.equal(consultationRiskReasons({ clinicalAssessment: { level: "High", reasons: "Urgent assessment documented" } }), "Urgent assessment documented");
  assert.equal(consultationRiskReasons({ clinicalAssessment: { reasons: { invalid: true } } }), "");
  assert.equal(consultationRiskLevel({ clinicalAssessment: { reasons: { invalid: true } } }), null);
});

test("registered service labels avoid duplicate codes and categories", () => {
  assert.equal(consultationHealthServiceLabel({ name: "immunization", category: "Immunization" }), "Immunization");
  assert.equal(consultationHealthServiceLabel({ name: "immunization", category: "immunization" }), "Immunization");
  assert.equal(consultationHealthServiceLabel({ name: "Consult", category: "Consultation" }), "Consultation");
  assert.equal(consultationHealthServiceLabel({ name: "Consult", category: "consultation" }), "Consultation");
  assert.equal(consultationHealthServiceLabel({ name: "Prenatal", category: "maternal" }), "Prenatal / Maternal");
  assert.equal(consultationHealthServiceLabel({ name: "Wellness Visit", category: "Consultation" }), "Wellness Visit");
});

test("temperature review warning appears only at 60°C or above for valid numeric input", () => {
  assert.equal(consultationTemperatureWarningVisible("59.9"), false);
  assert.equal(consultationTemperatureWarningVisible("60"), true);
  assert.equal(consultationTemperatureWarningVisible("60.1"), true);
  assert.equal(consultationTemperatureWarningVisible(""), false);
  assert.equal(consultationTemperatureWarningVisible("60C"), false);
});

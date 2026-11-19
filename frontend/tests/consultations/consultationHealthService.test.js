import assert from "node:assert/strict";
import test from "node:test";

import { mapVisitToPatient } from "../../src/lib/phnWorkflowMap.js";
import { riskOfPatient } from "../../src/lib/riskRules.js";

test("shared consultation records retain the selected health service in details", () => {
  const patient = mapVisitToPatient({
    id: "visit-1",
    status: "completed",
    healthServiceId: "service-1",
    healthServiceName: "Maternal Care",
    resident: { firstName: "A", lastName: "Resident" },
    findings: "Assessment",
    phn: { assessment: "Hypertension" },
  });

  assert.equal(patient.serviceId, "service-1");
  assert.equal(patient.serviceName, "Maternal Care");
  assert.equal(patient.checkup.healthServiceName, "Maternal Care");
});

test("legacy consultation records without a health service map to an empty association", () => {
  const patient = mapVisitToPatient({
    id: "visit-legacy",
    status: "submitted",
    resident: { firstName: "A", lastName: "Resident" },
  });

  assert.equal(patient.serviceId, null);
  assert.equal(patient.serviceName, "");
});

test("PHN workflow shows backend risk factors and preserves unavailable/incomplete states", () => {
  const high = mapVisitToPatient({
    id: "visit-risk",
    status: "submitted",
    riskLevel: "High",
    riskFactors: [{ name: "High blood pressure", measured: 150 }],
    riskReason: "High blood pressure (150)",
    riskAssessmentStatus: "assessed",
    resident: { firstName: "A", lastName: "Resident" },
  });
  assert.deepEqual(riskOfPatient(high), { level: "High", reason: "High blood pressure (150)" });

  const incomplete = mapVisitToPatient({
    id: "visit-incomplete",
    status: "submitted",
    riskLevel: null,
    riskAssessmentStatus: "incomplete",
    riskReason: "Assessment incomplete. Missing measurements: oxygen saturation.",
    resident: { firstName: "A", lastName: "Resident" },
  });
  assert.deepEqual(riskOfPatient(incomplete), { level: "Incomplete", reason: incomplete.riskReason });
  assert.deepEqual(riskOfPatient({}), {
    level: "Unassessed",
    reason: "The backend assessment breakdown is unavailable. Reload the record to verify the assessment.",
  });
});

test("PHN outcome drafts carry the resident id rather than the visit id", () => {
  const patient = mapVisitToPatient({
    id: "visit-123",
    residentId: "resident-456",
    status: "in_review",
    resident: { firstName: "A", lastName: "Resident" },
  });
  assert.equal(patient.id, "visit-123");
  assert.equal(patient.residentId, "resident-456");
});

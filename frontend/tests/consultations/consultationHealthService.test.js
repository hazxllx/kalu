import assert from "node:assert/strict";
import test from "node:test";

import { mapVisitToPatient } from "../../src/lib/phnWorkflowMap.js";

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

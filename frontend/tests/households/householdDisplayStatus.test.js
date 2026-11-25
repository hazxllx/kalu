import test from "node:test";
import assert from "node:assert/strict";
import { getHouseholdDisplayStatus } from "../../src/features/households/lib/householdOptions.js";

test("household display status remains pending until verification and approval are complete", () => {
  assert.equal(getHouseholdDisplayStatus({ verificationStatus: "Pending Verification", approvalStatus: "Approved" }), "Pending");
  assert.equal(getHouseholdDisplayStatus({ verificationStatus: "Verified", approvalStatus: "Not yet approved" }), "Pending");
  assert.equal(getHouseholdDisplayStatus({ verificationStatus: "Pending Verification", approvalStatus: "Not yet approved" }), "Pending");
});

test("household display status maps completed, correction, and rejected workflow outcomes", () => {
  assert.equal(getHouseholdDisplayStatus({ verificationStatus: "Verified", approvalStatus: "Approved" }), "Approved");
  assert.equal(getHouseholdDisplayStatus({ verificationStatus: "Returned for Correction", approvalStatus: "Not yet approved" }), "Needs Update");
  assert.equal(getHouseholdDisplayStatus({ verificationStatus: "Verified", approvalStatus: "Needs revision" }), "Needs Update");
  assert.equal(getHouseholdDisplayStatus({ hhStatus: "Refused", verificationStatus: "Returned for Correction" }), "Rejected");
});


test("missing or unknown workflow fields cannot imply approval", () => {
  for (const household of [undefined, {}, { hhStatus: "Approved" },
    { verificationStatus: "Verified" }, { approvalStatus: "Approved" },
    { verificationStatus: "unknown", approvalStatus: "Approved" }]) {
    assert.equal(getHouseholdDisplayStatus(household), "Pending");
  }
});

test("correction and rejection take precedence without mutating workflow records", () => {
  const household = Object.freeze({ verificationStatus: "Verified", approvalStatus: "Approved", hhStatus: "Needs Update" });
  assert.equal(getHouseholdDisplayStatus(household), "Needs Update");
  assert.equal(household.approvalStatus, "Approved");
  for (const field of ["verificationStatus", "approvalStatus", "hhStatus"]) {
    assert.equal(getHouseholdDisplayStatus({ ...household, [field]: "Rejected" }), "Rejected");
  }
  assert.equal(getHouseholdDisplayStatus({ verificationStatus: " verified ", approvalStatus: "APPROVED" }), "Approved");
});

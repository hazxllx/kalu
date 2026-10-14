import assert from "node:assert/strict";
import test from "node:test";

import {
  canPrintOfficialMedicalCertificate,
  canReviewMedicalCertificate,
  isMedicalCertificateReviewer,
} from "../../src/features/certificates/lib/certificatePermissions.js";

for (const role of ["mho", "phn"]) {
  test(`${role} can review pending and approved certificates`, () => {
    const user = { role };
    assert.equal(isMedicalCertificateReviewer(user), true);
    assert.equal(canReviewMedicalCertificate(user, { status: "For Review" }), true);
    assert.equal(canReviewMedicalCertificate(user, { status: "Approved" }), true);
  });

  test(`${role} can print only an issued official certificate`, () => {
    const user = { role };
    assert.equal(canPrintOfficialMedicalCertificate(user, { status: "Issued" }), true);
    assert.equal(canPrintOfficialMedicalCertificate(user, { status: "Draft" }), false);
    assert.equal(canPrintOfficialMedicalCertificate(user, { status: "For Review" }), false);
    assert.equal(canPrintOfficialMedicalCertificate(user, { status: "Approved" }), false);
  });
}

for (const role of ["admin", "health_supervisor", "rhu_personnel", "bhw", "resident", "resident-limited"]) {
  test(`${role} cannot review, approve, or print a medical certificate`, () => {
    const user = { role };
    assert.equal(isMedicalCertificateReviewer(user), false);
    assert.equal(canReviewMedicalCertificate(user, { status: "For Review" }), false);
    assert.equal(canPrintOfficialMedicalCertificate(user, { status: "Issued" }), false);
  });
}

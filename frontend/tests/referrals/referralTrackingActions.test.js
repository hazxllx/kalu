import assert from "node:assert/strict";
import test from "node:test";

import { shouldShowReferralDownloadAction } from "../../src/features/referrals/lib/referralTrackingActions.js";

test("the MHO Referral Tracking page does not offer the referral PDF download action", () => {
  assert.equal(shouldShowReferralDownloadAction({ role: "mho" }), false);
});

test("the referral download action remains available to other non-resident tracking roles", () => {
  for (const role of ["health_supervisor", "phn", "rhu_personnel"]) {
    assert.equal(shouldShowReferralDownloadAction({ role }), true);
  }
});

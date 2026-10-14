import assert from "node:assert/strict";
import test from "node:test";

import { followUpDisplayStatus, isCalendarVisibleFollowUp, manilaDateKey } from "../src/features/follow-ups/lib/scheduleDates.js";

test("follow-up date helpers use the Philippine calendar day across UTC midnight", () => {
  const now = new Date("2026-01-01T16:00:00.000Z");

  assert.equal(manilaDateKey(now), "2026-01-02");
  assert.equal(followUpDisplayStatus("Scheduled", "2026-01-02", now), "Today");
});

test("resident calendar waits for a required confirmation before showing a follow-up", () => {
  assert.equal(isCalendarVisibleFollowUp({
    requiresResidentResponse: true,
    confirmationStatus: "Awaiting Confirmation",
  }), false);
  assert.equal(isCalendarVisibleFollowUp({
    requiresResidentResponse: true,
    confirmationStatus: "Confirmed",
  }), true);
  assert.equal(isCalendarVisibleFollowUp({
    requiresResidentResponse: false,
    confirmationStatus: null,
  }), true);
});

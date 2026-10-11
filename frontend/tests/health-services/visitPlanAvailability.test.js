// Resident Health Services availability rendering tests.
//
// These assert that the pure `availabilityLine` helper — the single source the
// ServiceCard uses to decide between a "Register" button and the disabled
// "Registration Closed" button — renders the BACKEND's authoritative
// availability result. This is the frontend half of the one-time-service
// "Registration Closed" fix: a service the backend reports open must render as
// open, and a closed one must surface the backend's reason.
//
// UI-free (there is no React renderer in the repo) and run with the project's
// node test runner:  node --test tests/health-services/visitPlanAvailability.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { availabilityLine, CLOSED_REASON_TEXT } from "../../src/features/health-services/lib/visitPlanFormat.js";

test("open backend availability renders as open (one-time service, no recurring weekdays)", () => {
  const line = availabilityLine({ weekdays: [], availability: { open: true, reason: null } });
  assert.equal(line.open, true);
  assert.equal(line.text, "Open for registration.");
});

test("open recurring service shows its weekday summary", () => {
  const line = availabilityLine({
    weekdays: [1, 3],
    windowStart: "08:00",
    windowEnd: "11:00",
    availability: { open: true, reason: null },
  });
  assert.equal(line.open, true);
  assert.match(line.text, /Mon, Wed/);
});

test("each closed reason maps to its human copy and keeps open=false", () => {
  for (const reason of Object.keys(CLOSED_REASON_TEXT)) {
    const line = availabilityLine({ weekdays: [], availability: { open: false, reason } });
    assert.equal(line.open, false, `reason ${reason} should be closed`);
    assert.equal(line.reason, reason);
    assert.equal(line.text, CLOSED_REASON_TEXT[reason]);
  }
});

test("an unknown closed reason falls back to neutral copy, never a raw code", () => {
  const line = availabilityLine({ weekdays: [], availability: { open: false, reason: "something_new" } });
  assert.equal(line.open, false);
  assert.equal(line.text, "Registration is closed.");
});

test("legacy fallback (no availability object) still derives from recurring weekdays", () => {
  const open = availabilityLine({ weekdays: [1], windowStart: "08:00", windowEnd: "11:00", hasUpcoming: true });
  assert.equal(open.open, true);
  const closed = availabilityLine({ weekdays: [], hasUpcoming: false });
  assert.equal(closed.open, false);
});

test("the frontend agrees with the backend: a dated service the backend opens is NOT shown closed", () => {
  // Simulates the exact bug: a one-time service with no recurring weekday rows.
  // Before the fix the weekday-derived path forced open=false here.
  const backendServiceView = {
    weekdays: [],
    schedule: { startDate: "2026-01-08", startTime: "09:00", endDate: "2026-01-08", endTime: "12:00" },
    hasUpcoming: true,
    availability: { open: true, reason: null },
  };
  assert.equal(availabilityLine(backendServiceView).open, true);
});

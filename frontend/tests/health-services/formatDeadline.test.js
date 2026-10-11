// Regression test for the Health Services registration-deadline display fix.
//
// A midnight (00:00) or date-only deadline must render as the DATE ALONE —
// never "12:00 AM" — because the backend treats such a deadline as inclusive of
// the whole day (registration stays open through that date). A deadline with a
// real time of day still shows that time. This keeps the resident-facing
// "Register by <date>" consistent with the backend availability window
// (visitPlans.service deadlineKeyOf).
//
// Run: node --test tests/health-services/formatDeadline.test.js

import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDeadline,
  formatPlanDate,
  formatTime,
} from "../../src/features/health-services/lib/visitPlanFormat.js";

const DATE = "2026-10-15";

test("a midnight deadline renders as the date alone (whole-day inclusive)", () => {
  assert.equal(formatDeadline(`${DATE}T00:00`), formatPlanDate(DATE));
  assert.equal(formatDeadline(`${DATE}T00:00:00`), formatPlanDate(DATE));
});

test("a date-only deadline renders as the date alone", () => {
  assert.equal(formatDeadline(DATE), formatPlanDate(DATE));
});

test("a deadline with a real time of day shows that time", () => {
  const out = formatDeadline(`${DATE}T09:00`);
  assert.equal(out, `${formatPlanDate(DATE)}, ${formatTime("09:00")}`);
  assert.ok(out.includes("9:00 AM"));
});

test("a deadline time is parsed from a full timestamp (seconds ignored)", () => {
  assert.equal(formatDeadline(`${DATE}T13:30:00`), `${formatPlanDate(DATE)}, ${formatTime("13:30")}`);
});

test("empty / malformed input yields an empty string", () => {
  assert.equal(formatDeadline(""), "");
  assert.equal(formatDeadline(null), "");
  assert.equal(formatDeadline("not-a-date"), "");
});

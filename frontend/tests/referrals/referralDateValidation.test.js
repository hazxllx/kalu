import assert from "node:assert/strict";
import test from "node:test";

import {
  localDateKey,
  localDateTimeToIso,
  referralDateErrors,
  referralDateTimeMinimum,
  toLocalDateTimeInput,
} from "../../src/features/referrals/lib/referralDateValidation.js";

test("referral dates use the local calendar day and reject future referral dates", () => {
  const now = new Date(2026, 9, 15, 12, 0);
  const today = localDateKey(now);

  assert.deepEqual(referralDateErrors({ referralDate: "2026-10-14", scheduledAt: "" }, { now }), {});
  assert.deepEqual(referralDateErrors({ referralDate: today, scheduledAt: "" }, { now }), {});
  assert.equal(
    referralDateErrors({ referralDate: "2026-10-16", scheduledAt: "" }, { now }).referralDate,
    "Referral date cannot be later than today.",
  );
});

test("scheduled referral time rejects yesterday, past and current time today", () => {
  const now = new Date(2026, 9, 15, 12, 30);

  for (const scheduledAt of ["2026-10-14T12:31", "2026-10-15T12:29", "2026-10-15T12:30"]) {
    assert.equal(
      referralDateErrors({ referralDate: "2026-10-15", scheduledAt }, { now }).scheduledAt,
      "Scheduled date and time cannot be in the past.",
    );
  }
});

test("future time today and a future date are valid", () => {
  const now = new Date(2026, 9, 15, 12, 30);

  assert.deepEqual(referralDateErrors({
    referralDate: "2026-10-15",
    scheduledAt: "2026-10-15T12:31",
  }, { now }), {});
  assert.deepEqual(referralDateErrors({
    referralDate: "2026-10-15",
    scheduledAt: "2026-10-16T09:00",
  }, { now }), {});
});

test("unchanged historical schedules remain editable but changed past schedules do not", () => {
  const now = new Date(2026, 9, 15, 12, 30);
  const originalScheduledAt = "2026-10-14T12:00";

  assert.deepEqual(referralDateErrors(
    { referralDate: "2026-10-14", scheduledAt: originalScheduledAt },
    { now, originalScheduledAt },
  ), {});
  assert.equal(referralDateErrors(
    { referralDate: "2026-10-14", scheduledAt: "2026-10-14T12:01" },
    { now, originalScheduledAt },
  ).scheduledAt, "Scheduled date and time cannot be in the past.");
});

test("local schedule values convert to timezone-aware API timestamps and edit values", () => {
  const value = "2026-10-15T12:31";
  const serialized = localDateTimeToIso(value);
  assert(serialized.endsWith("Z"));
  assert.equal(toLocalDateTimeInput(serialized), value);
  assert.equal(referralDateTimeMinimum(new Date(2026, 9, 15, 12, 30, 59)), "2026-10-15T12:31");
});

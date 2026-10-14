import assert from "node:assert/strict";
import test from "node:test";

import {
  filterFollowUps,
  followUpDisplayStatus,
  followUpManagementStatus,
  isCalendarVisibleFollowUp,
  manilaDateKey,
  summarizeFollowUps,
} from "../src/features/follow-ups/lib/scheduleDates.js";

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

test("management statuses use the scheduled date and preserve terminal statuses", () => {
  const now = new Date("2026-10-14T16:00:00.000Z");
  assert.equal(followUpManagementStatus("Scheduled", "2026-10-15", now), "Today");
  assert.equal(followUpManagementStatus("Today", "2026-10-17", now), "Upcoming");
  assert.equal(followUpManagementStatus("Upcoming", "2026-10-14", now), "Scheduled");
  assert.equal(followUpManagementStatus("Missed", "2026-10-17", now), "Missed");
  assert.equal(followUpManagementStatus("Cancelled", "2026-10-17", now), "Cancelled");
  assert.equal(followUpManagementStatus("Cancelled", "2026-10-17", now, "rejected"), "Rejected");
});

test("follow-up summary counts records by Manila date and upcoming week", () => {
  const rows = [
    { status: "Today", scheduledDateRaw: "2026-10-15" },
    { status: "Today", scheduledDateRaw: "2026-10-16" },
    { status: "Upcoming", scheduledDateRaw: "2026-10-22" },
    { status: "Upcoming", scheduledDateRaw: "2026-10-23" },
    { status: "Completed", scheduledDateRaw: "2026-10-15" },
    { status: "Missed", scheduledDateRaw: "2026-10-15" },
  ];

  assert.deepEqual(summarizeFollowUps(rows, new Date("2026-10-14T16:00:00.000Z")), {
    total: 6,
    today: 1,
    upcoming: 2,
    completed: 1,
  });
  assert.deepEqual(summarizeFollowUps([], new Date("2026-10-14T16:00:00.000Z")), {
    total: 0,
    today: 0,
    upcoming: 0,
    completed: 0,
  });
});

test("follow-up filters support requested statuses, priority, and resident/purpose search", () => {
  const rows = [
    { resident: "Ava Santos", purpose: "Prenatal check", status: "Today", priority: "High" },
    { resident: "Ben Cruz", purpose: "Medication review", status: "Upcoming", priority: "Medium" },
    { resident: "Cara Lim", purpose: "Blood pressure", status: "Completed", priority: "Low" },
    { resident: "Dan Reyes", purpose: "Home visit", status: "Missed", priority: "High" },
    { resident: "Eva Cruz", purpose: "Check-up", status: "Scheduled", priority: "Medium" },
    { resident: "Finn Cruz", purpose: "Check-up", status: "Ongoing", priority: "Low" },
    { resident: "Gia Cruz", purpose: "Check-up", status: "Cancelled", priority: "Low" },
    { resident: "Han Cruz", purpose: "Check-up", status: "Rejected", priority: "High" },
  ];
  assert.equal(filterFollowUps(rows).length, 8);
  assert.equal(filterFollowUps(rows, { status: "All" }).length, 8);
  assert.deepEqual(filterFollowUps([], { status: "Missed" }), []);
  for (const status of ["Today", "Upcoming", "Scheduled", "Ongoing", "Completed", "Missed", "Cancelled", "Rejected"]) {
    assert.deepEqual(filterFollowUps(rows, { status }).map((row) => row.status), [status]);
  }
  assert.deepEqual(filterFollowUps(rows, { search: "medication", priority: "Medium" }), [rows[1]]);
});

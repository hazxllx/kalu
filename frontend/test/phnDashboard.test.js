import test from "node:test";
import assert from "node:assert/strict";

import {
  countFollowUpsDue,
  countHighRisk,
  countPendingReferrals,
  followUpDisplayStatus,
  followUpIsDueToday,
  followUpIsOverdue,
  formatManilaLongDate,
  isHighRiskResident,
  isPendingReferral,
  manilaDateKey,
  mapFollowUpRow,
  mapReferralRow,
  personName,
  queueCounts,
  sortQueueByRisk,
} from "../src/lib/phnDashboard.js";
import { CHECKUP_STATUS } from "../src/lib/phnWorkflowMap.js";

// These lock the PHN dashboard's data derivation so the indicators can never
// silently fall back to a permanent zero or use the wrong status vocabulary:
//   - "today" is the Philippine calendar day (Asia/Manila), matching the
//     backend's follow-up due logic;
//   - a follow-up is due only while it is still open;
//   - a referral is pending only for the real open statuses;
//   - high-risk comes from the authoritative risk level attached server-side.

test("formatManilaLongDate renders the Philippine weekday-prefixed date", () => {
  // 2026-10-06T04:00:00Z is 12:00 on 6 October 2026 in Asia/Manila.
  assert.equal(formatManilaLongDate(new Date("2026-10-06T04:00:00Z")), "Tuesday, October 6, 2026");
});

test("manilaDateKey rolls a late-UTC instant onto the next Philippine day", () => {
  assert.equal(manilaDateKey(new Date("2026-10-05T20:00:00Z")), "2026-10-06");
  assert.equal(manilaDateKey(new Date("2026-10-05T04:00:00Z")), "2026-10-05");
});

test("follow-up due/overdue uses the Philippine day and excludes closed statuses", () => {
  const today = "2026-10-06";
  assert.equal(followUpIsOverdue({ status: "Scheduled", scheduled_date: "2026-10-01" }, today), true);
  assert.equal(followUpIsDueToday({ status: "Scheduled", scheduled_date: "2026-10-06" }, today), true);
  assert.equal(followUpIsOverdue({ status: "Scheduled", scheduled_date: "2026-10-07" }, today), false);
  // A closed follow-up never needs attention even if its date has passed.
  assert.equal(followUpIsOverdue({ status: "Completed", scheduled_date: "2026-10-01" }, today), false);
  assert.equal(followUpIsOverdue({ status: "Missed", scheduled_date: "2026-10-01" }, today), false);
  // The backend-derived flags are honoured when present.
  assert.equal(followUpIsOverdue({ status: "Upcoming", is_overdue: true }, today), true);
  assert.equal(followUpIsDueToday({ status: "Pending", is_due_today: true }, today), true);
});

test("followUpDisplayStatus derives Overdue/Today without a stored status", () => {
  const today = "2026-10-06";
  assert.equal(followUpDisplayStatus({ status: "Scheduled", scheduled_date: "2026-10-01" }, today), "Overdue");
  assert.equal(followUpDisplayStatus({ status: "Scheduled", scheduled_date: "2026-10-06" }, today), "Today");
  assert.equal(followUpDisplayStatus({ status: "Upcoming", scheduled_date: "2026-10-20" }, today), "Upcoming");
  assert.equal(followUpDisplayStatus({ status: "Completed", scheduled_date: "2026-10-01" }, today), "Completed");
});

test("countFollowUpsDue counts only open due/overdue follow-ups", () => {
  const rows = [
    { status: "Scheduled", scheduled_date: "2026-10-01" }, // overdue
    { status: "Scheduled", scheduled_date: "2026-10-06" }, // today
    { status: "Upcoming", scheduled_date: "2026-10-20" }, // future
    { status: "Completed", scheduled_date: "2026-10-01" }, // closed
    { status: "Cancelled", scheduled_date: "2026-10-01" }, // closed
    { status: "Missed", scheduled_date: "2026-10-01" }, // closed
  ];
  assert.equal(countFollowUpsDue(rows, "2026-10-06"), 2);
  // A failed/empty dataset is a genuine zero, not an error.
  assert.equal(countFollowUpsDue([], "2026-10-06"), 0);
  assert.equal(countFollowUpsDue(undefined, "2026-10-06"), 0);
});

test("isPendingReferral / countPendingReferrals follow the real open statuses", () => {
  const rows = [
    { status: "Pending" },
    { status: "Accepted" },
    { status: "In Progress" },
    { status: "Completed" },
    { status: "Cancelled" },
  ];
  assert.equal(isPendingReferral(rows[0]), true);
  assert.equal(isPendingReferral(rows[3]), false);
  // The old dashboard used `status !== "Completed"`, which wrongly counted
  // Cancelled referrals as pending.
  assert.equal(countPendingReferrals(rows), 3);
});

test("high-risk uses the authoritative risk level only", () => {
  assert.equal(isHighRiskResident({ riskLevel: "High" }), true);
  assert.equal(isHighRiskResident({ risk_level: "High" }), true);
  assert.equal(isHighRiskResident({ riskLevel: "Moderate" }), false);
  assert.equal(isHighRiskResident({ riskLevel: "Low" }), false);
  assert.equal(isHighRiskResident({}), false);
  assert.equal(countHighRisk([{ riskLevel: "High" }, { riskLevel: "High" }, { riskLevel: "Low" }]), 2);
});

test("queueCounts reports waiting, in check-up and completed today", () => {
  const today = "2026-10-06";
  const patients = [
    { status: CHECKUP_STATUS.WAITING },
    { status: CHECKUP_STATUS.WAITING },
    { status: CHECKUP_STATUS.IN_CHECKUP },
    { status: CHECKUP_STATUS.COMPLETED, checkup: { completedAt: "2026-10-06T02:00:00Z" } },
    { status: CHECKUP_STATUS.COMPLETED, checkup: { completedAt: "2026-10-05T02:00:00Z" } },
    { status: CHECKUP_STATUS.COMPLETED, checkup: {} },
  ];
  assert.deepEqual(queueCounts(patients, today), { waiting: 2, inCheckup: 1, completedToday: 1 });
});

test("personName handles snake_case embeds, camelCase rows and fallbacks", () => {
  assert.equal(personName({ first_name: "Juan", middle_name: "D", last_name: "Dela Cruz" }), "Juan D Dela Cruz");
  assert.equal(personName({ firstName: "Ana", lastName: "Reyes" }), "Ana Reyes");
  assert.equal(personName({ name: "Walk-in Patient" }), "Walk-in Patient");
  assert.equal(personName({}), "Unnamed patient");
});

test("mapFollowUpRow / mapReferralRow normalise persisted rows for display", () => {
  const followUp = mapFollowUpRow({
    id: "F1",
    status: "Scheduled",
    scheduled_date: "2026-10-01",
    scheduled_time: "09:30:00",
    purpose: "BP follow-up",
    resident: { first_name: "Juan", last_name: "Dela Cruz", barangay: "San Isidro" },
  });
  assert.equal(followUp.residentName, "Juan Dela Cruz");
  assert.equal(followUp.status, "Overdue");
  assert.equal(followUp.scheduledTime, "09:30");
  assert.equal(followUp.isOverdue, true);

  const referral = mapReferralRow({
    id: "R1",
    status: "Pending",
    priority: "High",
    reason: "TB screening",
    destination_facility: "Bicol Medical Center",
    resident: { first_name: "Ana", last_name: "Reyes", barangay: "San Jose" },
  });
  assert.equal(referral.residentName, "Ana Reyes");
  assert.equal(referral.destinationFacility, "Bicol Medical Center");
  assert.equal(referral.status, "Pending");
});

test("sortQueueByRisk puts highest risk first without reordering ties", () => {
  const rows = [
    { id: "a", checkup: { riskLevel: "Low" } },
    { id: "b", checkup: { riskLevel: "High" } },
    { id: "c" }, // unknown -> treated as lowest
    { id: "d", checkup: { riskLevel: "Medium" } },
  ];
  assert.deepEqual(sortQueueByRisk(rows).map((r) => r.id), ["b", "d", "a", "c"]);
});

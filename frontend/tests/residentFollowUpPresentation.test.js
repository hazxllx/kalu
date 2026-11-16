import assert from "node:assert/strict";
import test from "node:test";

import {
  getResidentFollowUpPresentation,
  summarizeResidentFollowUps,
} from "../src/features/follow-ups/lib/residentFollowUpPresentation.js";
import {
  latestConsultation,
  latestRecordedVitals,
  pulseReadings,
  visitTrend,
} from "../src/features/dashboards/lib/residentHealthSnapshot.js";

const now = new Date("2026-11-17T02:00:00.000Z");

test("overdue confirmation and attendance remain distinct in one primary status", () => {
  const overdueConfirmed = getResidentFollowUpPresentation({
    status: "Scheduled",
    scheduledDate: "2026-11-15",
    confirmationStatus: "Confirmed",
  }, now);
  assert.equal(overdueConfirmed.statusLabel, "Overdue");
  assert.equal(overdueConfirmed.statusDetail, "Confirmed · attendance not recorded");
  assert.equal(overdueConfirmed.category, "actionRequired");
  assert.equal(overdueConfirmed.actionable, false);

  const awaiting = getResidentFollowUpPresentation({
    status: "Pending",
    scheduledDate: "2026-11-19",
    confirmationStatus: "Awaiting Confirmation",
  }, now);
  assert.equal(awaiting.statusLabel, "Awaiting Response");
  assert.equal(awaiting.actionable, true);

  const completed = getResidentFollowUpPresentation({
    status: "Completed",
    scheduledDate: "2026-11-15",
    requiresResidentResponse: true,
  }, now);
  assert.equal(completed.statusLabel, "Completed");
  assert.equal(completed.awaitingResponse, false);
  assert.equal(completed.actionable, false);
});

test("follow-up categories are mutually exclusive and preserve terminal outcomes", () => {
  const rows = [
    { status: "Pending", scheduledDate: "2026-11-19", confirmationStatus: "Awaiting Confirmation" },
    { status: "Scheduled", scheduledDate: "2026-11-20", confirmationStatus: "Confirmed" },
    { status: "Completed", scheduledDate: "2026-11-10" },
    { status: "Cancelled", scheduledDate: "2026-11-20", confirmationStatus: "Rejected" },
    { status: "Scheduled", scheduledDate: "2026-11-15", confirmationStatus: "Confirmed" },
  ];

  assert.deepEqual(summarizeResidentFollowUps(rows, now), {
    actionRequired: 2,
    upcoming: 1,
    completed: 1,
    cancelled: 1,
  });
  assert.equal(getResidentFollowUpPresentation(rows[3], now).statusLabel, "Rejected");
});

test("pulse readings use all valid values in chronological order and latest visit is date-based", () => {
  const consultations = [
    { date: "2026-11-14", vitals: { pulseRate: "88" } },
    { date: "2026-11-10", vitals: { pulseRate: 72 } },
    { date: "2026-11-12", vitals: { pulseRate: "" } },
    { date: "2026-11-17", vitals: { pulseRate: 91 } },
  ];

  assert.deepEqual(pulseReadings(consultations), [
    { date: "2026-11-10", value: 72 },
    { date: "2026-11-14", value: 88 },
    { date: "2026-11-17", value: 91 },
  ]);
  assert.equal(latestConsultation(consultations).date, "2026-11-17");
  assert.deepEqual(latestRecordedVitals([
    { date: "2026-11-17", vitals: { pulseRate: 91, bmi: "", bloodPressure: "" } },
    { date: "2026-11-14", vitals: { pulseRate: 88, bmi: "22.4", bloodPressure: "120/80" } },
  ]), {
    bloodPressure: { value: "120/80", date: "2026-11-14" },
    pulseRate: { value: 91, date: "2026-11-17" },
    bmi: { value: 22.4, date: "2026-11-14" },
  });
});

test("activity trend distinguishes consultations, completed, upcoming, and overdue follow-ups", () => {
  const weeks = visitTrend(
    [{ date: "2026-11-16" }, { date: "2026-09-01" }],
    [
      { scheduledDate: "2026-11-16", status: "Completed" },
      { scheduledDate: "2026-11-19", status: "Pending" },
      { scheduledDate: "2026-11-20", status: "Scheduled" },
      { scheduledDate: "2026-11-14", status: "Scheduled" },
      { scheduledDate: "2026-11-20", status: "Cancelled" },
    ],
    now,
  );

  assert.equal(weeks[3].consultations, 1);
  assert.equal(weeks[3].completedFollowUps, 1);
  assert.equal(weeks[3].upcoming, 2);
  assert.equal(weeks[2].overdue, 1);
  assert.equal(weeks.reduce((sum, week) => sum + week.consultations, 0), 1);
  assert.equal(weeks.reduce((sum, week) => sum + week.completedFollowUps, 0), 1);
});

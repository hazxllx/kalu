import assert from "node:assert/strict";
import test from "node:test";
import { followUpActionAvailability } from "../src/features/follow-ups/lib/followUpActions.js";
import {
  buildDayMap,
  buildMonthGrid,
  calendarEventKey,
  calendarVisibleRange,
  formatCalendarStatus,
  isCalendarEventInBarangay,
  mapFollowUpEvent,
  mapHealthServiceEvent,
  monthRange,
  parseCalendarDate,
  readCalendarRows,
  stepCalendarDate,
  toDateKey,
} from "../src/features/dashboards/components/scheduleCalendarUtils.js";

test("date links accept genuine date-only values without UTC or overflow parsing", () => {
  assert.equal(toDateKey(parseCalendarDate("2026-11-07")), "2026-11-07");
  assert.equal(toDateKey(parseCalendarDate("2024-02-29")), "2024-02-29");
  for (const value of [null, "", "2026-02-29", "2026-02-30", "2026-13-01", "2026-11-00", "2026-1-1", "2026-11-07T00:00:00Z"]) {
    assert.equal(parseCalendarDate(value), null);
  }
  assert.equal(toDateKey(new Date("invalid")), "");
});

test("month fetching covers all 42 visible dates, not just the named month", () => {
  const date = parseCalendarDate("2026-05-31");
  const days = buildMonthGrid(date).flat();
  assert.equal(days.length, 42);
  assert.equal(new Set(days.map(toDateKey)).size, 42);
  assert.deepEqual(monthRange(date), { from: "2026-05-01", to: "2026-05-31" });
  assert.deepEqual(calendarVisibleRange(date, "month"), { from: "2026-04-26", to: "2026-06-06" });
  assert.deepEqual(calendarVisibleRange(parseCalendarDate("2024-02-29"), "month"), { from: "2024-01-28", to: "2024-03-09" });
});

test("month and agenda navigation clamp last days without skipping February", () => {
  const january = parseCalendarDate("2026-01-31");
  for (const view of ["month", "agenda"]) {
    assert.equal(toDateKey(stepCalendarDate(january, view, 1)), "2026-02-28");
    assert.equal(toDateKey(stepCalendarDate(parseCalendarDate("2024-01-31"), view, 1)), "2024-02-29");
    assert.equal(toDateKey(stepCalendarDate(parseCalendarDate("2026-03-31"), view, -1)), "2026-02-28");
    assert.equal(toDateKey(stepCalendarDate(parseCalendarDate("2026-12-31"), view, 1)), "2027-01-31");
  }
  assert.equal(toDateKey(january), "2026-01-31");
});

test("week, day and agenda ranges match their actual visible periods", () => {
  const date = parseCalendarDate("2026-11-30");
  assert.deepEqual(calendarVisibleRange(date, "week"), { from: "2026-11-29", to: "2026-12-05" });
  assert.deepEqual(calendarVisibleRange(date, "day"), { from: "2026-11-30", to: "2026-11-30" });
  assert.deepEqual(calendarVisibleRange(date, "agenda"), { from: "2026-11-01", to: "2026-11-30" });
  assert.equal(toDateKey(stepCalendarDate(date, "week", 1)), "2026-12-07");
  assert.equal(toDateKey(stepCalendarDate(date, "day", 1)), "2026-12-01");
});

test("service attendance uses its real resident string and category, never an invented appointment time or provider", () => {
  const event = mapHealthServiceEvent({
    id: "attendance-1", service_id: "service-1", resident_id: "resident-1",
    scheduled_date: "2026-11-07", attended_at: "2026-11-07T01:30:00Z",
    attendance_status: "attended", notes: "Attendance note", recorded_by_name: "Recorded staff",
    resident: "Test Resident", residentBarangay: "San Isidro",
    service: { id: "service-1", name: "Recorded service", category: "Maternal", facility: "Unsupported legacy facility" },
    location: "Unsupported legacy location", scheduled_time: "09:30",
  });
  assert.equal(event.id, "attendance-1");
  assert.equal(event.residentId, "resident-1");
  assert.equal(event.residentName, "Test Resident");
  assert.equal(event.residentBarangay, "San Isidro");
  assert.equal(event.serviceId, "service-1");
  assert.equal(event.category, "Maternal");
  assert.equal(event.time, "");
  assert.equal(event.provider, "");
  assert.equal(event.location, "");
  assert.equal(event.status, "attended");
  assert.equal(event.detail, "Attendance note");
  assert.equal(event.recordedBy, "Recorded staff");
  assert.equal(event.attendedAt, "2026-11-07T01:30:00Z");
});

test("attendance camelCase status is respected while missing values remain explicitly unrecorded", () => {
  const event = mapHealthServiceEvent({ id: 3, scheduled_date: "2026-11-07", attendanceStatus: "no_show", resident: "Test Resident" });
  assert.equal(event.id, 3);
  assert.equal(event.status, "no_show");
  assert.equal(formatCalendarStatus(event.status), "No Show");
  assert.equal(formatCalendarStatus("scheduled"), formatCalendarStatus("Scheduled"));
  assert.equal(formatCalendarStatus(""), "Not recorded");
  assert.equal(mapHealthServiceEvent({ id: 4 }).status, "");
});

test("follow-up mapping retains actual appointment and resident-confirmation fields", () => {
  const event = mapFollowUpEvent({
    id: "followup-1", resident_id: "resident-1", scheduled_date: "2026-11-07", scheduled_time: "08:15:00",
    purpose: "Recorded follow-up", location: "Recorded location", assigned_provider: "Recorded provider",
    priority: "High", status: "Pending", notes: "Instructions", requires_resident_response: true,
    resident_decision: "rejected", resident_decision_at: "2026-11-06T02:00:00Z", resident_decision_reason: "Recorded reason",
    resident: { first_name: "Test", middle_name: "Middle", last_name: "Resident", barangay: "San Isidro" },
    is_due_today: true, is_overdue: false,
  });
  assert.equal(event.id, "followup-1");
  assert.equal(event.residentId, "resident-1");
  assert.equal(event.residentName, "Test Middle Resident");
  assert.equal(event.residentBarangay, "San Isidro");
  assert.equal(event.time, "08:15");
  assert.equal(event.provider, "Recorded provider");
  assert.equal(event.location, "Recorded location");
  assert.equal(event.instructions, "Instructions");
  assert.equal(event.priority, "High");
  assert.equal(event.confirmationStatus, "Rejected");
  assert.equal(event.rejectionReason, "Recorded reason");
  assert.equal(event.respondedAt, "2026-11-06T02:00:00Z");
  assert.equal(event.isDueToday, true);
  assert.equal(mapFollowUpEvent({ ...event, resident_decision: "approved" }).confirmationStatus, "Confirmed");
  assert.equal(mapFollowUpEvent({ ...event, resident_decision: "pending" }).confirmationStatus, "Awaiting Confirmation");
});

test("persisted device shapes and partial offline edits preserve identity and allow clearing notes", () => {
  const event = mapFollowUpEvent({
    id: "local:followup-1", residentId: "resident-1", residentName: "Test Resident", barangay: "San Isidro",
    date: "2026-11-07", time: "10:00", provider: "Recorded provider", location: "Recorded location",
    purpose: "Recorded follow-up", instructions: "Prior instructions", offline: true, syncStatus: "Pending Sync",
  });
  assert.equal(event.date, "2026-11-07");
  assert.equal(event.residentName, "Test Resident");
  assert.equal(event.residentBarangay, "San Isidro");
  assert.equal(event.provider, "Recorded provider");
  assert.equal(event.time, "10:00");
  assert.equal(event.offline, true);
  assert.equal(event.syncStatus, "Pending Sync");
  const update = mapFollowUpEvent({ ...event, notes: "", scheduled_time: "11:30", offline: true });
  assert.equal(update.instructions, "");
  assert.equal(update.residentName, "Test Resident");
  assert.equal(update.residentId, "resident-1");
  assert.equal(update.time, "11:30");
});

test("refreshed local confirmation drafts retain their actual resident and never become approved", () => {
  const draft = {
    id: "local:pending-1", residentId: "resident-1", residentName: "Test Resident", barangay: "San Isidro",
    date: "2026-11-07", time: "10:00", purpose: "Recorded follow-up", status: "Pending",
    requiresResidentResponse: true, residentDecision: "pending", offline: true, syncStatus: "Pending Sync",
  };
  const refreshed = readCalendarRows([draft], "Device follow-ups").map(mapFollowUpEvent)[0];
  assert.equal(refreshed.id, draft.id);
  assert.equal(refreshed.residentName, draft.residentName);
  assert.equal(refreshed.residentId, draft.residentId);
  assert.equal(refreshed.status, "Pending");
  assert.equal(refreshed.requiresResidentResponse, true);
  assert.equal(refreshed.residentDecision, "pending");
  assert.equal(refreshed.confirmationStatus, "Awaiting Confirmation");
  assert.equal(refreshed.offline, true);
  assert.equal(refreshed.syncStatus, "Pending Sync");
  const actions = followUpActionAvailability(refreshed, { canEdit: true, canComplete: true, today: "2026-11-07" });
  assert.equal(actions.complete, false);
  assert.equal(actions.missed, false);
});

test("cached server decisions survive merged device edits without inventing confirmation", () => {
  const cached = {
    id: "followup-1", resident_id: "resident-1", scheduled_date: "2026-11-07", scheduled_time: "10:00:00",
    requires_resident_response: true,
    resident: { first_name: "Test", last_name: "Resident", barangay: "San Isidro" },
  };
  for (const [decision, status, confirmation] of [
    ["pending", "Pending", "Awaiting Confirmation"],
    ["approved", "Scheduled", "Confirmed"],
    ["rejected", "Cancelled", "Rejected"],
  ]) {
    const event = mapFollowUpEvent({ ...cached, resident_decision: decision, status,
      scheduled_date: "2026-11-08", notes: "Edited instructions", offline: true, syncStatus: "Pending Sync" });
    assert.equal(event.residentName, "Test Resident");
    assert.equal(event.residentDecision, decision);
    assert.equal(event.confirmationStatus, confirmation);
    assert.equal(event.date, "2026-11-08");
    assert.equal(event.instructions, "Edited instructions");
  }
  const optional = mapFollowUpEvent({ ...cached, requires_resident_response: false, resident_decision: "", status: "Scheduled" });
  assert.equal(optional.confirmationStatus, null);
  assert.equal(optional.residentDecision, "");
});

test("mixed-source IDs remain unchanged and their keys cannot collide", () => {
  const followUp = mapFollowUpEvent({ id: "same-id", scheduled_date: "2026-11-07" });
  const service = mapHealthServiceEvent({ id: "same-id", scheduled_date: "2026-11-07" });
  assert.equal(followUp.id, service.id);
  assert.equal(calendarEventKey(followUp), "follow-up-same-id");
  assert.equal(calendarEventKey(service), "health-service-same-id");
  assert.notEqual(calendarEventKey(followUp), calendarEventKey(service));
  assert.equal(buildDayMap([followUp, service])["2026-11-07"].length, 2);
});

test("day maps order specified times first, including 23:59, then category and stable IDs", () => {
  const rows = [
    { id: "service-z", type: "health-service", category: "Z", date: "2026-11-07", time: "" },
    { id: "late", type: "follow-up", date: "2026-11-07", time: "23:59" },
    { id: "early", type: "follow-up", date: "2026-11-07", time: "08:15" },
    { id: "service-a", type: "health-service", category: "A", date: "2026-11-07", time: "" },
    { id: "invalid", date: "2026-02-30", time: "08:00" },
    { id: "unscheduled", date: "", time: "08:00" },
  ];
  const byDay = buildDayMap(rows);
  assert.deepEqual(byDay["2026-11-07"].map((event) => event.id), ["early", "late", "service-a", "service-z"]);
  assert.deepEqual(Object.keys(byDay), ["2026-11-07"]);
  assert.equal(rows[0].id, "service-z");
});

test("supervisor events exclude outside and unknown resident geography even for visible services", () => {
  const rows = [
    mapHealthServiceEvent({ id: "inside", residentBarangay: "San Isidro", service: { category: "Maternal" } }),
    mapHealthServiceEvent({ id: "outside", residentBarangay: "Other Barangay", service: { category: "Maternal" } }),
    mapHealthServiceEvent({ id: "unknown", service: { category: "Maternal", barangay: "San Isidro" } }),
    mapFollowUpEvent({ id: "followup", resident: { barangay: "San Isidro" } }),
  ];
  assert.deepEqual(rows.filter((event) => isCalendarEventInBarangay(event, "San Isidro")).map((event) => event.id), ["inside", "followup"]);
  assert.equal(isCalendarEventInBarangay(rows[0], null), false);
  assert.equal(isCalendarEventInBarangay(rows[0], ""), false);
  assert.equal(isCalendarEventInBarangay({ residentBarangay: " san isidro " }, "San Isidro"), true);
});

test("malformed source responses and unstable records throw instead of appearing empty", () => {
  assert.deepEqual(readCalendarRows({ rows: [] }, "Attendance"), []);
  assert.deepEqual(readCalendarRows([], "Device follow-ups"), []);
  const rows = [{ id: 0, scheduled_date: "2026-11-07" }];
  assert.equal(readCalendarRows({ rows }), rows);
  for (const response of [null, {}, { rows: null }, { rows: "bad" }, { rows: {} }]) {
    assert.throws(() => readCalendarRows(response, "Attendance"), /Attendance returned an invalid record list/);
  }
  for (const row of [null, [], {}, { id: "" }, { id: " " }, { id: Infinity }, { id: {} }]) {
    assert.throws(() => readCalendarRows([row], "Follow-ups"), /valid ID/);
  }
  assert.throws(() => readCalendarRows([{ id: "bad-date", scheduled_date: "2026-02-30" }]), /invalid schedule date/);
  assert.throws(() => readCalendarRows([{ id: "bad-date", scheduled_date: 0 }]), /invalid schedule date/);
});

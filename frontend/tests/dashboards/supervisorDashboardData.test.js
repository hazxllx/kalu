import assert from "node:assert/strict";
import test from "node:test";
import {
  requireDashboardRows,
  residentDisplayName,
  recordsForBarangay,
  isOpenFollowUp,
  isOverdueFollowUp,
  buildMonitoringPriorities,
  matchesMonitoringFilter,
  upcomingActivities,
  requireSupervisorMap,
  riskDistributionRows,
} from "../../src/features/dashboards/components/supervisorDashboardData.js";

const barangay = "San Antonio";
const today = "2026-11-07";
const resident = (id) => ({ id, firstName: "Same", lastName: "Name", barangay, riskLevel: "High", riskAssessedAt: "2026-11-05" });
const joinedResident = { id: "resident-1", first_name: "Same", last_name: "Name", name: "Same Name", barangay };
const followUp = (id, date = "2026-11-06", status = "Scheduled") => ({ id, resident_id: "resident-1", resident: joinedResident, scheduled_date: date, status, purpose: "Recorded follow-up" });
const referral = (id, status = "Pending") => ({ id, resident_id: "resident-1", resident: joinedResident, status, priority: "Medium", referral_date: "2026-11-05", reason: "Recorded referral" });

test("valid empty lists are distinct from malformed or missing source data", () => {
  assert.deepEqual(requireDashboardRows({ rows: [] }, "referrals"), []);
  assert.deepEqual(requireDashboardRows([{ id: "record-1" }], "referrals"), [{ id: "record-1" }]);
  for (const invalid of [null, {}, { rows: null }, { rows: [{ status: "Pending" }] }]) {
    assert.throws(() => requireDashboardRows(invalid, "referrals"), /incomplete record list/);
  }
});

test("resident labels use the actual source shape, including attendance strings", () => {
  assert.equal(residentDisplayName(resident("resident-1")), "Same Name");
  assert.equal(residentDisplayName({ first_name: "Same", last_name: "Name" }), "Same Name");
  assert.equal(residentDisplayName("Recorded resident"), "Recorded resident");
  assert.equal(residentDisplayName(null), "Resident name unavailable");
});

test("barangay filtering never substitutes service visibility for resident geography", () => {
  const rows = [
    { id: "assigned", resident: { barangay } },
    { id: "attendance", residentBarangay: barangay },
    { id: "other", residentBarangay: "San Isidro", service: { barangay } },
    { id: "unknown", service: { barangay } },
  ];
  assert.deepEqual(recordsForBarangay(rows, barangay).map((row) => row.id), ["assigned", "attendance"]);
  assert.deepEqual(recordsForBarangay(rows, null), []);
});

test("only open stored follow-up states enter current operational queues", () => {
  for (const status of ["Scheduled", "Pending", "Today", "Upcoming", "Ongoing"]) assert.equal(isOpenFollowUp({ status }), true);
  for (const status of ["Completed", "Cancelled", "Missed", "Rejected", "", "Unknown"]) assert.equal(isOpenFollowUp({ status }), false);
  assert.equal(isOpenFollowUp({ status: "Scheduled", resident_decision: "rejected" }), false);
});

test("today is not overdue and server scheduling flags remain authoritative", () => {
  assert.equal(isOverdueFollowUp(followUp("before"), today), true);
  assert.equal(isOverdueFollowUp(followUp("today", today), today), false);
  assert.equal(isOverdueFollowUp(followUp("future", "2026-11-08"), today), false);
  assert.equal(isOverdueFollowUp({ ...followUp("server"), is_overdue: false }, today), false);
  assert.equal(isOverdueFollowUp({ ...followUp("completed", "2026-11-06", "Completed"), is_overdue: true }, today), false);
});

test("namesakes remain separate high-risk residents with canonical record links", () => {
  const rows = buildMonitoringPriorities({ residents: [resident("resident-1"), resident("resident-2")], barangay, today });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.key), ["resident-resident-1", "resident-resident-2"]);
  assert.equal(rows[0].href, "/app/health_supervisor/residents?residentId=resident-1");
  assert.equal(rows[1].href, "/app/health_supervisor/residents?residentId=resident-2");
});

test("mixed sources with the same ID never overwrite one another", () => {
  const rows = buildMonitoringPriorities({
    residents: [resident("same-id")],
    referrals: [referral("same-id")],
    followUps: [followUp("same-id")],
    consultations: [{ id: "same-id", resident: joinedResident, status: "submitted", consultationDate: "2026-11-05" }],
    barangay, today,
  });
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map((row) => row.key)).size, 4);
  assert.ok(rows.some((row) => row.href.endsWith("referrals?referral=same-id")));
  assert.ok(rows.some((row) => row.href.endsWith("followups?followup=same-id")));
  assert.ok(rows.some((row) => row.href.endsWith("consultations?consultation=same-id")));
});

test("completed consultations and routine future schedules do not become priorities", () => {
  const rows = buildMonitoringPriorities({
    followUps: [followUp("future", "2026-11-09"), followUp("missed", "2026-11-06", "Missed")],
    consultations: [{ id: "completed", resident: joinedResident, status: "completed" }],
    barangay, today,
  });
  assert.deepEqual(rows, []);
});

test("future activities awaiting a real resident response remain visible for supervision", () => {
  const rows = buildMonitoringPriorities({
    followUps: [{ ...followUp("confirmation", "2026-11-09", "Pending"), requires_resident_response: true, resident_decision: "pending" }],
    barangay, today,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].priority, "Awaiting Response");
  assert.equal(rows[0].status, "Pending");
});

test("clinical high risk and administrative high priority are not conflated", () => {
  const rows = buildMonitoringPriorities({
    residents: [resident("resident-1")],
    referrals: [{ ...referral("high-priority"), priority: "High" }, referral("in-progress", "In Progress")],
    followUps: [followUp("overdue")],
    barangay, today,
  });
  assert.equal(rows.filter((row) => matchesMonitoringFilter(row, "high-risk")).length, 1);
  assert.equal(rows.filter((row) => matchesMonitoringFilter(row, "pending-referral")).length, 1);
  assert.equal(rows.filter((row) => matchesMonitoringFilter(row, "overdue")).length, 1);
  assert.equal(rows.filter((row) => matchesMonitoringFilter(row, "all")).length, 4);
});

test("priority ordering puts recorded high-risk assessments and overdue care first", () => {
  const rows = buildMonitoringPriorities({
    residents: [resident("resident-1")], referrals: [referral("referral-1")],
    followUps: [followUp("overdue"), followUp("due-today", today)],
    barangay, today,
  });
  assert.deepEqual(rows.map((row) => row.priority), ["High Risk", "Overdue", "Pending Referral", "Due Today"]);
});

test("attention lists do not render outside or unknown barangay records", () => {
  const rows = buildMonitoringPriorities({
    residents: [{ ...resident("outside"), barangay: "San Isidro" }],
    followUps: [{ ...followUp("unknown"), resident: { id: "resident-1" } }],
    barangay, today,
  });
  assert.deepEqual(rows, []);
});

test("upcoming activities are bounded, sorted by date/time, and exclude terminal records", () => {
  const event = (id, dateKey, time = "") => ({ id, type: "follow-up", dateKey, time, status: "Scheduled" });
  const rows = upcomingActivities([
    event("unspecified", today), event("later", today, "15:00"), event("earlier", today, "09:00"),
    event("outside", "2026-12-09"), { ...event("completed", today), status: "Completed" },
    { id: "service", type: "health-service", dateKey: "2026-11-08", time: "", status: "scheduled" },
    { id: "cancelled-service", type: "health-service", dateKey: today, status: "cancelled" },
  ], today, "2026-12-07", 3);
  assert.deepEqual(rows.map((row) => row.id), ["earlier", "later", "unspecified"]);
  assert.equal(rows[2].time, "");
});

const map = () => ({ scope: "barangay", scopeComplete: true, summary: { activeCases: 0 }, barangays: [{ name: barangay, caseCount: 0, activeCases: 0, completedCases: 0, conditions: [] }] });

test("genuine scoped zero activity is accepted without generating placeholder geography", () => {
  const data = map();
  assert.equal(requireSupervisorMap(data, barangay), data);
  assert.equal(data.barangays[0].latitude, undefined);
});

test("incomplete, municipal and out-of-assignment map responses fail explicitly", () => {
  for (const data of [
    { ...map(), scope: "municipality" },
    { ...map(), scopeComplete: false },
    { ...map(), summary: {} },
    { ...map(), barangays: [{ ...map().barangays[0], name: "San Isidro" }] },
    { ...map(), barangays: [{ ...map().barangays[0], conditions: [{ name: "Recorded condition", value: "12" }] }] },
  ]) assert.throws(() => requireSupervisorMap(data, barangay), /incomplete or outside/);
  assert.throws(() => requireSupervisorMap(map(), null), /incomplete or outside/);
});

test("unknown risk data never becomes a zero-count distribution", () => {
  const rows = ["Low Risk", "Moderate Risk", "High Risk", "Unassessed"].map((name) => ({ name, value: 0 }));
  assert.deepEqual(riskDistributionRows(rows), rows);
  assert.equal(riskDistributionRows(rows.slice(0, 3)), null);
  assert.equal(riskDistributionRows([{ ...rows[0], value: null }, ...rows.slice(1)]), null);
});

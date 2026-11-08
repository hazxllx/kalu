import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  dashboardGreeting, previousFourMonths, enrichMonitoringCases,
  openedCaseSeries, highRiskCaseSeries, followUpPerformance, monitoringCasesCsv,
} from "../../src/features/dashboards/components/supervisorDashboardData.js";

const barangay = "San Antonio";
const months = previousFourMonths(2026, 10);

test("greeting follows local morning, afternoon and evening boundaries", () => {
  const date = new Date(2026, 10, 7);
  for (const [hour, expected] of [[4, "Good evening"], [5, "Good morning"], [11, "Good morning"], [12, "Good afternoon"], [17, "Good afternoon"], [18, "Good evening"]]) {
    date.setHours(hour);
    assert.equal(dashboardGreeting(date), expected);
  }
});

test("trend months are the previous four completed months, including year boundaries", () => {
  assert.deepEqual(months.map((month) => month.key), ["2026-07", "2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(previousFourMonths(2026, 0).map((month) => month.key), ["2025-09", "2025-10", "2025-11", "2025-12"]);
});

test("clinical risk, recorded zones and responsible staff are not guessed from priority or recorder", () => {
  const items = [{ key: "consultation-case-1", residentId: "person-1", category: "Consultation", detail: "Recorded concern", filters: [] }];
  const [row] = enrichMonitoringCases(items, {
    residents: [{ id: "person-1", riskLevel: "Low", zone: 2 }],
    consultations: [{ id: "case-1", priority: "High", attendingPersonnel: { fullName: "Recorder" }, responsiblePersonnelName: "Recorded responsible worker" }],
  });
  assert.equal(row.riskLevel, "Low");
  assert.equal(row.riskLabel, "Low Risk");
  assert.equal(row.area, "Zone 2");
  assert.match(row.areaBasis, /no verified purok crosswalk/);
  assert.equal(row.responsible, "Recorded responsible worker");
  assert.notEqual(row.responsible, "Recorder");
  assert.deepEqual(row.filters, []);
});

test("actual purok and clinical high-risk metadata enrich every relevant record", () => {
  const [row] = enrichMonitoringCases([{ key: "referral-ref-1", residentId: "person-1", category: "Referral", detail: "Referral concern", filters: ["pending-referral"] }], {
    residents: [{ id: "person-1", riskLevel: "High", household: { purok: "Purok 3" } }],
    referrals: [{ id: "ref-1", recipient: { full_name: "Recorded receiving worker" } }],
  });
  assert.equal(row.area, "Purok 3");
  assert.equal(row.responsible, "Recorded receiving worker");
  assert.deepEqual(row.filters, ["pending-referral", "high-risk"]);
});

test("missing risk, location and staff remain explicit instead of fabricated", () => {
  const [row] = enrichMonitoringCases([{ key: "referral-ref-1", category: "Referral", filters: [], detail: "Recorded concern" }], { referrals: [{ id: "ref-1", priority: "High" }] });
  assert.equal(row.riskLevel, null);
  assert.equal(row.riskLabel, "Risk unassessed");
  assert.equal(row.area, "Purok not recorded");
  assert.equal(row.responsible, "");
});

test("cases opened count server creation dates, not backdated encounter or client recording dates", () => {
  const rows = [
    { id: "one", createdAt: "2026-08-10T08:00:00Z", consultationDate: "2026-01-01", recordedAt: "2026-07-01T08:00:00Z" },
    { id: "two", createdAt: "2026-07-31T17:00:00Z" },
    { id: "one", createdAt: "2026-08-10T08:00:00Z" },
    { id: "outside", createdAt: "2026-11-01T00:00:00Z" },
  ];
  assert.deepEqual(openedCaseSeries(rows, months).map((row) => row.opened), [0, 2, 0, 0]);
  assert.throws(() => openedCaseSeries([{ id: "missing" }], months), /creation timestamp is unavailable/);
  assert.throws(() => openedCaseSeries([{ createdAt: "2026-08-01" }], months), /identifier is unavailable/);
});

const historical = (year = 2026) => ({
  scope: "barangay", barangay, scopeComplete: true, year, riskLevel: "High",
  monthly: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((month, index) => ({ month, cases: index })),
});

test("high-risk findings use complete authorized yearly data and exact requested months", () => {
  assert.deepEqual(highRiskCaseSeries([historical()], months, barangay).map((row) => row.highRisk), [6, 7, 8, 9]);
  const crossYear = previousFourMonths(2026, 1);
  assert.deepEqual(highRiskCaseSeries([historical(2025), historical(2026)], crossYear, barangay).map((row) => row.highRisk), [9, 10, 11, 0]);
  assert.throws(() => highRiskCaseSeries([{ ...historical(), barangay: "San Isidro" }], months, barangay), /outside your assigned barangay/);
  assert.throws(() => highRiskCaseSeries([{ ...historical(), riskLevel: "All" }], months, barangay), /incomplete/);
  assert.throws(() => highRiskCaseSeries([{ ...historical(), scopeComplete: false }], months, barangay), /incomplete/);
  assert.throws(() => highRiskCaseSeries([historical()], crossYear, barangay), /reporting month is unavailable/);
});

test("follow-up performance separates completed, open pending, overdue and other current outcomes", () => {
  const rows = [
    { id: "complete", status: "Completed", scheduled_date: "2026-11-04" },
    { id: "pending", status: "Scheduled", scheduled_date: "2026-11-09" },
    { id: "overdue", status: "Scheduled", scheduled_date: "2026-11-05", is_overdue: true },
    { id: "missed", status: "Missed", scheduled_date: "2026-11-02" },
    { id: "cancelled", status: "Cancelled", scheduled_date: "2026-11-01" },
    { id: "outside", status: "Completed", scheduled_date: "2026-10-20" },
  ];
  const result = followUpPerformance(rows, { from: "2026-11-01", to: "2026-11-30" }, "2026-11-07");
  assert.deepEqual(result, { scheduled: 5, completed: 1, pending: 1, overdue: 1, other: 2, percentage: 20 });
  assert.equal(followUpPerformance([], { from: "2026-11-01", to: "2026-11-30" }, "2026-11-07").percentage, null);
  assert.equal(followUpPerformance(null, {}, "2026-11-07"), null);
});

test("attention export preserves all filtered records and safely escapes spreadsheet content", () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ resident: index === 0 ? '=FORMULA()' : `Recorded person ${index}`, riskLabel: "High Risk", detail: 'Concern, with "quotes"\nand new line', area: "Purok 3", date: "2026-11-07", dateLabel: "Due", responsible: "Recorded worker", category: "Follow-up", key: `followup-${index}` }));
  const csv = monitoringCasesCsv(rows);
  assert.ok(csv.includes('"\'=FORMULA()"'));
  assert.ok(csv.includes('"Concern, with ""quotes""\nand new line"'));
  assert.ok(csv.includes('"Recorded person 7"'));
  assert.ok(csv.includes('"followup-7"'));
});

test("dashboard composition retains the exact major order and specified desktop proportions", async () => {
  const source = await readFile(new URL('../../src/features/dashboards/pages/HealthSupervisorDashboard.jsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../../src/styles/index.css', import.meta.url), 'utf8');
  const positions = ['<HealthSupervisorPageHeader', 'className="hs-quick-actions"', 'className="hs-main-grid"', 'className="hs-statistics"', 'className="hs-bottom-grid"'].map((key) => source.indexOf(key));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(css, /\.hs-main-grid\s*\{[^}]*minmax\(0, 13fr\) minmax\(0, 7fr\)/);
  assert.match(css, /\.hs-statistics-strip\s*\{[^}]*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.hs-bottom-grid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(source, /monitoringCasesCsv\(filteredCases\)/);
  assert.doesNotMatch(source, /<ScheduleCalendar|<MonthView|<CalendarViews/);
});

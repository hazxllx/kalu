import test from "node:test";
import assert from "node:assert/strict";

import {
  periodRange,
  inReportingPeriod,
  periodLabel,
  fhsisPeriodLabel,
  toReportParams,
  quarterMonths0,
  quarterOfMonth0,
} from "../src/features/health-records/lib/reportingPeriod.js";
import { filterByPeriod, periodBreakdown } from "../src/features/health-records/lib/m1Analytics.js";

/**
 * Reporting-period abstraction tests — the shared Monthly / Quarterly / Annual
 * definition behind the screen, the chart, the "Showing:" label and the
 * exported M1 report. These lock the date-range math (half-open [start, end)),
 * cross-period isolation (September is not Q4; January next year is not this
 * year) and the labels, so the three periods can never silently diverge.
 */

// --- date ranges --------------------------------------------------------------
test("periodRange: monthly October 2026 is [Oct 1, Nov 1)", () => {
  const { start, endExclusive } = periodRange({ period: "monthly", year: 2026, month: 9 });
  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 9); // October
  assert.equal(start.getDate(), 1);
  assert.equal(endExclusive.getMonth(), 10); // November
  assert.equal(endExclusive.getDate(), 1);
});

test("periodRange: Q4 2026 spans Oct 1 → Jan 1 next year", () => {
  const { start, endExclusive } = periodRange({ period: "quarterly", year: 2026, quarter: 4 });
  assert.equal(start.getMonth(), 9); // October
  assert.equal(endExclusive.getFullYear(), 2027);
  assert.equal(endExclusive.getMonth(), 0); // January
});

test("periodRange: annual 2026 spans Jan 1 2026 → Jan 1 2027", () => {
  const { start, endExclusive } = periodRange({ period: "annual", year: 2026 });
  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 0);
  assert.equal(endExclusive.getFullYear(), 2027);
  assert.equal(endExclusive.getMonth(), 0);
});

test("quarter helpers map months correctly", () => {
  assert.deepEqual(quarterMonths0(4), [9, 10, 11]);
  assert.deepEqual(quarterMonths0(1), [0, 1, 2]);
  assert.equal(quarterOfMonth0(9), 4); // October → Q4
  assert.equal(quarterOfMonth0(0), 1); // January → Q1
});

// --- inReportingPeriod --------------------------------------------------------
test("inReportingPeriod: monthly includes only the selected month", () => {
  const d = { period: "monthly", year: 2026, month: 9 }; // October
  assert.equal(inReportingPeriod("2026-10-15", d), true);
  assert.equal(inReportingPeriod("2026-09-30", d), false);
  assert.equal(inReportingPeriod("2026-11-01", d), false);
});

test("inReportingPeriod: September is NOT in Q4", () => {
  const q4 = { period: "quarterly", year: 2026, quarter: 4 };
  assert.equal(inReportingPeriod("2026-09-30", q4), false);
  assert.equal(inReportingPeriod("2026-10-01", q4), true);
  assert.equal(inReportingPeriod("2026-12-31", q4), true);
  assert.equal(inReportingPeriod("2027-01-01", q4), false);
});

test("inReportingPeriod: January 2027 is NOT in annual 2026", () => {
  const y = { period: "annual", year: 2026 };
  assert.equal(inReportingPeriod("2026-01-01", y), true);
  assert.equal(inReportingPeriod("2026-12-31", y), true);
  assert.equal(inReportingPeriod("2027-01-01", y), false);
});

// --- labels -------------------------------------------------------------------
test("periodLabel renders a specific, unambiguous label per period", () => {
  assert.equal(periodLabel({ period: "monthly", year: 2026, month: 9 }), "October 2026");
  assert.equal(periodLabel({ period: "quarterly", year: 2026, quarter: 4 }), "Q4 2026 · October–December");
  assert.equal(periodLabel({ period: "annual", year: 2026 }), "2026 Annual");
});

test("fhsisPeriodLabel feeds the official form header slot", () => {
  assert.equal(fhsisPeriodLabel({ period: "monthly", year: 2026, month: 9 }), "October");
  assert.equal(fhsisPeriodLabel({ period: "quarterly", year: 2026, quarter: 4 }), "4th Quarter (October–December)");
  assert.equal(fhsisPeriodLabel({ period: "annual", year: 2026 }), "Whole Year (January–December)");
});

test("toReportParams builds the correct backend query per period", () => {
  assert.deepEqual(toReportParams({ period: "monthly", year: 2026, month: 9 }), { period: "monthly", year: 2026, month: 10 });
  assert.deepEqual(toReportParams({ period: "quarterly", year: 2026, quarter: 4 }), { period: "quarterly", year: 2026, quarter: 4 });
  assert.deepEqual(toReportParams({ period: "annual", year: 2026 }), { period: "annual", year: 2026 });
});

// --- analytics integration (maternal_records view shape) ----------------------
const rec = (recordedAt, over = {}) => ({ id: recordedAt, recordedAt, status: "Active", prenatalVisits: 0, ...over });

const SAMPLE = [
  rec("2026-09-10T00:00:00Z"),
  rec("2026-10-05T00:00:00Z"),
  rec("2026-11-20T00:00:00Z"),
  rec("2026-12-02T00:00:00Z"),
  rec("2027-01-15T00:00:00Z"),
];

test("filterByPeriod monthly returns only the selected month", () => {
  const out = filterByPeriod(SAMPLE, { period: "monthly", year: 2026, month: 9 });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "2026-10-05T00:00:00Z");
});

test("filterByPeriod quarterly Q4 2026 returns Oct + Nov + Dec, not Sept or next year", () => {
  const out = filterByPeriod(SAMPLE, { period: "quarterly", year: 2026, quarter: 4 });
  assert.equal(out.length, 3);
  assert.ok(!out.some((r) => r.id.startsWith("2026-09")));
  assert.ok(!out.some((r) => r.id.startsWith("2027")));
});

test("filterByPeriod annual 2026 returns the whole year, excluding 2027", () => {
  const out = filterByPeriod(SAMPLE, { period: "annual", year: 2026 });
  assert.equal(out.length, 4);
  assert.ok(!out.some((r) => r.id.startsWith("2027")));
});

test("periodBreakdown returns 3 months for a quarter and 12 for a year", () => {
  const q = periodBreakdown(SAMPLE, { period: "quarterly", year: 2026, quarter: 4 });
  assert.equal(q.length, 3);
  assert.deepEqual(q.map((m) => m.count), [1, 1, 1]); // Oct, Nov, Dec
  const y = periodBreakdown(SAMPLE, { period: "annual", year: 2026 });
  assert.equal(y.length, 12);
  assert.equal(y[9].count, 1); // October
  assert.equal(y[0].count, 0); // January 2026 empty
});

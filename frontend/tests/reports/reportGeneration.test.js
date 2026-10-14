import assert from "node:assert/strict";
import test from "node:test";
import { summarizeRecords } from "../../src/features/reports/lib/reportGeneration.js";
import { buildReportContent } from "../../src/features/reports/lib/reportSnapshot.js";

const window = { from: "2026-09-01", to: "2026-09-30" };

test("report preview contains only source rows dated in the selected month", () => {
  const inPeriod = {
    id: "follow-up-1",
    scheduled_date: "2026-09-15",
    status: "Completed",
    purpose: "Postnatal check",
    resident: { first_name: "Ana", last_name: "Santos" },
  };
  const outOfPeriod = { id: "follow-up-2", scheduled_date: "2026-10-02", status: "Pending" };
  const undated = { id: "follow-up-3", status: "Pending" };
  const summary = summarizeRecords({ rows: [inPeriod, outOfPeriod, undated] }, window);

  assert.deepEqual(summary.records, [inPeriod]);
  assert.equal(summary.total, 1);
  assert.equal(summary.byStatus.Completed, 1);
  assert.equal(summary.periodFiltered, true);
  assert.match(summary.note, /1 record was excluded/);

  const snapshot = buildReportContent({
    type: "Follow-up Report",
    period: "2026-09",
    name: "Follow-up Report",
    scope: "San Isidro",
    barangay: "San Isidro",
    generatedAt: new Date("2026-09-30T12:00:00Z"),
    summary,
    note: summary.note,
    records: summary.records,
  });
  assert.equal(snapshot.summary.total, 1);
  assert.equal(snapshot.rows.length, 1);
  assert.ok(snapshot.rows[0].includes("Ana Santos"));
  assert.ok(snapshot.rows[0].includes("Postnatal check"));
});

test("undated source rows are not presented as period-specific report data", () => {
  const summary = summarizeRecords({ records: [{ id: "undated-1", status: "Pending" }] }, window);

  assert.equal(summary.total, 0);
  assert.deepEqual(summary.records, []);
  assert.equal(summary.periodFiltered, true);
  assert.match(summary.note, /could not be assigned to the selected period/);
});

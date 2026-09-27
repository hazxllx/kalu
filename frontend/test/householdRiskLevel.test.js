import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHouseholdRiskLevel,
  householdRiskRank,
  countByRiskLevel,
} from "../src/lib/householdRiskLevel.js";

test("normalizeHouseholdRiskLevel keeps known server levels", () => {
  assert.equal(normalizeHouseholdRiskLevel("High"), "High");
  assert.equal(normalizeHouseholdRiskLevel("Moderate"), "Moderate");
  assert.equal(normalizeHouseholdRiskLevel("Low"), "Low");
});

test("normalizeHouseholdRiskLevel defaults unknown/empty to Low", () => {
  assert.equal(normalizeHouseholdRiskLevel(undefined), "Low");
  assert.equal(normalizeHouseholdRiskLevel(null), "Low");
  assert.equal(normalizeHouseholdRiskLevel(""), "Low");
  assert.equal(normalizeHouseholdRiskLevel("priority_review"), "Low");
});

test("householdRiskRank sorts highest risk first", () => {
  assert.ok(householdRiskRank("High") > householdRiskRank("Moderate"));
  assert.ok(householdRiskRank("Moderate") > householdRiskRank("Low"));
});

test("countByRiskLevel matches the returned records (no fabricated data)", () => {
  const rows = [
    { id: "H1", riskLevel: "High" },
    { id: "H2", riskLevel: "High" },
    { id: "H3", riskLevel: "Moderate" },
    { id: "H4", riskLevel: "Low" },
    { id: "H5", riskLevel: undefined }, // treated as Low
  ];
  const counts = countByRiskLevel(rows);
  assert.deepEqual(counts, { High: 2, Moderate: 1, Low: 2 });
  // The totals must add up to exactly the number of records returned.
  assert.equal(counts.High + counts.Moderate + counts.Low, rows.length);
});

test("countByRiskLevel on an empty list is all zeros (empty != error)", () => {
  assert.deepEqual(countByRiskLevel([]), { High: 0, Moderate: 0, Low: 0 });
});

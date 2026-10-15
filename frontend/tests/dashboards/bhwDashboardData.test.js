import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchBhwHouseholds,
  householdRiskLevel,
  summarizeHouseholdConcerns,
} from "../../src/features/dashboards/lib/bhwDashboardData.js";

test("fetches every household page for a complete barangay concern summary", async () => {
  const calls = [];
  const records = Array.from({ length: 205 }, (_, index) => ({ id: index }));
  const rows = await fetchBhwHouseholds(async ({ limit, offset }) => {
    calls.push({ limit, offset });
    return { rows: records.slice(offset, offset + limit), total: records.length };
  });

  assert.deepEqual(calls, [
    { limit: 100, offset: 0 },
    { limit: 100, offset: 100 },
    { limit: 100, offset: 200 },
  ]);
  assert.equal(rows.length, records.length);
  assert.equal(rows.at(-1).id, 204);
});

test("rejects malformed or incomplete household list responses", async () => {
  await assert.rejects(
    fetchBhwHouseholds(async () => ({ rows: [], total: "0" })),
    /invalid list response/,
  );
  await assert.rejects(
    fetchBhwHouseholds(async ({ offset }) => offset === 0
      ? { rows: [{ id: "HH-1" }], total: 2 }
      : { rows: [], total: 2 }),
    /incomplete/,
  );
});

test("summarizes stored and legacy household risk details with the highest risk level", () => {
  const summary = summarizeHouseholdConcerns([
    {
      riskFactors: ["Unimproved water source", "Pregnant member"],
      riskLevel: "Moderate",
      waterSource: "unimproved",
      riskScore: 40,
    },
    {
      riskFactors: ["Unimproved water source"],
      riskLevel: "High",
      riskScore: 70,
    },
    {
      waterSource: "level1",
      toiletType: "none",
      riskScore: 30,
      flags: ["Sensitive flag text is not displayed"],
    },
  ]);

  assert.deepEqual(summary, [
    { concern: "Unimproved water source", count: 2, riskLevel: "High" },
    { concern: "Level I water source", count: 1, riskLevel: "Low" },
    { concern: "No toilet facility", count: 1, riskLevel: "Low" },
    { concern: "Pregnant member", count: 1, riskLevel: "Moderate" },
  ]);
  assert.equal(householdRiskLevel({ riskScore: 45 }), "Moderate");
});

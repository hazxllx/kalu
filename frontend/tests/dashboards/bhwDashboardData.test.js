import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  bhwDashboardGreeting,
  bhwProfileFirstName,
  fetchBhwHouseholds,
  householdRiskLevel,
  summarizeHouseholdConcerns,
} from "../../src/features/dashboards/lib/bhwDashboardData.js";

test("BHW greeting uses Philippine local time boundaries", () => {
  for (const [timestamp, expected] of [
    ["2026-11-24T20:59:00Z", "Good evening"],
    ["2026-11-24T21:00:00Z", "Good morning"],
    ["2026-11-24T03:59:00Z", "Good morning"],
    ["2026-11-24T04:00:00Z", "Good afternoon"],
    ["2026-11-24T09:59:00Z", "Good afternoon"],
    ["2026-11-24T10:00:00Z", "Good evening"],
  ]) {
    assert.equal(bhwDashboardGreeting(new Date(timestamp)), expected);
  }
});

test("BHW greeting reads only the dedicated profile first-name field", () => {
  assert.equal(bhwProfileFirstName({ firstName: "  Juan  ", name: "San Isidro BHW" }), "Juan");
  assert.equal(bhwProfileFirstName({ name: "Juan Dela Cruz", email: "juan@example.com" }), "");
  assert.equal(bhwProfileFirstName({ firstName: " ", name: "Juan Dela Cruz" }), "");
});

test("BHW banner uses the greeting as its main heading and keeps the household description", async () => {
  const source = await readFile(new URL("../../src/features/dashboards/pages/BHWDashboard.jsx", import.meta.url), "utf8");
  const banner = source.match(/<PageHeader[\s\S]*?\/>/)?.[0] || "";
  assert.match(banner, /title=\{`\$\{bhwDashboardGreeting\(localTime\)\}/);
  assert.doesNotMatch(banner, /Household Profiling|eyebrow=/);
  assert.match(banner, /Household conditions and risk classification across the barangay\./);
  assert.match(source, /Add Household/);
});

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

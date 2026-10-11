// Issue 12C — canonical risk-level vocabulary.
// Run: node --test tests/analytics/riskLevel.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { canonicalRiskLevel, RISK_LEVELS } from "../../src/lib/riskLevel.js";

test("canonical labels pass through unchanged", () => {
  assert.equal(canonicalRiskLevel("Low"), "Low");
  assert.equal(canonicalRiskLevel("Moderate"), "Moderate");
  assert.equal(canonicalRiskLevel("High"), "High");
  assert.equal(canonicalRiskLevel("Critical"), "Critical");
});

test("the legacy 'Medium' alias normalizes to 'Moderate'", () => {
  assert.equal(canonicalRiskLevel("Medium"), "Moderate");
  assert.equal(canonicalRiskLevel("medium"), "Moderate");
  assert.equal(canonicalRiskLevel("  MEDIUM  "), "Moderate");
});

test("normalization is case- and whitespace-insensitive", () => {
  assert.equal(canonicalRiskLevel("low"), "Low");
  assert.equal(canonicalRiskLevel(" HIGH "), "High");
});

test("missing / empty / unexpected values return null (treated as no-data, never Low)", () => {
  assert.equal(canonicalRiskLevel(""), null);
  assert.equal(canonicalRiskLevel(null), null);
  assert.equal(canonicalRiskLevel(undefined), null);
  assert.equal(canonicalRiskLevel("No Data"), null);
  assert.equal(canonicalRiskLevel("banana"), null);
});

test("Medium and Moderate resolve to the SAME canonical tier (same label/color/legend)", () => {
  assert.equal(canonicalRiskLevel("Medium"), canonicalRiskLevel("Moderate"));
  assert.equal(canonicalRiskLevel("Medium"), RISK_LEVELS.MODERATE);
});

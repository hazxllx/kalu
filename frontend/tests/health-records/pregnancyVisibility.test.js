// Resident "My Health Record" — Pregnancy Status visibility rule.
// Run: node --test tests/health-records/pregnancyVisibility.test.js
//
// Policy under test:
//  - Male residents must NOT see Pregnancy Status.
//  - Female residents still see it.
//  - Missing / unknown sex must NOT be treated as male (field stays visible).

import assert from "node:assert/strict";
import test from "node:test";

import { shouldShowPregnancyStatus } from "../../src/features/health-records/lib/pregnancyVisibility.js";

test("male residents do not see Pregnancy Status", () => {
  assert.equal(shouldShowPregnancyStatus("Male"), false);
  // Case- and whitespace-insensitive so minor data variance is still suppressed.
  assert.equal(shouldShowPregnancyStatus("male"), false);
  assert.equal(shouldShowPregnancyStatus("  MALE  "), false);
});

test("female residents still see Pregnancy Status", () => {
  assert.equal(shouldShowPregnancyStatus("Female"), true);
  assert.equal(shouldShowPregnancyStatus("female"), true);
});

test("missing / unknown sex never triggers the male-specific hide", () => {
  assert.equal(shouldShowPregnancyStatus(""), true);
  assert.equal(shouldShowPregnancyStatus(null), true);
  assert.equal(shouldShowPregnancyStatus(undefined), true);
  assert.equal(shouldShowPregnancyStatus("Other"), true);
  assert.equal(shouldShowPregnancyStatus("unknown"), true);
});

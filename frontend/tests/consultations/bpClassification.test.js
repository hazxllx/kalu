import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyBloodPressure,
  parseBloodPressure,
} from "../../src/features/consultations/utils/bpClassification.js";

test("classifies the requested routine category examples", () => {
  assert.equal(classifyBloodPressure("118/76").category, "Normal Blood Pressure");
  assert.equal(classifyBloodPressure("125/78").category, "Elevated Blood Pressure");
  assert.equal(classifyBloodPressure("135/85").category, "Stage 1 Hypertension");
  assert.equal(classifyBloodPressure("150/95").category, "Stage 2 Hypertension");
  assert.equal(classifyBloodPressure("185/125").category, "Hypertensive Crisis");
});

test("applies systolic boundary values", () => {
  assert.equal(classifyBloodPressure("119/70").code, "normal");
  assert.equal(classifyBloodPressure("120/70").code, "elevated");
  assert.equal(classifyBloodPressure("129/70").code, "elevated");
  assert.equal(classifyBloodPressure("130/70").code, "stage1");
  assert.equal(classifyBloodPressure("139/70").code, "stage1");
  assert.equal(classifyBloodPressure("140/70").code, "stage2");
});

test("applies diastolic boundaries and uses the more severe mixed category", () => {
  assert.equal(classifyBloodPressure("110/79").code, "normal");
  assert.equal(classifyBloodPressure("110/80").code, "stage1");
  assert.equal(classifyBloodPressure("120/80").code, "stage1");
  assert.equal(classifyBloodPressure("130/89").code, "stage1");
  assert.equal(classifyBloodPressure("130/90").code, "stage2");
  assert.equal(classifyBloodPressure("125/85").code, "stage1");
  assert.equal(classifyBloodPressure("135/95").code, "stage2");
  assert.equal(classifyBloodPressure("145/75").code, "stage2");
});

test("classifies crisis only above 180 systolic or above 120 diastolic", () => {
  assert.equal(classifyBloodPressure("180/100").code, "stage2");
  assert.equal(classifyBloodPressure("181/100").code, "crisis");
  assert.equal(classifyBloodPressure("130/120").code, "stage2");
  assert.equal(classifyBloodPressure("130/121").code, "crisis");
  assert.equal(classifyBloodPressure("121/120").code, "stage2");
  assert.equal(classifyBloodPressure("185/125").code, "crisis");
});

test("crisis guidance does not claim emergency based on numbers alone", () => {
  const result = classifyBloodPressure("185/125");
  assert.equal(result.category, "Hypertensive Crisis");
  assert.equal(result.emergency, false);
  assert.match(result.message, /concerning symptoms/i);
  assert.match(result.message, /does not establish a hypertensive emergency/i);
});

test("returns category styling for the five requested routine classifications", () => {
  const cases = [
    ["118/76", "Normal Blood Pressure", "bg-green-100"],
    ["125/78", "Elevated Blood Pressure", "bg-yellow-100"],
    ["135/85", "Stage 1 Hypertension", "bg-orange-100"],
    ["150/95", "Stage 2 Hypertension", "bg-red-100"],
    ["185/125", "Hypertensive Crisis", "bg-red-800"],
  ];
  for (const [reading, category, badgeClass] of cases) {
    const result = classifyBloodPressure(reading);
    assert.equal(result.category, category);
    assert.ok(result.badgeClassName.includes(badgeClass));
  }
});

test("rejects empty, incomplete, malformed, negative, and implausible readings", () => {
  for (const reading of [
    "",
    " ",
    "120",
    "120/",
    "/80",
    "abc",
    "120/80/70",
    "-120/80",
    "0/0",
    "39/60",
    "301/80",
    "120/301",
    "80/80",
    "80/90",
  ]) {
    assert.equal(classifyBloodPressure(reading), null, `expected null for "${reading}"`);
  }
});

test("parses valid systolic/diastolic readings with optional whitespace", () => {
  assert.deepEqual(parseBloodPressure(" 120 / 80 "), { systolic: 120, diastolic: 80 });
});

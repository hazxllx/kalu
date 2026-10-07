import test from "node:test";
import assert from "node:assert/strict";

import {
  HEALTH_SERVICES,
  HEALTH_SERVICE_TITLES,
  SERVICE_SOURCE_LABEL,
  isOperationalService,
  recordCountLabel,
} from "../src/features/health-records/lib/healthServicesConfig.js";

/**
 * Health Services configuration tests — the single reusable definition that
 * drives the M1 "Health Services" summary.
 *
 * These lock the standardized terminology (source labels are either
 * "Operational records" or "M1 section", never "Opens module"), the service
 * classification (matching the backend FHSIS M1 catalog sources), the grammar
 * of record counts (0 records / 1 record / 2 records) and the FHSIS section
 * keys, so the summary can never show inconsistent wording between services.
 */

test("all eight FHSIS program sections are configured in order", () => {
  assert.deepEqual(
    HEALTH_SERVICES.map((s) => s.key),
    ["A", "B", "C", "D", "F", "G", "E", "H"],
  );
});

test("every service has the standard fields (name, description, icon, source, open)", () => {
  for (const s of HEALTH_SERVICES) {
    assert.equal(typeof s.name, "string");
    assert.ok(s.name.length > 0, `service ${s.key} needs a name`);
    assert.equal(typeof s.description, "string");
    assert.ok(s.description.length > 0, `service ${s.key} needs a description`);
    assert.ok(s.icon, `service ${s.key} needs an icon`);
    assert.ok(
      s.source === "m1" || s.source === "operational",
      `service ${s.key} has an invalid source ${s.source}`,
    );
    assert.ok(s.open.section || s.open.to, `service ${s.key} needs a way to open`);
  }
});

test("each service name maps to its FHSIS section key title", () => {
  const byKey = Object.fromEntries(HEALTH_SERVICES.map((s) => [s.key, s.name]));
  assert.equal(HEALTH_SERVICE_TITLES.A, "Family Planning");
  assert.equal(HEALTH_SERVICE_TITLES.B, "Maternal Care");
  assert.equal(HEALTH_SERVICE_TITLES.H, "Vital Statistics");
  assert.deepEqual(HEALTH_SERVICE_TITLES, byKey);
});

test("source classification matches the backend M1 catalog data flow", () => {
  const sourceOf = Object.fromEntries(HEALTH_SERVICES.map((s) => [s.key, s.source]));
  // Operational-record backed services (derived from existing modules).
  assert.equal(sourceOf.B, "operational"); // maternal_records
  assert.equal(sourceOf.C, "operational"); // immunizations module
  assert.equal(sourceOf.G, "operational"); // households WASH
  // M1 section services (section workspace with derived + manual reporting).
  assert.equal(sourceOf.A, "m1");
  assert.equal(sourceOf.D, "m1");
  assert.equal(sourceOf.E, "m1");
  assert.equal(sourceOf.F, "m1");
  assert.equal(sourceOf.H, "m1");
});

test("source labels are standardized (no 'Opens module' terminology)", () => {
  assert.equal(SERVICE_SOURCE_LABEL.m1, "M1 section");
  assert.equal(SERVICE_SOURCE_LABEL.operational, "Operational records");
  assert.ok(
    !HEALTH_SERVICES.some((s) => String(s.source || "").toLowerCase().includes("opens module")),
    "no service may carry the old 'Opens module' wording",
  );
  for (const s of HEALTH_SERVICES) {
    const label = SERVICE_SOURCE_LABEL[s.source];
    assert.ok(label, `service ${s.key} has no source label`);
    assert.ok(
      label !== "Opens module",
      `service ${s.key} must not show 'Opens module'`,
    );
  }
});

test("operational-services helper flags only operational sources", () => {
  const operationalKeys = HEALTH_SERVICES.filter((s) => isOperationalService(s.source)).map((s) => s.key);
  assert.deepEqual(operationalKeys, ["B", "C", "G"]);
});

test("record count label pluralizes correctly", () => {
  assert.equal(recordCountLabel(0), "records"); // 0 records
  assert.equal(recordCountLabel(1), "record"); // 1 record
  assert.equal(recordCountLabel(2), "records"); // 2 records
  assert.equal(recordCountLabel(10), "records"); // 10 records
});

test("record count label never exposes undefined/null/NaN", () => {
  assert.equal(recordCountLabel(undefined), "records");
  assert.equal(recordCountLabel(null), "records");
  assert.equal(recordCountLabel(NaN), "records");
  assert.equal(recordCountLabel(""), "records");
  assert.equal(recordCountLabel("abc"), "records");
});
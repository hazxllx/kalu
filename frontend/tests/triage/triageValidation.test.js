import assert from "node:assert/strict";
import test from "node:test";
import {
  VITAL_FIELDS, ageFromBirthDate, emptyVitals, errorStep, mapTriageFieldErrors,
  optionalReading, previewBmi, residentIdentity, reviewFlags, validateDemographics,
  validateRegisteredPatient, validateVisitDetails,
} from "../../src/features/triage/lib/triageValidation.js";

const patient = { id: "resident-1", name: "Maria de la Cruz", age: "0", sex: "Female", barangay: "Registered" };
const barangays = ["Registered"];
const validate = (vitals) => validateVisitDetails({ ...emptyVitals(), ...vitals }, "Check-up", "");

test("BMI automatically previews valid measurements at the server's one-decimal precision", () => {
  assert.equal(previewBmi({ ...emptyVitals(), heightCm: "170", weightKg: "65" }), "22.5");
  assert.equal(previewBmi({ ...emptyVitals(), heightCm: "160", weightKg: "64" }), "25.0");
  for (const vitals of [{}, { heightCm: "170" }, { heightCm: "-170", weightKg: "65" }, { heightCm: "1e2", weightKg: "65" }, { heightCm: "170", weightKg: "abc" }]) {
    assert.equal(previewBmi({ ...emptyVitals(), ...vitals }), "");
  }
});

test("walk-in requires a Unicode name, integer age, explicit sex and live registered barangay", () => {
  for (const name of ["María O’Neill-Santos", "李 明", "Jose\u0301 Cruz", "Nguyễn Văn An", "D. Cruz"]) assert.deepEqual(validateDemographics({ ...patient, name }, barangays), {});
  for (const name of ["", "123", "Maria2 Cruz", "---", "Dr <script>", "Jane\nDoe"]) assert.ok(validateDemographics({ ...patient, name }, barangays).name);
  for (const age of ["", "-1", "1.5", "121", "1e2", "0x10", "Infinity"]) assert.ok(validateDemographics({ ...patient, age }, barangays).age);
  for (const age of [0, "0", "120"]) assert.equal(validateDemographics({ ...patient, age }, barangays).age, undefined);
  assert.ok(validateDemographics({ ...patient, sex: "" }, barangays).sex);
  assert.ok(validateDemographics({ ...patient, sex: "Unknown" }, barangays).sex);
  assert.ok(validateDemographics(patient, []).barangay);
  assert.ok(validateDemographics({ ...patient, barangay: "Typed invention" }, barangays).barangay);
});

test("registered identities must be fully loaded, match selected id and contain valid demographics", () => {
  assert.deepEqual(validateRegisteredPatient(patient, patient, false, barangays), {});
  assert.match(validateRegisteredPatient(patient, null, false, barangays).patient, /load/);
  assert.match(validateRegisteredPatient(patient, patient, true, barangays).patient, /loading/);
  assert.ok(validateRegisteredPatient(patient, { ...patient, id: "different" }, false, barangays).patient);
  assert.match(validateRegisteredPatient(patient, { ...patient, age: "", sex: "", barangay: "" }, false, barangays).patient, /age, sex, barangay/);
  assert.deepEqual(residentIdentity({ id: "1", firstName: "Ana", lastName: "Cruz", age: 0, sex: "Female" }), { id: "1", name: "Ana Cruz", age: 0, sex: "Female", barangay: "" });
});

test("all measurements are optional; every populated measurement rejects coercible malformed values", () => {
  assert.deepEqual(validate({}), {});
  assert.equal(optionalReading("  "), null);
  assert.equal(optionalReading(" 65.4 "), "65.4");
  for (const { key, min, max } of VITAL_FIELDS) {
    for (const value of ["1e2", "0x64", "Infinity", "NaN", "100abc", "-1", "1,000", ".", "1.2.3"]) assert.ok(validate({ [key]: value })[key], `${key} accepted ${value}`);
    assert.ok(validate({ [key]: String(min - 0.01) })[key]);
    assert.ok(validate({ [key]: String(max + 1) })[key]);
    assert.equal(validate({ [key]: String(min) })[key], undefined);
    assert.equal(validate({ [key]: String(max) })[key], undefined);
  }
  assert.ok(validate({ pulseRate: "72.5" }).pulseRate);
  assert.ok(validate({ respiratoryRate: "20.5" }).respiratoryRate);
});

test("blood pressure validates both components and ordering without rewriting readings", () => {
  for (const bloodPressure of ["120", "120/", "120/80foo", "1e2/80", "301/80", "120/201", "80/120", "120/120", "39/20", "120/19"]) assert.ok(validate({ bloodPressure }).bloodPressure, bloodPressure);
  for (const bloodPressure of ["120/80", "40/20", "300/200", " 185 / 125 "]) assert.equal(validate({ bloodPressure }).bloodPressure, undefined);
  const readings = { ...emptyVitals(), bloodPressure: "185/125", temperature: "39", bloodSugar: "55", oxygenSaturation: "91" };
  const copy = { ...readings };
  assert.equal(reviewFlags(readings).length, 4);
  assert.deepEqual(readings, copy);
  assert.equal(reviewFlags({ ...emptyVitals(), pulseRate: "1e2" }).length, 0);
});

test("reason and notes validation retain bounded text and require an explicit reason", () => {
  assert.ok(validateVisitDetails(emptyVitals(), "", "").reason);
  assert.ok(validateVisitDetails(emptyVitals(), "Other", " ").reasonDetail);
  assert.deepEqual(validateVisitDetails(emptyVitals(), "Other", "Headache", "Symptoms since yesterday"), {});
  assert.ok(validateVisitDetails(emptyVitals(), "Other", "x".repeat(2001)).reasonDetail);
  assert.ok(validateVisitDetails(emptyVitals(), "Check-up", "", "x".repeat(10001)).notes);
});

test("backend field paths map to visible inputs and correct wizard step", () => {
  const mapped = mapTriageFieldErrors({ payload: { error: { errors: { "resident.firstName": "Name invalid", "resident.age": "Age invalid", "visit.vitals.hr": "HR invalid", "vitals.bp": "BP invalid", "visit.clinicalHistory": "Notes invalid", "visit.chiefComplaint": "Reason invalid" } } } });
  assert.deepEqual(mapped, { name: "Name invalid", age: "Age invalid", pulseRate: "HR invalid", bloodPressure: "BP invalid", notes: "Notes invalid", reasonDetail: "Reason invalid" });
  assert.equal(errorStep(mapped), "patient");
  assert.equal(errorStep({ bloodPressure: "Invalid" }), "details");
  assert.deepEqual(mapTriageFieldErrors({ fieldErrors: [{ path: ["visit", "vitals", "o2sat"], message: "Invalid oxygen" }] }), { oxygenSaturation: "Invalid oxygen" });
});

test("birth-date age respects birthday and never invents an age for missing or future dates", () => {
  const today = new Date("2026-06-15T12:00:00");
  assert.equal(ageFromBirthDate("2000-06-16", today), 25);
  assert.equal(ageFromBirthDate("2000-06-15", today), 26);
  assert.equal(ageFromBirthDate("2026-06-15", today), 0);
  assert.equal(ageFromBirthDate("2027-01-01", today), "");
  assert.equal(ageFromBirthDate("invalid", today), "");
  assert.equal(ageFromBirthDate("2001-02-29", today), "");
  assert.equal(ageFromBirthDate("2000-02-29", today), 26);
  assert.equal(ageFromBirthDate(null, today), "");
});

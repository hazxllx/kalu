// RHU Consultation queue tests.
//
// These exercise the pure queue partitioning/filtering extracted from
// RhuConsultation.jsx. They are UI-free and run with the project's existing
// node test runner — there is no React renderer in the repo.
//
// Run with:  node --test tests/consultations/consultationQueue.test.js

import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_CONSULT_STATUSES,
  isActiveConsult,
  partitionConsultationQueue,
  filterConsultationPatients,
} from "../../src/features/consultations/lib/consultationQueue.js";

// Mirrors CHECKUP_STATUS from src/lib/phnWorkflowMap.js (kept as literals here so
// the test runner needs no `@` alias resolution — same approach as the triage
// and health-services libs).
const WAITING = "Waiting for PHN";
const IN_CHECKUP = "In Check-up";
const COMPLETED = "Consultation Completed";

test("1. a handed-off (WAITING) referral is in the ACTIVE consultation queue", () => {
  assert.equal(isActiveConsult({ status: WAITING }), true);
  assert.equal(isActiveConsult({ status: IN_CHECKUP }), true);
  assert.equal(isActiveConsult({ status: COMPLETED }), false);
  assert.deepEqual(ACTIVE_CONSULT_STATUSES, [WAITING, IN_CHECKUP]);
});

test("2. partition keeps active (waiting/in-consult) separate from handled (completed)", () => {
  const rows = [
    { id: "a", status: WAITING },
    { id: "b", status: IN_CHECKUP },
    { id: "c", status: COMPLETED },
    { id: "d", status: WAITING },
  ];
  const { active, handled } = partitionConsultationQueue(rows);
  assert.deepEqual(active.map((p) => p.id), ["a", "b", "d"]);
  assert.deepEqual(handled.map((p) => p.id), ["c"]);
  // Source is not mutated and nothing is dropped.
  assert.equal(rows.length, 4);
});

test("3. a completed encounter leaves the ACTIVE queue but is NOT deleted (available to history)", () => {
  const rows = [
    { id: "a", status: WAITING },
    { id: "c", status: COMPLETED },
  ];
  const { active, handled } = partitionConsultationQueue(rows);
  assert.deepEqual(active.map((p) => p.id), ["a"]);
  // The completed encounter is retained in `handled`, never removed from source.
  assert.deepEqual(handled.map((p) => p.id), ["c"]);
  assert.ok(rows.some((r) => r.status === COMPLETED));
});

test("4. partition tolerates non-array / malformed input (unknown status => handled, not active)", () => {
  assert.deepEqual(partitionConsultationQueue(undefined), { active: [], handled: [] });
  assert.deepEqual(partitionConsultationQueue(null), { active: [], handled: [] });
  const { active, handled } = partitionConsultationQueue([{ id: "x" }, { id: "y", status: "Something" }]);
  assert.deepEqual(active, []);
  assert.deepEqual(handled.map((p) => p.id), ["x", "y"]);
});

test("5. filter matches patient name case-insensitively and respects an exact status", () => {
  const rows = [
    { id: "a", patient: "Juan Dela Cruz", status: WAITING },
    { id: "b", patient: "Maria Santos", status: IN_CHECKUP },
    { id: "c", patient: "Juanita Reyes", status: COMPLETED },
  ];
  assert.deepEqual(filterConsultationPatients(rows, { search: "juan" }).map((p) => p.id), ["a", "c"]);
  assert.deepEqual(filterConsultationPatients(rows, { status: IN_CHECKUP }).map((p) => p.id), ["b"]);
  assert.deepEqual(
    filterConsultationPatients(rows, { search: "juan", status: WAITING }).map((p) => p.id),
    ["a"],
  );
  // "All" disables the status filter; empty search matches everything.
  assert.equal(filterConsultationPatients(rows, { status: "All" }).length, 3);
  assert.equal(filterConsultationPatients(rows, {}).length, 3);
});

test("5b. filter tolerates non-array / malformed input", () => {
  assert.deepEqual(filterConsultationPatients(undefined), []);
  assert.deepEqual(filterConsultationPatients(null), []);
  assert.deepEqual(filterConsultationPatients([{ id: "x" }], { search: "a" }), []);
});

test("6. a custom active-status set is honored (status model stays the single source of truth)", () => {
  const rows = [{ id: "a", status: "X" }, { id: "b", status: "Y" }];
  const { active, handled } = partitionConsultationQueue(rows, ["X"]);
  assert.deepEqual(active.map((p) => p.id), ["a"]);
  assert.deepEqual(handled.map((p) => p.id), ["b"]);
});

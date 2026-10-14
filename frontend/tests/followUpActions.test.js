import assert from "node:assert/strict";
import test from "node:test";

import { followUpActionAvailability } from "../src/features/follow-ups/lib/followUpActions.js";

const TODAY = new Date("2026-10-15T04:00:00.000Z");
const supervisorPermissions = { canEdit: true, canComplete: true, canRecordVisit: true };

test("scheduled future follow-ups can be rescheduled or cancelled, but not completed or missed", () => {
  const actions = followUpActionAvailability({
    status: "Upcoming",
    scheduledDateRaw: "2026-10-16",
  }, supervisorPermissions, TODAY);

  assert.equal(actions.view, true);
  assert.equal(actions.edit, true);
  assert.equal(actions.complete, false);
  assert.equal(actions.missed, false);
  assert.equal(actions.cancel, true);
  assert.equal(actions.recordVisit, false);
});

test("due scheduled and ongoing follow-ups expose completion and missed actions", () => {
  for (const status of ["Today", "Ongoing"]) {
    const actions = followUpActionAvailability({
      status,
      scheduledDateRaw: "2026-10-15",
    }, supervisorPermissions, TODAY);

    assert.equal(actions.complete, true);
    assert.equal(actions.missed, true);
    assert.equal(actions.recordVisit, true);
  }
});

test("completed and cancelled follow-ups are view-only", () => {
  for (const status of ["Completed", "Cancelled"]) {
    const actions = followUpActionAvailability({
      status,
      scheduledDateRaw: "2026-10-15",
    }, supervisorPermissions, TODAY);

    assert.equal(actions.view, true);
    assert.equal(actions.edit, false);
    assert.equal(actions.complete, false);
    assert.equal(actions.missed, false);
    assert.equal(actions.cancel, false);
    assert.equal(actions.recordVisit, false);
  }
});

test("missed follow-ups may be rescheduled but cannot be completed or marked missed again", () => {
  const actions = followUpActionAvailability({
    status: "Missed",
    scheduledDateRaw: "2026-10-14",
  }, supervisorPermissions, TODAY);

  assert.equal(actions.edit, true);
  assert.equal(actions.complete, false);
  assert.equal(actions.missed, false);
  assert.equal(actions.cancel, true);
  assert.equal(actions.recordVisit, false);
});

test("resident-pending follow-ups cannot be completed, missed, or recorded as a visit", () => {
  const actions = followUpActionAvailability({
    status: "Pending",
    scheduledDateRaw: "2026-10-15",
    requires_resident_response: true,
    resident_decision: "pending",
  }, supervisorPermissions, TODAY);

  assert.equal(actions.edit, true);
  assert.equal(actions.complete, false);
  assert.equal(actions.missed, false);
  assert.equal(actions.recordVisit, false);
});

test("actions remain gated by the user's permissions", () => {
  const actions = followUpActionAvailability({
    status: "Today",
    scheduledDateRaw: "2026-10-15",
  }, { canEdit: false, canComplete: true, canRecordVisit: true }, TODAY);

  assert.equal(actions.edit, false);
  assert.equal(actions.addRemarks, false);
  assert.equal(actions.cancel, false);
  assert.equal(actions.complete, true);
  assert.equal(actions.missed, true);
});

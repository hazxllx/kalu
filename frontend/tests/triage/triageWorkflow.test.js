// RHU Triage workflow tests (Issue I remediation).
//
// These exercise the pure submission/cleanup contract and the incoming-referral
// filtering extracted from RhuTriage.jsx. They are UI-free and run with the
// project's existing node test runner — there is no React renderer in the repo.
//
// Run with:  node --test tests/triage/triageWorkflow.test.js

import assert from "node:assert/strict";
import test from "node:test";

import {
  filterOpenReferrals,
  submitTriage,
  TRIAGE_MESSAGES,
  CLOSED_REFERRAL_STATUSES,
} from "../../src/features/triage/lib/triageWorkflow.js";

/** Minimal spy helper. */
const spy = (impl) => {
  const fn = (...args) => {
    fn.calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  fn.calls = [];
  return fn;
};

test("1. successful submission does not throw even if cleanup references bad state", async () => {
  // Regression for the undefined `setAssignedPersonnel` ReferenceError: a reset
  // that throws must not blow up the submission nor flip it to a failure.
  const notify = spy();
  const reset = spy(() => {
    throw new ReferenceError("setAssignedPersonnel is not defined");
  });

  const result = await submitTriage({
    send: async () => false,
    reset,
    notify,
    refresh: spy(),
  });

  assert.equal(result.ok, true);
  assert.equal(reset.calls.length, 1);
  // Exactly one toast, and it is the SUCCESS toast — never the failure toast.
  assert.equal(notify.calls.length, 1);
  assert.equal(notify.calls[0][0].ok, true);
  assert.equal(notify.calls[0][0].message, TRIAGE_MESSAGES.success);
});

test("2. successful submission resets the wizard and refreshes the list, then notifies success", async () => {
  const order = [];
  const reset = spy(() => order.push("reset"));
  const refresh = spy(async () => order.push("refresh"));
  const notify = spy(() => order.push("notify"));

  const result = await submitTriage({
    send: async () => false,
    reset,
    notify,
    refresh,
  });

  assert.equal(result.ok, true);
  assert.equal(result.offline, false);
  assert.equal(reset.calls.length, 1, "wizard reset once");
  assert.equal(refresh.calls.length, 1, "incoming list refreshed once");
  // Reset happens before the success toast; refresh happens after.
  assert.deepEqual(order, ["reset", "notify", "refresh"]);
});

test("2b. offline (queued) submission is still a success with the offline message", async () => {
  const notify = spy();
  const result = await submitTriage({
    send: async () => true, // queued offline
    reset: spy(),
    notify,
    refresh: spy(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.offline, true);
  assert.equal(notify.calls[0][0].message, TRIAGE_MESSAGES.offline);
});

test("3. failed submission preserves state (no reset / no refresh) and shows the error", async () => {
  const reset = spy();
  const refresh = spy();
  const notify = spy();
  const boom = new Error("Network unreachable");

  const result = await submitTriage({
    send: async () => {
      throw boom;
    },
    reset,
    notify,
    refresh,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, boom);
  assert.equal(reset.calls.length, 0, "active referral/wizard must be preserved on failure");
  assert.equal(refresh.calls.length, 0, "list must not refresh on failure");
  assert.equal(notify.calls.length, 1);
  assert.equal(notify.calls[0][0].ok, false);
  assert.equal(notify.calls[0][0].message, "Network unreachable");
});

test("3b. failure with no message falls back to the default failure toast", async () => {
  const notify = spy();
  await submitTriage({
    send: async () => {
      throw new Error("");
    },
    notify,
  });
  assert.equal(notify.calls[0][0].message, TRIAGE_MESSAGES.failure);
});

test("4. a successful action triggers exactly one incoming-list refresh", async () => {
  const refresh = spy(async () => {});
  await submitTriage({ send: async () => false, reset: spy(), notify: spy(), refresh });
  assert.equal(refresh.calls.length, 1);
});

test("4b. a refresh failure after success does not surface as a send failure", async () => {
  const notify = spy();
  const result = await submitTriage({
    send: async () => false,
    reset: spy(),
    notify,
    refresh: async () => {
      throw new Error("list fetch failed");
    },
  });
  assert.equal(result.ok, true);
  assert.equal(notify.calls.length, 1);
  assert.equal(notify.calls[0][0].ok, true);
});

test("5. completed/cancelled referrals leave the ACTIVE triage list but are not deleted", () => {
  const rows = [
    { id: "r1", status: "Pending" },
    { id: "r2", status: "Accepted" },
    { id: "r3", status: "In Progress" },
    { id: "r4", status: "Completed" },
    { id: "r5", status: "Cancelled" },
  ];
  const open = filterOpenReferrals(rows);

  // Terminal referrals drop out of the active queue...
  assert.deepEqual(open.map((r) => r.id), ["r1", "r2", "r3"]);
  // ...but the source data is untouched (no deletion), so Completed referrals
  // remain available to history and the downstream consultation workflow.
  assert.equal(rows.length, 5);
  assert.ok(rows.some((r) => r.status === "Completed"));
  assert.deepEqual(CLOSED_REFERRAL_STATUSES, ["Completed", "Cancelled"]);
});

test("5b. filterOpenReferrals tolerates non-array / malformed input", () => {
  assert.deepEqual(filterOpenReferrals(undefined), []);
  assert.deepEqual(filterOpenReferrals(null), []);
  assert.deepEqual(filterOpenReferrals([{ id: "x" }]), [{ id: "x" }]); // missing status => open
});

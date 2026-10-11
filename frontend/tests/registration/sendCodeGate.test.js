// KALUSAGAP registration — "Send Verification Code" button gating tests
// (node:test, no browser/network).
//
// Run: node --test tests/registration/sendCodeGate.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { isSendCodeDisabled, sendCodeDisabledReason } from "../../src/features/registration/sendCodeGate.js";

const base = { email: "user@example.com", emailPhase: "idle", resendIn: 0, emailDuplicate: false };

test("enabled for a valid email in the idle phase", () => {
  assert.equal(isSendCodeDisabled(base), false);
  assert.equal(sendCodeDisabledReason(base), "");
});

test("disabled while a send or verify request is in flight", () => {
  assert.equal(isSendCodeDisabled({ ...base, emailPhase: "sending" }), true);
  assert.equal(isSendCodeDisabled({ ...base, emailPhase: "verifying" }), true);
});

test("disabled when the email field is empty or invalid", () => {
  assert.equal(isSendCodeDisabled({ ...base, email: "" }), true);
  assert.equal(isSendCodeDisabled({ ...base, email: "not-an-email" }), true);
  assert.equal(isSendCodeDisabled({ ...base, email: "missing@domain" }), true);
  assert.match(sendCodeDisabledReason({ ...base, email: "nope" }), /valid email/i);
});

test("leading/trailing whitespace is tolerated via normalization", () => {
  assert.equal(isSendCodeDisabled({ ...base, email: "  user@example.com  " }), false);
});

test("disabled once a duplicate account is confirmed", () => {
  assert.equal(isSendCodeDisabled({ ...base, emailDuplicate: true }), true);
  assert.match(sendCodeDisabledReason({ ...base, emailDuplicate: true }), /already registered/i);
});

test("disabled during the resend cooldown after a successful send", () => {
  assert.equal(isSendCodeDisabled({ ...base, emailPhase: "sent", resendIn: 42 }), true);
  assert.match(sendCodeDisabledReason({ ...base, emailPhase: "sent", resendIn: 42 }), /42s/);
});

test("a server-reported cooldown on the first attempt (idle) also disables the button", () => {
  // When the server rate-limits the very first send, the flow stays in the
  // idle phase but seeds a countdown; the button must stay disabled so no
  // duplicate request is issued before the interval elapses.
  assert.equal(isSendCodeDisabled({ ...base, emailPhase: "idle", resendIn: 30 }), true);
  assert.match(sendCodeDisabledReason({ ...base, emailPhase: "idle", resendIn: 30 }), /30s/);
});

test("re-enabled after the cooldown elapses", () => {
  assert.equal(isSendCodeDisabled({ ...base, emailPhase: "sent", resendIn: 0 }), false);
});

test("duplicate flag overrides an otherwise-valid cooldown-free state", () => {
  assert.equal(isSendCodeDisabled({ email: "user@example.com", emailPhase: "idle", resendIn: 0, emailDuplicate: true }), true);
});

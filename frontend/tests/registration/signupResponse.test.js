// KALUSAGAP registration — duplicate-email classification tests (node:test, no
// browser/network). Proves the resident "Send Verification Code" flow uses
// Supabase Auth as the single source of truth for "already registered" and
// never conflates a profile/record conflict with a confirmed Auth account.
//
// Run: node --test tests/registration/signupResponse.test.js

import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRegistrationEmail,
  classifySignupError,
  signupResponseIssue,
  rateLimitRetrySeconds,
} from "../../src/features/registration/signupResponse.js";

const okUser = (email, identities = [{ id: "idp" }]) => ({
  data: { user: { id: "u1", email, identities } },
  error: null,
  email,
});

test("normalizeRegistrationEmail trims and lowercases", () => {
  assert.equal(normalizeRegistrationEmail("  Foo@Bar.COM "), "foo@bar.com");
  assert.equal(normalizeRegistrationEmail("\tUser@Example.com\n"), "user@example.com");
  assert.equal(normalizeRegistrationEmail(null), "");
  assert.equal(normalizeRegistrationEmail(undefined), "");
});

test("a genuinely new signup returns null (OTP sent, no duplicate)", () => {
  assert.equal(signupResponseIssue(okUser("new@example.com")), null);
});

test("whitespace around the email does not create a false mismatch", () => {
  // The user object echoes the normalized email; the caller passes the raw one.
  const res = { data: { user: { id: "u1", email: "new@example.com", identities: [{ id: "x" }] } }, error: null, email: "  New@Example.com " };
  assert.equal(signupResponseIssue(res), null);
});

test("empty identities array = authoritative Auth duplicate", () => {
  assert.equal(signupResponseIssue(okUser("taken@example.com", [])), "duplicate_email");
});

test("explicit Auth duplicate error codes map to duplicate_email", () => {
  assert.equal(signupResponseIssue({ error: { code: "user_already_exists" }, email: "a@b.co" }), "duplicate_email");
  assert.equal(signupResponseIssue({ error: { code: "email_exists" }, email: "a@b.co" }), "duplicate_email");
  assert.equal(signupResponseIssue({ error: { message: "User already registered" }, email: "a@b.co" }), "duplicate_email");
});

test("profile/record conflict is NOT reported as a duplicate account", () => {
  // Supabase rolls the signup back when the handle_new_user trigger hits the
  // profiles email-unique index: a profile exists but there is no Auth account.
  assert.equal(classifySignupError({ message: "Database error saving new user" }), "profile_conflict");
  assert.equal(classifySignupError({ message: 'duplicate key value violates unique constraint "profiles_email_normalized_unique"' }), "profile_conflict");
  assert.notEqual(classifySignupError({ message: "Database error saving new user" }), "duplicate_email");
});

test("rate-limit errors are classified separately", () => {
  assert.equal(classifySignupError({ code: "over_email_send_rate_limit" }), "rate_limited");
  assert.equal(classifySignupError({ message: "email rate limit exceeded" }), "rate_limited");
});

test("rateLimitRetrySeconds reads the server-mandated interval", () => {
  // Message form used by GoTrue for the resend/signup-confirm interval.
  assert.equal(
    rateLimitRetrySeconds({ message: "For security purposes, you can only request this after 54 seconds." }),
    54
  );
  // Explicit retry_after field (seconds) is honored and rounded up.
  assert.equal(rateLimitRetrySeconds({ retry_after: 12 }), 12);
  assert.equal(rateLimitRetrySeconds({ retry_after: 11.2 }), 12);
  // No parsable hint -> 0 so the caller can fall back to the default 60s.
  assert.equal(rateLimitRetrySeconds({ message: "email rate limit exceeded" }), 0);
  assert.equal(rateLimitRetrySeconds(null), 0);
  assert.equal(rateLimitRetrySeconds({ message: "after 0 seconds" }), 0);
});

test("unknown errors fall back to signup_failed, never duplicate", () => {
  assert.equal(classifySignupError({ message: "network down" }), "signup_failed");
  assert.equal(classifySignupError(null), "signup_failed");
});

test("malformed / missing responses never advance OTP state", () => {
  assert.equal(signupResponseIssue({ data: null, error: null, email: "a@b.co" }), "invalid_response");
  assert.equal(signupResponseIssue({ data: { user: { id: "u1", email: "a@b.co" } }, error: null, email: "a@b.co" }), "invalid_response");
  assert.equal(signupResponseIssue({ data: { user: { id: "u1", email: "other@b.co", identities: [] } }, error: null, email: "a@b.co" }), "invalid_response");
  assert.equal(signupResponseIssue({ data: { user: { id: "", email: "a@b.co", identities: [] } }, error: null, email: "a@b.co" }), "invalid_response");
});

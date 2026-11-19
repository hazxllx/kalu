// Fail-closed isolation-gate tests (node:test, no browser/network).
//
// Validates frontend/tests/e2e/helpers/isolation.js against every case the task
// requires the gate to reject, proving unsafe configurations are refused
// WITHOUT contacting production. Run with: node --test tests/safety/isolationGate.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { evaluateIsolation, isIsolatedEnv, isIsolatedHost } from "../e2e/helpers/isolation.js";

// A fully-valid isolated (local) configuration used as the baseline.
const LOCAL = Object.freeze({
  E2E_ISOLATED: "1",
  E2E_BASE_URL: "http://localhost:5173",
  E2E_API_URL: "http://localhost:5000/api",
  E2E_SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_API_URL: "http://localhost:5000/api",
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
});

test("a complete local configuration is accepted", () => {
  const { ok, reasons } = evaluateIsolation(LOCAL);
  assert.equal(ok, true, reasons.join(" "));
  assert.equal(isIsolatedEnv(LOCAL), true);
});

test("E2E_ISOLATED absent or not exactly '1' fails closed", () => {
  assert.equal(evaluateIsolation({ ...LOCAL, E2E_ISOLATED: undefined }).ok, false);
  assert.equal(evaluateIsolation({ ...LOCAL, E2E_ISOLATED: "true" }).ok, false);
  assert.equal(evaluateIsolation({ ...LOCAL, E2E_ISOLATED: "0" }).ok, false);
});

test("E2E_BASE_URL absent fails closed", () => {
  const r = evaluateIsolation({ ...LOCAL, E2E_BASE_URL: undefined });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((m) => /E2E_BASE_URL is required/.test(m)));
});

test("E2E_API_URL absent fails closed (backend target must be explicit)", () => {
  const r = evaluateIsolation({ ...LOCAL, E2E_API_URL: undefined });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((m) => /E2E_API_URL is required/.test(m)));
});

test("E2E_SUPABASE_URL and the frontend Vite targets are required", () => {
  assert.equal(evaluateIsolation({ ...LOCAL, E2E_SUPABASE_URL: undefined }).ok, false);
  assert.equal(evaluateIsolation({ ...LOCAL, VITE_API_URL: undefined }).ok, false);
  assert.equal(evaluateIsolation({ ...LOCAL, VITE_SUPABASE_URL: undefined }).ok, false);
});

test("declared targets must match the frontend bundle targets", () => {
  const apiMismatch = evaluateIsolation({ ...LOCAL, VITE_API_URL: "http://127.0.0.1:5000/api" });
  assert.equal(apiMismatch.ok, false);
  assert.ok(apiMismatch.reasons.some((m) => /VITE_API_URL must exactly match/.test(m)));

  const supabaseMismatch = evaluateIsolation({ ...LOCAL, VITE_SUPABASE_URL: "http://localhost:54321" });
  assert.equal(supabaseMismatch.ok, false);
  assert.ok(supabaseMismatch.reasons.some((m) => /VITE_SUPABASE_URL must exactly match/.test(m)));
});

test("a production *.supabase.co target is rejected by default (not allowlisted)", () => {
  const prod = {
    E2E_ISOLATED: "1",
    E2E_BASE_URL: "https://kalusagap.vercel.app",
    E2E_API_URL: "https://lblawqeoixojyytkmfqy.supabase.co",
  };
  const r = evaluateIsolation(prod);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((m) => /not a verified isolated host/.test(m)));
});

test("E2E_ISOLATED=1 alone (no URLs) is NOT accepted — declaration is not proof", () => {
  assert.equal(evaluateIsolation({ E2E_ISOLATED: "1" }).ok, false);
});

test("mismatched/unapproved backend host fails closed even if frontend is local", () => {
  const r = evaluateIsolation({
    ...LOCAL,
    E2E_API_URL: "https://api.production.example.com",
  });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((m) => /E2E_API_URL host .* not a verified isolated host/.test(m)));
});

test("an explicit production denylist (E2E_PRODUCTION_REFS) always wins", () => {
  const r = evaluateIsolation({
    ...LOCAL,
    // Even if a host were allowlisted, a denylisted ref present in the URL blocks it.
    E2E_ALLOWED_HOSTS: "staging.supabase.co",
    E2E_API_URL: "https://staging.supabase.co",
    E2E_SUPABASE_URL: "https://lblawqeoixojyytkmfqy.supabase.co",
    E2E_PRODUCTION_REFS: "lblawqeoixojyytkmfqy",
  });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((m) => /denylisted production target/.test(m)));
});

test("a public staging host remains rejected even when explicitly allowlisted", () => {
  const base = {
    E2E_ISOLATED: "1",
    E2E_BASE_URL: "https://staging-app.example.test",
    E2E_API_URL: "https://staging-api.example.test/api",
    E2E_SUPABASE_URL: "https://staging-db.example.test",
    VITE_API_URL: "https://staging-api.example.test/api",
    VITE_SUPABASE_URL: "https://staging-db.example.test",
  };
  assert.equal(evaluateIsolation(base).ok, false, "not allowlisted => rejected");
  const allowed = {
    ...base,
    E2E_ALLOWED_HOSTS: "staging-app.example.test, staging-api.example.test, staging-db.example.test",
  };
  assert.equal(evaluateIsolation(allowed).ok, false);
});

test("invalid URLs fail closed", () => {
  assert.equal(evaluateIsolation({ ...LOCAL, E2E_BASE_URL: "not a url" }).ok, false);
});

test("required E2E_SUPABASE_URL is validated", () => {
  const r = evaluateIsolation({ ...LOCAL, E2E_SUPABASE_URL: "https://lblawqeoixojyytkmfqy.supabase.co" });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((m) => /E2E_SUPABASE_URL host .* not a verified isolated host/.test(m)));
});

test("isIsolatedHost accepts only exact loopback hosts regardless of allowlists", () => {
  assert.equal(isIsolatedHost("localhost"), true);
  assert.equal(isIsolatedHost("127.0.0.1"), true);
  assert.equal(isIsolatedHost("[::1]"), true);
  assert.equal(isIsolatedHost("db.local"), false);
  assert.equal(isIsolatedHost("0.0.0.0"), false);
  assert.equal(isIsolatedHost("example.com"), false);
  assert.equal(isIsolatedHost("example.com", ["example.com"]), false);
});

test("local E2E destinations reject credentials, queries, fragments and non-http schemes", () => {
  for (const value of [
    'ftp://localhost:5173', 'file://localhost/path', 'http://user:password@localhost:5173',
    'http://localhost:5173?forward=production', 'http://localhost:5173/#fragment',
    'http://local\nhost:5173',
  ]) {
    assert.equal(evaluateIsolation({ ...LOCAL, E2E_BASE_URL: value }).ok, false);
  }
});

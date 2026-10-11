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

test("a dedicated staging host is accepted ONLY when explicitly allowlisted", () => {
  const base = {
    E2E_ISOLATED: "1",
    E2E_BASE_URL: "https://staging-app.example.test",
    E2E_API_URL: "https://staging-api.example.test/api",
  };
  assert.equal(evaluateIsolation(base).ok, false, "not allowlisted => rejected");
  const allowed = {
    ...base,
    E2E_ALLOWED_HOSTS: "staging-app.example.test, staging-api.example.test",
  };
  assert.equal(evaluateIsolation(allowed).ok, true);
});

test("invalid URLs fail closed", () => {
  assert.equal(evaluateIsolation({ ...LOCAL, E2E_BASE_URL: "not a url" }).ok, false);
});

test("optional E2E_SUPABASE_URL is validated when present", () => {
  const r = evaluateIsolation({ ...LOCAL, E2E_SUPABASE_URL: "https://lblawqeoixojyytkmfqy.supabase.co" });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((m) => /E2E_SUPABASE_URL host .* not a verified isolated host/.test(m)));
});

test("isIsolatedHost recognizes loopback/.local and allowlisted hosts only", () => {
  assert.equal(isIsolatedHost("localhost"), true);
  assert.equal(isIsolatedHost("127.0.0.1"), true);
  assert.equal(isIsolatedHost("db.local"), true);
  assert.equal(isIsolatedHost("example.com"), false);
  assert.equal(isIsolatedHost("example.com", ["example.com"]), true);
});

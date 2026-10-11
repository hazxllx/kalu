// E2E environment + credential resolution.
//
// All configuration comes from environment variables so no secrets, URLs, or
// production data live in the test files. The guard below is the single safety
// gate: specs only run when the operator has positively declared an ISOLATED,
// writable test environment. In every other case (including this repo's default
// .env, which points at the real production Supabase project) the specs skip
// with an explicit BLOCKED reason rather than writing to production.

import { test } from '@playwright/test';
import { isIsolatedEnv as evalIsolated, isolationBlockedReason } from './isolation.js';

/**
 * True only when the operator has explicitly opted into an isolated, writable
 * test environment AND every destination (frontend + backend + optional
 * Supabase) is verified-local or explicitly allowlisted. Fail-closed; never
 * infer "safe" from a .env file. See helpers/isolation.js for the full rules.
 */
export function isIsolatedEnv() {
  return evalIsolated(process.env);
}

/** A human-readable reason surfaced on skipped specs (empty when isolated). */
export function blockedReason() {
  return (
    isolationBlockedReason(process.env) ||
    'BLOCKED: isolation could not be verified.'
  );
}

/**
 * Gate a describe/suite so it skips (before any browser or network use) unless
 * a safe isolated environment is verified. Call at the top of a describe block.
 */
export function requireIsolatedEnv() {
  test.skip(() => !isIsolatedEnv(), blockedReason());
}

/** Resolve a role's synthetic credentials from env, or throw if absent. */
export function credentials(role) {
  const key = String(role || '').toUpperCase();
  const email = process.env[`E2E_${key}_EMAIL`];
  const password = process.env[`E2E_${key}_PASSWORD`];
  if (!email || !password) {
    throw new Error(
      `Missing E2E_${key}_EMAIL / E2E_${key}_PASSWORD for role "${role}". ` +
        'Provide synthetic test-account credentials via the environment.',
    );
  }
  return { email, password };
}

/** Role route prefixes (verified against src/routes/AppRoutes.jsx). */
export const ROUTES = Object.freeze({
  login: '/login',
  rhuTriage: '/app/rhu_personnel/triage',
  rhuConsultation: '/app/rhu_personnel/consultation',
  rhuDashboard: '/app/rhu_personnel/dashboard',
  rhuReports: '/app/rhu_personnel/reports',
  residentHealthServices: '/app/resident/health-services',
});

/** A unique synthetic marker so test records are identifiable and cleanable. */
export function syntheticTag(prefix = 'E2E') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

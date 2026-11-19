// Fail-closed isolation gate for the E2E suite.
//
// This module is intentionally dependency-free (no @playwright/test import) so
// the gate logic can be unit-tested with the project's node:test runner WITHOUT
// contacting any browser, network, or database. `env.js` layers the Playwright
// `test.skip` wrapper on top of `evaluateIsolation` here.
//
// Design principle: FAIL CLOSED. `E2E_ISOLATED=1` is treated as a declaration,
// never as proof. A target is only accepted when every destination (frontend,
// backend, and Supabase) uses an exact loopback host, and no destination matches
// a production denylist. Public hosts cannot be approved through an allowlist.

import { requireLocalUrl } from '../../../src/lib/localSafety.js';

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])$/i;
const BUILT_IN_PRODUCTION_REFS = Object.freeze([
  'kalusagap.onrender.com',
  'kalusagap-frontend.onrender.com',
  'kalusagap.vercel.app',
  'lblawqeoixojyytkmfqy',
]);

/** Parse a hostname from a URL string, or null when it is not a valid URL. */
export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const splitList = (value) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** Only exact loopback hosts are isolated, regardless of any legacy allowlist. */
export function isIsolatedHost(host) {
  return typeof host === 'string' && LOCAL_HOST_RE.test(host);
}

/**
 * Evaluate whether the provided environment describes a verified isolated,
 * writable test target. Pure: reads only the passed `env` object.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ok: boolean, reasons: string[]}}  ok=false lists every blocker.
 */
export function evaluateIsolation(env = {}) {
  const reasons = [];

  if (env.E2E_ISOLATED !== '1') {
    reasons.push('E2E_ISOLATED must be exactly "1" to opt into write-based tests.');
  }

  const denied = [...BUILT_IN_PRODUCTION_REFS, ...splitList(env.E2E_PRODUCTION_REFS)];

  // Both the declared E2E destinations and the frontend's actual Vite targets
  // are required, so a safe declaration cannot conceal a production bundle.
  const targets = [
    ['E2E_BASE_URL', env.E2E_BASE_URL, true],
    ['E2E_API_URL', env.E2E_API_URL, true],
    ['E2E_SUPABASE_URL', env.E2E_SUPABASE_URL, true],
    ['VITE_API_URL', env.VITE_API_URL, true],
    ['VITE_SUPABASE_URL', env.VITE_SUPABASE_URL, true],
  ];

  for (const [name, url, required] of targets) {
    if (!url) {
      if (required) reasons.push(`${name} is required so every browser destination is explicit.`);
      continue;
    }
    const host = hostOf(url);
    if (!host) {
      reasons.push(`${name} is not a valid URL.`);
      continue;
    }
    if (!isIsolatedHost(host)) {
      reasons.push(
        `${name} host "${host}" is not a verified isolated host. ` +
          'Use localhost, 127.0.0.1 or [::1]; public allowlists are not supported.',
      );
    } else {
      try { requireLocalUrl(url, name); } catch {
        reasons.push(`${name} must use loopback HTTP(S) without credentials, a query or a fragment.`);
      }
    }
    // Defense in depth: an explicit production denylist always wins.
    const lower = String(url).toLowerCase();
    if (denied.some((ref) => ref && lower.includes(ref))) {
      reasons.push(`${name} matches a denylisted production target (E2E_PRODUCTION_REFS).`);
    }
  }

  const comparableUrl = (value) => {
    try {
      const parsed = new URL(String(value));
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      return null;
    }
  };
  const declaredApi = comparableUrl(env.E2E_API_URL);
  const bundledApi = comparableUrl(env.VITE_API_URL);
  if (declaredApi && bundledApi && declaredApi !== bundledApi) {
    reasons.push('VITE_API_URL must exactly match E2E_API_URL.');
  }
  const declaredSupabase = comparableUrl(env.E2E_SUPABASE_URL);
  const bundledSupabase = comparableUrl(env.VITE_SUPABASE_URL);
  if (declaredSupabase && bundledSupabase && declaredSupabase !== bundledSupabase) {
    reasons.push('VITE_SUPABASE_URL must exactly match E2E_SUPABASE_URL.');
  }

  return { ok: reasons.length === 0, reasons };
}

/** True only when the environment is a verified isolated, writable target. */
export function isIsolatedEnv(env = (typeof process !== 'undefined' ? process.env : {})) {
  return evaluateIsolation(env).ok;
}

/** A single human-readable blocker string (or '' when isolated). */
export function isolationBlockedReason(env = (typeof process !== 'undefined' ? process.env : {})) {
  const { ok, reasons } = evaluateIsolation(env);
  if (ok) return '';
  return `BLOCKED: environment is not a verified isolated test target → ${reasons.join(' ')}`;
}

export default { hostOf, isIsolatedHost, evaluateIsolation, isIsolatedEnv, isolationBlockedReason };

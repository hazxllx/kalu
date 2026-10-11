// Fail-closed isolation gate for the E2E suite.
//
// This module is intentionally dependency-free (no @playwright/test import) so
// the gate logic can be unit-tested with the project's node:test runner WITHOUT
// contacting any browser, network, or database. `env.js` layers the Playwright
// `test.skip` wrapper on top of `evaluateIsolation` here.
//
// Design principle: FAIL CLOSED. `E2E_ISOLATED=1` is treated as a declaration,
// never as proof. A target is only accepted when every destination (frontend,
// backend, and — when provided — Supabase) resolves to a verified-local or an
// explicitly allowlisted host, and no destination matches a production denylist.
// A hosted `*.supabase.co` / public target is rejected by default.

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?|.*\.local)$/i;

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

/** A host is isolated when it is loopback/.local or explicitly allowlisted. */
export function isIsolatedHost(host, allowedHosts = []) {
  if (!host) return false;
  if (LOCAL_HOST_RE.test(host)) return true;
  return allowedHosts.includes(host);
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

  const allowed = splitList(env.E2E_ALLOWED_HOSTS);
  const denied = splitList(env.E2E_PRODUCTION_REFS);

  // Required, explicit destinations: frontend AND backend must both be given,
  // so a run can never implicitly inherit the production API.
  const targets = [
    ['E2E_BASE_URL', env.E2E_BASE_URL, true],
    ['E2E_API_URL', env.E2E_API_URL, true],
    ['E2E_SUPABASE_URL', env.E2E_SUPABASE_URL, false], // optional, validated if present
  ];

  for (const [name, url, required] of targets) {
    if (!url) {
      if (required) reasons.push(`${name} is required (the ${name === 'E2E_BASE_URL' ? 'frontend' : 'backend'} target must be explicit).`);
      continue;
    }
    const host = hostOf(url);
    if (!host) {
      reasons.push(`${name} is not a valid URL.`);
      continue;
    }
    if (!isIsolatedHost(host, allowed)) {
      reasons.push(
        `${name} host "${host}" is not a verified isolated host. ` +
          'Use a loopback/.local host, or add it to E2E_ALLOWED_HOSTS to approve a dedicated staging host.',
      );
    }
    // Defense in depth: an explicit production denylist always wins.
    const lower = String(url).toLowerCase();
    if (denied.some((ref) => ref && lower.includes(ref))) {
      reasons.push(`${name} matches a denylisted production target (E2E_PRODUCTION_REFS).`);
    }
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

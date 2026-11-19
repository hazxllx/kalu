// Playwright E2E configuration for KALUSAGAP.
//
// SAFETY: this harness never targets production by default. Every spec is gated
// by helpers/env.js `requireIsolatedEnv()` and skips unless the operator has
// explicitly declared an ISOLATED, writable test environment via env vars:
//
//   E2E_ISOLATED=1            — explicit opt-in that the target is NOT production
//   E2E_BASE_URL=http://...   — the running app under test (loopback only)
//   E2E_API_URL=http://...    — the isolated backend (must match VITE_API_URL)
//   E2E_SUPABASE_URL=http://... — isolated Auth/DB (must match VITE_SUPABASE_URL)
//   E2E_<ROLE>_EMAIL/PASSWORD — synthetic test-account credentials (never hardcoded)
//
// Nothing here contains secrets or production URLs; all of that is read from the
// environment at run time. Artifacts (traces/screenshots/report) are written to
// gitignored directories.
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e',
  // Only the Playwright E2E specs — never the node:test unit suites in tests/*.
  testMatch: '**/*.e2e.js',
  // Fail fast on an accidental focus/skip-less run; keep CI output readable.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Deterministic: no implicit arbitrary waits; actions wait for actionability.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // No webServer auto-start: write-based specs require an explicitly provided
  // local instance and synthetic accounts. The no-service network smoke is a
  // separate command: npm run test:local-browser.
});

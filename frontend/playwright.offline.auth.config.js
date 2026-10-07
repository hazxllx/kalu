import { defineConfig, devices } from '@playwright/test';

/**
 * Authenticated offline E2E for KALUSAGAP.
 *
 * Boots the Vite DEV server against the DEVELOPMENT backend + Supabase project
 * (set via env vars; see docs/offline/DEV-CHECKLIST.md). The backend must be
 * started separately on the port that VITE_API_URL points to.
 *
 * These tests are NOT part of the unit baseline and are intentionally NOT a
 * "smoke" run: they require a live dev backend, a dev Supabase project, and the
 * provisioned test BHW account. Run them explicitly:
 *
 *   ALLOW_OFFLINE_E2E=1 \
 *   VITE_API_URL=http://localhost:5001/api \
 *   VITE_SUPABASE_URL=https://<DEV_REF>.supabase.co \
 *   VITE_SUPABASE_ANON_KEY=<DEV_ANON_KEY> \
 *   KALUSAGAP_TEST_BHW_EMAIL=test-bhw@kalusagap-dev.local \
 *   KALUSAGAP_TEST_BHW_PASSWORD=<test password> \
 *   npx playwright test tests/offline/offline-authenticated.spec.js \
 *     --config playwright.offline.auth.config.js
 */
export default defineConfig({
  testDir: './tests/offline',
  testMatch: /offline-authenticated\.spec\.js/,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_API_URL: process.env.VITE_API_URL || 'http://localhost:5001/api',
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || '',
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || '',
    },
  },
  expect: {
    timeout: 15_000,
  },
});

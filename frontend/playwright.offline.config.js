import { defineConfig, devices } from '@playwright/test';

/**
 * Focused PWA/offline verification for the PRODUCTION build.
 *
 * Separate from `playwright.config.js` (which boots the dev server and needs
 * authenticated credentials). This config serves `dist/` through `vite preview`
 * so the real service worker is exercised. It needs no Supabase or credentials:
 * it verifies service-worker registration, offline shell navigation, the offline
 * fallback page, and the never-cache rules for API/authorized requests.
 *
 * Build first with a same-origin API base so the never-cache rule is testable:
 *   VITE_API_URL=/api npm run build
 */
export default defineConfig({
  testDir: './tests/offline',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

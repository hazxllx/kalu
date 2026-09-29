import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './tests/kalusagap-major-features',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'evidence/test-report', open: 'never' }],
    ['json', { outputFile: 'evidence/summary.json' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    // BUG-026: no keys are hardcoded here. The Supabase URL and the (public,
    // RLS-guarded) anon key are read from the environment. The anon key is
    // designed to ship in the client bundle so it is not a secret in the way the
    // service-role key is — but it is still sourced from the environment for
    // hygiene and to keep all credentials out of source.
    env: {
      VITE_API_URL: process.env.VITE_API_URL || 'http://localhost:5000/api',
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || '',
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || '',
    },
  },
  expect: {
    timeout: 10000,
    toHaveScreenshot: {
      maxDiffPixels: 1000,
    },
  },
  outputDir: 'evidence/test-results',
});
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
    env: {
      VITE_API_URL: 'http://localhost:5000/api',
      VITE_SUPABASE_URL: 'https://lblawqeoixojyytkmfqy.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxibGF3cWVvaXhvanl5dGttZnF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0NTcyMjgsImV4cCI6MjEwNTAzMzIyOH0.CSmv38XdRvxd3kST64cQgBpj9CXuPTBR1vsQb-sp3GA',
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
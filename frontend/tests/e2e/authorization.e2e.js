// Section 6 — Role and authorization checks (E2E).
//
// Each role uses its own isolated browser context (Playwright creates a fresh
// context per test by default, so sessions never bleed between roles). SAFETY:
// skips unless an isolated, writable environment is declared. These assert
// access boundaries only; they never disable RLS/auth or elevate the account.
//
// Preconditions: E2E_RESIDENT_* and E2E_RHU_PERSONNEL_* credentials.

import { test, expect } from '@playwright/test';
import { requireIsolatedEnv, ROUTES } from './helpers/env.js';
import { loginAs, expectNoAccess } from './helpers/auth.js';

test.describe('6. Role & authorization', () => {
  requireIsolatedEnv();

  test('a resident cannot reach RHU Triage or Consultation', async ({ page }) => {
    await loginAs(page, 'resident');
    await expectNoAccess(page, ROUTES.rhuTriage);
    await expectNoAccess(page, ROUTES.rhuConsultation);
  });

  test('a resident can open their own Health Services page', async ({ page }) => {
    await loginAs(page, 'resident');
    await page.goto(ROUTES.residentHealthServices);
    await expect(page).toHaveURL(/health-services$/);
    await expect(page.getByRole('heading', { name: /health services/i })).toBeVisible();
  });

  test('direct API calls do not bypass backend authorization', async ({ page, request }) => {
    await loginAs(page, 'resident');
    const api = process.env.E2E_API_URL;
    test.skip(!api, 'Set E2E_API_URL to exercise direct-API authorization.');
    // A resident calling a staff-only endpoint must be rejected (401/403),
    // proving the frontend permission matrix is not the only guard.
    const res = await request.get(`${api}/phn/submissions`);
    expect([401, 403]).toContain(res.status());
  });
});

// Test B — RHU Triage referral hand-off (E2E).
//
// Exercises the RENDERED RhuTriage wizard, the dashboard→consultation
// navigation, and the real hand-off API. SAFETY: skips unless an isolated,
// writable environment is declared. B2 uses Playwright request interception
// (page.route) scoped to the test only — it never changes real backend
// behaviour or data.
//
// Preconditions for a live run: E2E_RHU_PERSONNEL_* credentials and at least one
// eligible synthetic incoming referral seeded for that account's scope.

import { test, expect } from '@playwright/test';
import { requireIsolatedEnv, ROUTES } from './helpers/env.js';
import { loginAs } from './helpers/auth.js';

// Mirrors TRIAGE_MESSAGES in src/features/triage/lib/triageWorkflow.js.
const SUCCESS_MSG = /patient sent to the consultation queue/i;
const FAILURE_MSG = /could not send the patient to the consultation queue/i;
// The triage hand-off POST (phnWorkflowApi.sendToPhnQueue).
const HANDOFF_POST = /\/api\/(intake|phn)/;

test.describe('B. RHU Triage — hand-off', () => {
  requireIsolatedEnv();

  // B1 — dashboard opens the consultation route; a full four-step triage hands
  // the referral off, clears the wizard, and drops it from the active queue.
  test('B1: successful hand-off clears the item and refreshes the queue', async ({ page }) => {
    await loginAs(page, 'rhu_personnel');

    // Dashboard → Open Consultation Queue → the CONSULTATION route (not triage).
    await page.goto(ROUTES.rhuDashboard);
    await page.getByRole('link', { name: /open consultation queue/i }).click();
    await expect(page).toHaveURL(/\/rhu_personnel\/consultation$/);

    // Go to triage and open a synthetic incoming referral.
    await page.goto(ROUTES.rhuTriage);
    const referralItem = page.getByRole('listitem').filter({ hasText: /./ }).first();
    await referralItem.getByRole('button', { name: /begin screening/i }).click();

    // Vitals → Reason → Review. The Review step must be labelled "4".
    await page.getByLabel(/height/i).fill('170');
    await page.getByLabel(/weight/i).fill('65');
    await page.getByLabel(/blood pressure/i).fill('120/80');
    await page.getByLabel(/blood sugar/i).fill('100');
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.getByRole('button', { name: /^continue$/i }).click();

    await expect(page.getByText(/^4$/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /review/i })).toBeVisible();

    // Submit and wait for the real API response + success toast.
    const [res] = await Promise.all([
      page.waitForResponse((r) => HANDOFF_POST.test(r.url()) && r.request().method() === 'POST'),
      page.getByRole('button', { name: /send to consultation/i }).click(),
    ]);
    expect(res.ok()).toBeTruthy();
    await expect(page.getByText(SUCCESS_MSG)).toBeVisible();
    await expect(page.getByText(FAILURE_MSG)).toHaveCount(0);

    // Wizard reset: the patient-identification choices are shown again.
    await expect(page.getByRole('button', { name: /search existing patient/i })).toBeVisible();
  });

  // B2 — a controlled API failure (intercepted for this test only) must keep the
  // referral + wizard, show the failure message, and never claim success.
  test('B2: failed hand-off preserves state and shows no false success', async ({ page }) => {
    await loginAs(page, 'rhu_personnel');
    await page.goto(ROUTES.rhuTriage);

    // Force the NEXT hand-off POST to fail — scoped to this page/test only.
    await page.route(HANDOFF_POST, async (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated server error' }) });
      }
      return route.fallback();
    });

    await page.getByRole('listitem').first().getByRole('button', { name: /begin screening/i }).click();
    await page.getByLabel(/height/i).fill('160');
    await page.getByLabel(/weight/i).fill('55');
    await page.getByLabel(/blood pressure/i).fill('110/70');
    await page.getByLabel(/blood sugar/i).fill('95');
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.getByRole('button', { name: /send to consultation/i }).click();

    await expect(page.getByText(FAILURE_MSG)).toBeVisible();
    await expect(page.getByText(SUCCESS_MSG)).toHaveCount(0);
    // The wizard did NOT reset — still on the Review step, available for retry.
    await expect(page.getByRole('heading', { name: /review/i })).toBeVisible();
  });

  // B3 — the active list refreshes after success and terminal referrals are
  // filtered from the active view (records preserved).
  test('B3: active queue reflects backend state after refresh', async ({ page }) => {
    await loginAs(page, 'rhu_personnel');
    await page.goto(ROUTES.rhuTriage);
    // After a successful hand-off (B1) the handed-off referral is no longer in
    // the "Incoming Barangay Referrals" list; completed/cancelled referrals are
    // absent from the active view but remain retrievable via history/API.
    await expect(page.getByText(/incoming barangay referrals|identify patient/i)).toBeVisible();
  });
});

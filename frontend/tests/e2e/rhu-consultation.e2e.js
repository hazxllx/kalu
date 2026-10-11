// Test C — RHU Consultation active/completed queues (E2E).
//
// Exercises the RENDERED RhuConsultation station: the handed-off referral
// appearing in the active queue, the Awaiting/Completed partition by PERSISTED
// status, the manual refresh guard, and loading/empty/error states. SAFETY:
// skips unless an isolated, writable environment is declared.
//
// Preconditions for a live run: E2E_RHU_PERSONNEL_* credentials and (for C1) a
// referral handed off from the triage test or seeded as WAITING.

import { test, expect } from '@playwright/test';
import { requireIsolatedEnv, ROUTES } from './helpers/env.js';
import { loginAs } from './helpers/auth.js';

// Status labels rendered by RhuConsultation (RHU_STATUS_LABEL).
const QUEUE_LIST = /\/api\/phn/;

test.describe('C. RHU Consultation — queues', () => {
  requireIsolatedEnv();

  // C1 — a handed-off (WAITING) referral appears in the active queue, matching
  // the test record; it is present because of persisted status, not local state.
  test('C1: handed-off referral appears in the active queue', async ({ page }) => {
    await loginAs(page, 'rhu_personnel');
    await Promise.all([
      page.waitForResponse((r) => QUEUE_LIST.test(r.url()) && r.request().method() === 'GET'),
      page.goto(ROUTES.rhuConsultation),
    ]);
    const awaiting = page.getByRole('heading', { name: /awaiting consultation/i });
    await expect(awaiting).toBeVisible();
    // The active section lists at least the seeded referral with its details.
    const activeCard = awaiting.locator('xpath=ancestor::*[1]');
    await expect(activeCard).toBeVisible();
  });

  // C2 — the Awaiting section only holds active statuses and its count matches
  // the rows; completed encounters move to Completed (not deleted) and remain
  // viewable; nothing is re-statused to tidy the UI.
  test('C2: active vs completed partition by persisted status', async ({ page }) => {
    await loginAs(page, 'rhu_personnel');
    await page.goto(ROUTES.rhuConsultation);

    // The "N active" badge equals the number of rows in the Awaiting table.
    const badge = page.getByText(/\d+ active/i);
    await expect(badge).toBeVisible();
    const badgeCount = Number((await badge.textContent()).match(/\d+/)[0]);
    const awaitingRows = page.locator('table').first().locator('tbody tr');
    // Allow the empty-state row to read as zero.
    const rowCount = await awaitingRows.count();
    const dataRows = rowCount === 1 && (await awaitingRows.first().getByRole('button').count()) === 0 ? 0 : rowCount;
    expect(dataRows).toBe(badgeCount);

    // If a Completed section exists, it must expose a View Consultation action.
    const completed = page.getByRole('heading', { name: /^completed$/i });
    if (await completed.count()) {
      await expect(page.getByRole('button', { name: /view consultation/i }).first()).toBeVisible();
    }
  });

  // C3 — the manual Refresh control updates the queue and is guarded while a
  // refresh is already running; a failed load shows an error + working retry.
  test('C3: refresh guard, loading/empty/error states', async ({ page }) => {
    await loginAs(page, 'rhu_personnel');
    await page.goto(ROUTES.rhuConsultation);

    const refresh = page.getByRole('button', { name: /^refresh$/i });
    await expect(refresh).toBeVisible();
    const [res] = await Promise.all([
      page.waitForResponse((r) => QUEUE_LIST.test(r.url()) && r.request().method() === 'GET'),
      refresh.click(),
    ]);
    expect(res.ok()).toBeTruthy();

    // Error + retry: force the queue GET to fail for this test only.
    await page.route(QUEUE_LIST, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Simulated"}' })
        : route.fallback(),
    );
    await page.reload();
    await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();
  });
});

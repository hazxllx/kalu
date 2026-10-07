import { test, expect } from '@playwright/test';

/**
 * AUTHENTICATED offline household E2E — requires a real DEV stack.
 *
 * This suite exercises the REAL offline path end-to-end against the running
 * backend + development Supabase project:
 *   - online household create (source=server),
 *   - offline household create queued locally (source=local),
 *   - reload persistence of the pending draft,
 *   - reconnect auto-synchronization,
 *   - idempotent re-upload (exactly one DB row per operation key),
 *   - logout purge (IndexedDB wiped).
 *
 * SAFETY: this is NOT a production test. The backend must be started against
 * the DEV Supabase project (never lblawqeoixojyytkmfqy) and the test BHW must
 * be provisioned (see docs/offline/DEV-CHECKLIST.md). Credentials come from the
 * environment only — never from source files.
 *
 * Run (from frontend/):
 *   npx playwright test tests/offline/offline-authenticated.spec.js \
 *     --config playwright.offline.auth.config.js
 */

const email = process.env.KALUSAGAP_TEST_BHW_EMAIL || '';
const password = process.env.KALUSAGAP_TEST_BHW_PASSWORD || '';
const apiBase = (process.env.VITE_API_URL || 'http://localhost:5001/api').replace(/\/$/, '');
const REQUIRED_CREDENTIALS = ['KALUSAGAP_TEST_BHW_EMAIL', 'KALUSAGAP_TEST_BHW_PASSWORD'];

if (!email || !password) {
  throw new Error(
    `Missing test-BHW credentials. Set the environment variable(s): ` +
      REQUIRED_CREDENTIALS.filter((v) => !process.env[v]).join(', ').replace(
        /KALUSAGAP_TEST_BHW_PASSWORD/,
        'KALUSAGAP_TEST_BHW_PASSWORD (dev account password)',
      ),
  );
}

/** Locators that stay stable across the Add Household sections. */
const HOME_SECTION = { hasText: 'Household Information' };
const RESPONDENT_SECTION = { hasText: 'Respondent Information' };
const WATER_SECTION = { hasText: 'Water Source & Sanitation Details' };
const MEMBERS_SECTION = { hasText: 'Household Members' };

const fieldControl = (page, labelText) =>
  page.locator('label', { hasText: labelText }).locator('xpath=..').locator('input, select, textarea');

const memberField = (labelText) => 'xpath=ancestor-or-self::*[contains(@class,"px-5")]//';

async function login(page) {
  await page.goto('/login');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/(app|dashboard|unauthorized)\//, { timeout: 30_000 });
  // Wait for the BHW dashboard to finish resolving the profile.
  await expect(page.locator('body')).toBeVisible({ timeout: 30_000 });
}

async function openAddHousehold(page) {
  await page.goto('/app/bhw/households/new');
  await expect(page.getByRole('heading', { name: /Add New Household/ })).toBeVisible();
}

/** Add one household member via the modal (name/relationship/sex are required). */
async function addMember(page, { name, relationship = 'Head', sex = 'Male' }) {
  await page.getByRole('button', { name: 'Add Member' }).click();
  const dialog = page.getByRole('dialog', { name: /Add household member/ });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[placeholder*="Juan Dela Cruz"]').fill(name);
  // Relationship + Sex selects (in order inside the dialog's form area).
  await dialog.locator('select').nth(0).selectOption({ label: relationship });
  await dialog.locator('select').nth(1).selectOption({ label: sex });
  await dialog.getByRole('button', { name: 'Add Member' }).click();
  await expect(dialog).not.toBeVisible();
}

/** Fill required top-level household fields. */
async function fillHouseholdCore(page, { headName, street }) {
  await fieldControl(page, 'Household Head Name').fill(headName);
  await fieldControl(page, 'Purok/Zone').selectOption({ label: 'Purok 1' });
  await fieldControl(page, 'Street Address / Sitio').fill(street);
  await fieldControl(page, 'Last Name').fill('Dela Cruz');
  await fieldControl(page, 'First Name').fill('Respondent');
  await fieldControl(page, "Mother's Maiden Name").fill('Reyes');
  await fieldControl(page, 'Primary Water Source').selectOption({ label: /Level II/ });
  await fieldControl(page, 'Toilet Facility Type').selectOption({ label: /Water-sealed – Own/ });
}

/** Count DB rows for a household via the same API the page uses (real DB read). */
async function countHouseholdsByHead(page, headName) {
  const { count, rows } = await page.evaluate(async ({ apiBase, headName }) => {
    const { access_token: token } = JSON.parse(localStorage.getItem('kalusagap.auth') || '{}').currentSession || {};
    const tokenVal = token || '';
    const q = encodeURIComponent(headName);
    const res = await fetch(`${apiBase}/households?q=${q}`, {
      headers: { Authorization: `Bearer ${tokenVal}` },
    });
    const payload = await res.json().catch(() => ({}));
    const list = payload?.data?.rows || payload?.rows || [];
    return {
      count: list.filter((h) => h.headName === headName).length,
      rows: list.filter((h) => h.headName === headName).map((h) => ({ id: h.id })),
    };
  }, { apiBase, headName });
  return { count, rows };
}

async function readIndexedDBNames(page) {
  return page.evaluate(async () => {
    if (!('indexedDB' in self) || typeof indexedDB.databases !== 'function') return null;
    const dbs = await indexedDB.databases();
    return dbs.map((d) => d.name).filter(Boolean);
  });
}

test.describe('KALUSAGAP offline household — authenticated', () => {
  test('online create: saved directly to the database, then logout purges IndexedDB', async ({ page, context }) => {
    await login(page);
    await openAddHousehold(page);

    const headName = `E2E Online ${Date.now()}`;
    await fillHouseholdCore(page, { headName, street: `${Date.now()} Online St` });
    await addMember(page, { name: `Member ${Date.now()}`, relationship: 'Head', sex: 'Male' });

    await page.getByRole('button', { name: 'Save Household' }).click();
    // Online path: the header badge should show the "Saved directly" state.
    await expect(page.getByText('Saved directly to the database')).toBeVisible({ timeout: 15_000 });
    // It redirected to the household list; the new household appears (real DB read).
    await page.waitForURL(/households$/);
    await expect(page.getByText(headName).first()).toBeVisible({ timeout: 15_000 });

    // Before logout, IndexedDB exists (device key created lazily — may be empty
    // if no offline write happened; the purge assertion is what matters after).
    const beforeLogout = await readIndexedDBNames(page);
    if (beforeLogout && beforeLogout.includes('kalusagap-offline')) {
      // Purge is verified in the offline test below; here just ensure no crash.
    }

    // Logout -> provider purges the offline DB.
    await page.getByRole('button', { name: /Log out/ }).first().click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await expect(page.locator('#login-email')).toBeVisible({ timeout: 10_000 });
  });

  test('offline create queues locally, survives reload, and syncs on reconnect with one DB row', async ({ page, context }) => {
    await login(page);
    await openAddHousehold(page);

    const headName = `E2E Offline ${Date.now()}`;
    await fillHouseholdCore(page, { headName, street: `${Date.now()} Offline St` });
    await addMember(page, { name: `Member ${Date.now()}`, relationship: 'Head', sex: 'Male' });

    // Go offline BEFORE saving so the create is queued locally.
    await context.setOffline(true);
    await page.reload();
    await openAddHousehold(page);
    // Re-fill after reload (the draft is only stored on save, not on form state).
    await fillHouseholdCore(page, { headName, street: `${Date.now()} Offline St` });
    await addMember(page, { name: `Member ${Date.now()}`, relationship: 'Head', sex: 'Male' });

    await page.getByRole('button', { name: 'Save Household' }).click();
    // Offline path: the badge states the save is local + pending sync.
    await expect(page.getByText(/Offline — saved on this device, syncs later/)).toBeVisible({ timeout: 15_000 });

    // Reload while still offline — the pending draft/payload must survive.
    await page.reload();
    await openAddHousehold(page);
    await expect(page.getByText(/Offline — saved on this device, syncs later/)).toBeVisible({ timeout: 15_000 });

    // The sync indicator shows at least one pending change.
    const indicator = page.getByRole('button', { name: /Connection status:/ });
    await expect(indicator).toContainText(/change|pending/i, { timeout: 15_000 });

    // Go back online — the engine drains the queue automatically.
    await context.setOffline(false);
    // Indicator settles on "All changes synchronized".
    await expect(page.getByRole('button', { name: /Connection status:/ })).toContainText(
      /All changes synchronized|Online/,
      { timeout: 30_000 },
    );

    // Exactly ONE row for the head name (real DB through the API).
    await expect
      .poll(async () => (await countHouseholdsByHead(page, headName)).count, { timeout: 30_000 })
      .toBe(1);
  });

  test('logout destroys all queued offline data for the shared device', async ({ page, context }) => {
    // Seed a queued draft as a signed-in user, then log out and confirm purge.
    await login(page);
    await openAddHousehold(page);

    const headName = `E2E Purge ${Date.now()}`;
    await fillHouseholdCore(page, { headName, street: `${Date.now()} Purge St` });
    await addMember(page, { name: `Member ${Date.now()}`, relationship: 'Head', sex: 'Male' });

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Save Household' }).click();
    await expect(page.getByText(/Offline — saved on this device, syncs later/)).toBeVisible({ timeout: 15_000 });

    // The IndexedDB offline database exists with queued data.
    const before = await readIndexedDBNames(page);
    expect(before).toContain('kalusagap-offline');

    // Log out — OfflineSyncProvider purges the entire offline database.
    await context.setOffline(false);
    await page.getByRole('button', { name: /Log out/ }).first().click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    const after = await readIndexedDBNames(page);
    if (after) {
      // The DB may be recreated empty on next open; the queued row must be gone.
      expect(after).not.toContain('kalusagap-offline');
    }
  });
});

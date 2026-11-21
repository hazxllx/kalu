import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

// Production UI, synthetic account/service boundaries, and no network access.
test.use({ channel: process.env.KFT038_BROWSER_CHANNEL || undefined, video: 'off' });
const frontend = fileURLToPath(new URL('../../', import.meta.url));
const purpose = 'Follow-up for a resident with detailed care instructions';
const facilityName = 'Synthetic Barangay Health Center with a long facility location';
const service = {
  id: 'synthetic-service', name: 'Community Health Assessment and Nutrition Service',
  description: 'Eligibility, schedule, and instructions for synthetic residents. '.repeat(8),
  facilityName, availability: { open: true }, weekdays: [1, 3, 5],
  windowStart: '08:00', windowEnd: '17:00',
  pubmatUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="125"%3E%3C/svg%3E',
  memo: { url: 'https://synthetic.invalid/memo', filename: 'Synthetic memorandum', mimeType: 'text/plain' },
};
const followUp = {
  id: 'synthetic-followup', purpose, scheduledDate: '2099-11-20', scheduledTime: '09:00',
  location: facilityName, assignedProvider: 'Synthetic BHW', status: 'Scheduled',
  confirmationStatus: 'Awaiting Confirmation', requiresResidentResponse: true,
  instructions: `Bring your health record. ${'LongReference'.repeat(20)}`,
};
let script;
let css;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  const cssPath = fileURLToPath(new URL('../../src/styles/index.css', import.meta.url));
  const mocks = {
    '@/context/AuthContext': `export const useAuth = () => ({ user: { id: 'synthetic-resident', name: 'Synthetic Resident', role: 'resident', barangay: 'Synthetic Barangay' } });`,
    '@/services/api': `
      let row = ${JSON.stringify(followUp)};
      let scheduleRequests = [];
      export const residentFollowUpsApi = {
        list: async () => {
          if (window.failFirstFollowUpLoad && !window.followUpLoadFailedOnce) {
            window.followUpLoadFailedOnce = true;
            throw Error('Synthetic API outage');
          }
          return { rows: window.emptyFollowUps ? [] : [row], referrals: [], scheduleRequests };
        },
        request: async request => {
          window.scheduleRequest = request;
          scheduleRequests = [{ follow_up_id: request.targetId, request_type: request.requestType, status: 'Pending Approval', reason: request.reason }];
          row = { ...row, scheduleResponseStatus: request.requestType === 'attendance' ? 'Attendance Confirmed' : 'Cancellation Requested', confirmationStatus: request.requestType === 'attendance' ? 'Confirmed' : 'Cancellation Requested' };
          return scheduleRequests[0];
        },
      };
      export const visitPlansApi = {
        directory: async () => ({ facilities: [{ type: 'BHC', name: 'Synthetic Barangay', services: [${JSON.stringify(service)}] }] }),
        availability: async () => ({ availability: { dates: Array.from({ length: 14 }, (_, index) => ({ date: '2099-11-' + (index + 10) })) } }),
        create: async payload => { window.registration = payload; if (window.failRegistration) throw Error('Synthetic registration validation message'); return { plan: { id: 'synthetic-plan', ...payload } }; },
        remove: async id => { window.cancelled = id; },
      };`,
  };
  const [bundle, styles] = await Promise.all([
    build({ absWorkingDir: frontend, bundle: true, write: false, minify: true,
      tsconfig: fileURLToPath(new URL('../../jsconfig.json', import.meta.url)),
      stdin: { resolveDir: frontend, loader: 'jsx', contents: `
        import React from 'react'; import { createRoot } from 'react-dom/client';
        import Services from './src/features/health-services/pages/ResidentHealthServices.jsx';
        import Reminders from './src/features/follow-ups/pages/ResidentFollowUps.jsx';
        const root = createRoot(document.getElementById('root'));
        window.mount = screen => root.render(screen === 'services' ? <Services /> : <Reminders />);` },
      plugins: [{ name: 'synthetic-services', setup(builder) {
        builder.onResolve({ filter: /^@\// }, ({ path }) => Object.hasOwn(mocks, path) ? { path, namespace: 'synthetic' } : null);
        builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, ({ path }) => ({ contents: mocks[path], loader: 'jsx', resolveDir: frontend }));
      } }],
    }),
    postcss([tailwindcss(fileURLToPath(new URL('../../tailwind.config.js', import.meta.url)))])
      .process((await readFile(cssPath, 'utf8')).replace(/^@import .+;$/gm, ''), { from: cssPath }),
  ]);
  script = bundle.outputFiles[0].text;
  css = styles.css;
});

async function mount(page, screen, { failFirstFollowUpLoad = false, emptyFollowUps = false } = {}) {
  await page.route('**/*', route => route.abort());
  await page.setContent('<div class="lg:pl-72"><main class="app-main px-3 py-5 md:px-8"><div id="root"></div></main></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await page.evaluate(({ screen: target, failFirstFollowUpLoad: shouldFail, empty }) => {
    window.failFirstFollowUpLoad = shouldFail;
    window.emptyFollowUps = empty;
    window.mount(target);
  }, { screen, failFirstFollowUpLoad, empty: emptyFollowUps });
}

async function fits(page, locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locator) {
    const bounds = await locator.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
  }
}

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('service filters, registration validation, date selection, input and cancellation', async ({ page }) => {
      await mount(page, 'services');
      await expect(page.getByRole('heading', { name: service.name })).toBeVisible();
      await fits(page);
      await page.getByRole('button', { name: `Enlarge ${service.name} publication material` }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await fits(page, page.getByRole('dialog').locator('.relative'));
      await page.getByRole('button', { name: 'Close image preview' }).click();
      await expect(page.getByRole('button', { name: /View memorandum/ })).toBeHidden();
      await page.getByRole('button', { name: 'View details', exact: true }).click();
      await page.getByRole('button', { name: /View memorandum/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByLabel('Availability', { exact: true }).selectOption('closed');
      await expect(page.getByText('No services match these filters.')).toBeVisible();
      await page.getByLabel('Availability', { exact: true }).selectOption('open');
      await page.getByLabel('Facility', { exact: true }).selectOption('rhu');
      await expect(page.getByText('No services match these filters.')).toBeVisible();
      await page.getByLabel('Facility', { exact: true }).selectOption('bhc');
      await page.getByRole('button', { name: 'View details', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Show less', exact: true })).toBeVisible();
      await fits(page);
      await page.getByRole('button', { name: 'Show less', exact: true }).click();
      await expect(page.getByRole('button', { name: /View memorandum/ })).toBeHidden();
      await page.getByRole('button', { name: 'Register', exact: true }).click();
      let dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('button', { name: 'Confirm Registration' })).toBeEnabled();
      await fits(page, dialog.locator('.ui-card'));
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await page.getByRole('button', { name: 'Register', exact: true }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { pressed: false }).filter({ hasText: '23 Nov' }).click();
      await dialog.getByLabel(/Note/).fill('Bringing my synthetic health record');
      await page.evaluate(() => { window.failRegistration = true; });
      await dialog.getByRole('button', { name: 'Confirm Registration' }).click();
      await expect(dialog.getByText('Synthetic registration validation message')).toBeVisible();
      await page.evaluate(() => { window.failRegistration = false; });
      await dialog.getByRole('button', { name: 'Confirm Registration' }).click();
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => window.registration)).toEqual({ serviceId: service.id, plannedDate: '2099-11-23', note: 'Bringing my synthetic health record' });
      await page.getByRole('button', { name: 'Cancel registration', exact: true }).click();
      await page.getByRole('button', { name: 'Keep registration' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: 'Cancel registration', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel registration', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Register', exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.cancelled)).toBe('synthetic-plan');
      await fits(page);
    });

    test('follow-up details, close, cancellation reason and schedule request', async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await mount(page, 'reminders');
      await page.getByRole('button', { name: purpose }).click();
      const dialog = page.getByRole('dialog', { name: 'Follow-up Details' });
      await expect(dialog).toContainText(followUp.instructions);
      await expect(dialog).toContainText(followUp.location);
      await expect(dialog).toContainText('9:00 AM');
      await fits(page, dialog.locator('.ui-card'));
      await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
      await expect(dialog).toHaveCount(0);
      await page.getByRole('button', { name: 'Request Cancellation', exact: true }).click();
      const cancellation = page.getByRole('dialog', { name: 'Request Cancellation', exact: true });
      await expect(cancellation.getByRole('button', { name: 'Send Request' })).toBeDisabled();
      await cancellation.getByLabel('Reason').fill('Synthetic scheduling conflict');
      await cancellation.getByRole('button', { name: 'Send Request' }).click();
      await expect(cancellation).toHaveCount(0);
      expect(await page.evaluate(() => window.scheduleRequest)).toEqual({
        targetType: 'follow_up', targetId: followUp.id, requestType: 'cancellation',
        proposedSchedule: null, reason: 'Synthetic scheduling conflict',
      });
      await expect(page.getByText(/Schedule request pending staff review/)).toBeVisible();
      expect(pageErrors).toEqual([]);
      await fits(page);
    });

    test('attendance confirmation submits through the schedule-request workflow', async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await mount(page, 'reminders');
      await page.getByRole('button', { name: 'Confirm Attendance', exact: true }).click();
      expect(await page.evaluate(() => window.scheduleRequest)).toEqual({
        targetType: 'follow_up', targetId: followUp.id, requestType: 'attendance',
        proposedSchedule: null, reason: '',
      });
      await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
      expect(pageErrors).toEqual([]);
      await fits(page);
    });
  });
}

test('follow-ups show a friendly retry state and a real empty state', async ({ page }) => {
  await mount(page, 'reminders', { failFirstFollowUpLoad: true });
  await expect(page.getByText("We couldn't load your follow-ups. Check your connection and try again.")).toBeVisible();
  await page.getByRole('button', { name: 'Try Again' }).click();
  await expect(page.getByRole('button', { name: purpose })).toBeVisible();
});

test('follow-ups show a clear empty state when the API returns no records', async ({ page }) => {
  await mount(page, 'reminders', { emptyFollowUps: true });
  await expect(page.getByText('No follow-ups scheduled yet.')).toBeVisible();
});

test('registration footer stays reachable with a reduced mobile viewport height', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 440 });
  await mount(page, 'services');
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Confirm Registration' })).toBeEnabled();
  await fits(page, dialog.locator('.ui-card'));
  await dialog.getByLabel(/Note/).fill('Short viewport input');
  await dialog.getByRole('button', { name: 'Confirm Registration' }).click();
  await expect(dialog).toHaveCount(0);
});

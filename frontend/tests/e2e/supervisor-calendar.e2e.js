import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

test.use({ video: 'off', serviceWorkers: 'block' });

const frontend = fileURLToPath(new URL('../../', import.meta.url));
const permissions = ['followups.view', 'services.view', 'followups.create', 'followups.edit', 'followups.complete'];
const records = {
  followups: [{ id: 'followup-one', residentName: 'Test Resident', barangay: 'San Isidro',
    scheduled_date: '2026-11-21', scheduled_time: '08:30', purpose: 'Blood pressure follow-up',
    assigned_provider: 'Nurse Test', status: 'Scheduled', resident_decision: 'approved', revision: 3,
    location: 'Barangay Health Center', notes: 'Existing follow-up instructions.' }],
  services: [{ id: 'attendance-one', resident: 'Test Second Resident', residentBarangay: 'San Isidro',
    scheduled_date: '2026-11-21', attendance_status: 'Attended', recorded_by_name: 'Nurse Test',
    service: { id: 'service-one', name: 'Nutritional assessment', category: 'Nutrition' } }],
  activities: [{ id: 'activity-one', title: 'Clinic team meeting', activity_type: 'Meeting',
    activity_date: '2026-11-21', activity_time: '10:00', notes: 'Review the clinic schedule.', resident_id: null }],
  residents: [{ id: 'resident-one', firstName: 'Test', lastName: 'Resident', barangay: 'San Isidro' }],
};

// Render the real calendar, forms, dialogs, utilities and styles. Only external
// data boundaries are isolated; no request or mutation can reach a live service.
const modules = {
  '@/context/AuthContext': `export const useAuth = () => ({ user: window.calendarTest.user });`,
  '@/context/PermissionsContext': `export const usePermissions = () => ({ can: key => window.calendarTest.permissions.includes(key) });`,
  '@/hooks/useSyncStatus': `export const useSyncStatus = () => ({ lastSyncedAt: null });`,
  '@/services/api': `
    export const healthServicesApi = { listAttendance: params => window.calendarTest.read('services', params) };
    async function save(id, payload) {
      const state = window.calendarTest;
      state.writes.push({ operation: id ? 'update' : 'create', id, payload });
      if (state.holdSave) await new Promise(resolve => { state.releaseSave = resolve; });
      if (state.saveError) throw new Error(state.saveError);
      const record = { id: id || 'activity-created', title: payload.title, activity_type: payload.activityType,
        activity_date: payload.date, activity_time: payload.time, notes: payload.notes, resident_id: payload.residentId };
      state.records.activities = [...state.records.activities.filter(row => row.id !== record.id), record];
      return { record };
    }
    export const calendarActivitiesApi = {
      list: params => window.calendarTest.read('activities', params),
      create: payload => save(null, payload), update: save,
      async remove(id) {
        window.calendarTest.writes.push({ operation: 'delete', id });
        window.calendarTest.records.activities = window.calendarTest.records.activities.filter(row => row.id !== id);
      },
    };`,
  '@/services/offline/followUpOfflineService': `
    export async function listFollowUpsOffline({ params, onSource }) {
      const result = await window.calendarTest.read('followups', params);
      onSource?.({ source: window.calendarTest.cached ? 'cache' : 'server', error: '' });
      return result.rows;
    }
    export const listFollowUpResidentsOffline = () => window.calendarTest.read('residents');
    export async function updateFollowUpOffline({ followUpId, record }) {
      const state = window.calendarTest;
      state.writes.push({ operation: 'update-followup', id: followUpId, payload: record });
      const row = state.records.followups.find(row => row.id === followUpId);
      Object.assign(row, record, { revision: row.revision + 1 });
      return { record: row };
    }
    export async function createFollowUpOffline({ record }) {
      window.calendarTest.writes.push({ operation: 'create-followup', payload: record });
      throw new Error('Unexpected follow-up creation in this UI test.');
    }`,
};

let script, stylesheet;
const runtimeErrors = new WeakMap();

test.beforeAll(async () => {
  const cssUrl = new URL('../../src/styles/index.css', import.meta.url);
  const [bundle, compiled] = await Promise.all([
    build({
      absWorkingDir: frontend, bundle: true, write: false, minify: true,
      tsconfig: fileURLToPath(new URL('../../jsconfig.json', import.meta.url)),
      stdin: { resolveDir: frontend, loader: 'jsx', contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { MemoryRouter } from 'react-router-dom';
        import Calendar from './src/features/follow-ups/pages/FollowUpCalendar.jsx';
        createRoot(document.getElementById('root')).render(<MemoryRouter><Calendar /></MemoryRouter>);` },
      plugins: [{ name: 'calendar-test-boundaries', setup(builder) {
        builder.onResolve({ filter: /^@\// }, ({ path }) => Object.hasOwn(modules, path) ? { path, namespace: 'calendar-test' } : null);
        builder.onLoad({ filter: /.*/, namespace: 'calendar-test' }, ({ path }) => ({ contents: modules[path], loader: 'jsx', resolveDir: frontend }));
      } }],
    }),
    postcss([tailwindcss(fileURLToPath(new URL('../../tailwind.config.js', import.meta.url)))])
      .process((await readFile(cssUrl, 'utf8')).replace(/^@import .+;$/gm, ''), { from: fileURLToPath(cssUrl) }),
  ]);
  script = bundle.outputFiles[0].text;
  stylesheet = compiled.css;
});

test.beforeEach(({ page }) => {
  const errors = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(({ page }) => { expect(runtimeErrors.get(page)).toEqual([]); });

async function mount(page, options = {}) {
  await page.setViewportSize({ width: options.width || 1366, height: 900 });
  await page.clock.setFixedTime(new Date('2026-11-21T08:00:00+08:00'));
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div class="supervisor-shell lg:pl-64"><main class="p-3 sm:p-5"><div id="root"></div></main></div>');
  await page.addStyleTag({ content: stylesheet });
  await page.evaluate(({ records, permissions, options }) => {
    const state = window.calendarTest = {
      records, permissions, user: { id: 'test-supervisor', role: 'health_supervisor', barangay: 'San Isidro' },
      errors: {}, holds: {}, releases: {}, reads: [], writes: [], cached: false, ...options,
    };
    state.read = async (source, params) => {
      state.reads.push({ source, params });
      if (state.holds[source]) await new Promise(resolve => { state.releases[source] = resolve; });
      if (state.errors[source]) throw new Error('Test source unavailable.');
      return { rows: structuredClone(state.records[source]).filter(row => {
        const date = row.scheduled_date || row.activity_date;
        return !params?.from || !date || date >= params.from && date <= params.to;
      }) };
    };
  }, { records, permissions, options });
  await page.addScriptTag({ content: script });
  return page.getByRole('region', { name: 'Selected date activities', exact: true });
}

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`selected-date panel stays compact and readable at ${width}px`, async ({ page }, testInfo) => {
    const panel = await mount(page, { width });
    await expect(panel.getByText('3 activities', { exact: true })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'November 21, 2026', exact: true })).toBeVisible();
    await expect(panel.getByRole('listitem')).toHaveCount(3);
    await expect(panel.getByText('Test Resident', { exact: true })).toBeVisible();
    await expect(panel.getByText('Provider: Nurse Test', { exact: true })).toBeVisible();
    await expect(panel.getByText('8:30 AM', { exact: true })).toBeVisible();
    await expect(panel.getByText('Time not specified')).toHaveCount(0);
    const add = panel.locator('header').getByRole('button', { name: 'Add Activity' });
    const addBox = await add.boundingBox();
    expect(addBox.height).toBeLessThanOrEqual(34);
    expect(addBox.width).toBeLessThan(140);
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.locator('.supervisor-calendar').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await panel.getByRole('listitem').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth))).toBe(true);
    if (width >= 1024) {
      const calendarBox = await page.getByRole('region', { name: 'Month calendar', exact: true }).boundingBox();
      const panelBox = await panel.boundingBox();
      expect(panelBox.y).toBeCloseTo(calendarBox.y, 0);
      expect(panelBox.height).toBeLessThan(calendarBox.height);
      expect(calendarBox.width / (calendarBox.width + panelBox.width)).toBeCloseTo(0.6875, 2);
      expect(panelBox.x).toBeGreaterThan(calendarBox.x + calendarBox.width);
      expect(panelBox.y).toBeLessThan(500);
      expect(calendarBox.height).toBeLessThan(550);
    } else {
      const calendarBox = await page.getByRole('region', { name: 'Month calendar', exact: true }).boundingBox();
      expect((await panel.boundingBox()).y).toBeGreaterThanOrEqual(calendarBox.y + calendarBox.height);
    }
    await expect(panel.getByRole('button', { name: 'Add Activity', exact: true })).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Schedule Calendar header' }).getByRole('button')).toHaveCount(0);
    await panel.screenshot({ path: testInfo.outputPath('selected-date.png') });
    await page.screenshot({ path: testInfo.outputPath('calendar-layout.png'), fullPage: true });
    await add.click();
    const form = page.getByRole('dialog', { name: 'Add Activity', exact: true });
    await expect(form.getByLabel(/Activity title/)).toBeFocused();
    expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await form.screenshot({ path: testInfo.outputPath('activity-form.png') });
    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
  });
}

test('empty dates and active filters have distinct, actionable states', async ({ page }, testInfo) => {
  const panel = await mount(page);
  await expect(panel.getByText('3 activities', { exact: true })).toBeVisible();
  await page.getByLabel('Selected date', { exact: true }).fill('2026-11-22');
  await expect(panel.getByRole('heading', { name: 'Nothing scheduled' })).toBeVisible();
  await expect(panel.getByText('Activities added for this date will appear here.')).toBeVisible();
  await expect(panel.getByText('0 activities', { exact: true })).toBeVisible();
  expect((await panel.boundingBox()).height).toBeLessThan(330);
  await panel.screenshot({ path: testInfo.outputPath('empty-date.png') });
  await panel.getByRole('button', { name: 'Add Activity' }).last().click();
  const form = page.getByRole('dialog', { name: 'Add Activity', exact: true });
  await expect(form.getByLabel('Date', { exact: false })).toHaveValue('2026-11-22');
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByLabel('Search activities', { exact: true }).fill('no matching title');
  await expect(panel.getByRole('heading', { name: 'No matching activities' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Nothing scheduled' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('type:follow-up');
  await expect(panel.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Completed');
  await expect(panel.getByRole('heading', { name: 'No matching activities' })).toBeVisible();
  await panel.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('combobox', { name: 'Follow-up provider', exact: true }).selectOption('Nurse Test');
  await expect(panel.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'December 21, 2026' })).toBeVisible();
  await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(3);
});

test('incomplete and cached dates never claim to be empty', async ({ page }) => {
  const panel = await mount(page, { errors: { followups: true, services: true, activities: true } });
  await expect(panel.getByText('Some activities could not be loaded.')).toBeVisible();
  await expect(panel.getByText('Not verified', { exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Nothing scheduled' })).toHaveCount(0);
  await page.evaluate(() => { window.calendarTest.errors = {}; });
  await panel.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(3);
  await expect(panel.getByText('Some activities could not be loaded.')).toHaveCount(0);
  await page.evaluate(() => { window.calendarTest.cached = true; window.dispatchEvent(new Event('online')); });
  await expect(panel.getByText('Showing saved activities. Retry to verify this date.')).toBeVisible();
  await page.getByLabel('Selected date', { exact: true }).fill('2026-11-22');
  await expect(panel.getByText('Not verified', { exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Nothing scheduled' })).toHaveCount(0);
});

for (const source of ['followups', 'services', 'activities']) {
  test(`${source} refresh failures and retries retain retrieved activities`, async ({ page }) => {
    const panel = await mount(page);
    await expect(panel.getByText('3 activities', { exact: true })).toBeVisible();
    await page.evaluate(source => {
      window.calendarTest.holds[source] = true;
      window.dispatchEvent(new Event('online'));
    }, source);
    await expect.poll(() => page.evaluate(source => Boolean(window.calendarTest.releases[source]), source)).toBe(true);
    await expect(panel.getByRole('listitem')).toHaveCount(3);
    await expect(panel.getByText('Loading activities...', { exact: true })).toBeVisible();
    await page.evaluate(source => {
      const state = window.calendarTest;
      state.errors[source] = true;
      state.holds[source] = false;
      state.releases[source]();
      delete state.releases[source];
    }, source);
    await expect(panel.getByText('Some activities could not be loaded.')).toBeVisible();
    await expect(panel.getByText('3 activities loaded', { exact: true })).toBeVisible();
    await expect(panel.getByRole('listitem')).toHaveCount(3);
    await page.evaluate(source => { window.calendarTest.holds[source] = true; }, source);
    await panel.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Retry', exact: true })).toBeDisabled();
    await expect(panel.getByRole('listitem')).toHaveCount(3);
    await expect.poll(() => page.evaluate(source => Boolean(window.calendarTest.releases[source]), source)).toBe(true);
    await page.evaluate(source => {
      const state = window.calendarTest;
      state.errors[source] = false;
      state.holds[source] = false;
      state.releases[source]();
    }, source);
    await expect(panel.getByText('3 activities', { exact: true })).toBeVisible();
    await expect(panel.getByText('Some activities could not be loaded.')).toHaveCount(0);
  });
}

test('activity form preserves validation, save, details, edit and confirmed delete', async ({ page }) => {
  const panel = await mount(page);
  await panel.locator('header').getByRole('button', { name: 'Add Activity' }).click();
  let form = page.getByRole('dialog', { name: 'Add Activity', exact: true });
  await form.getByRole('button', { name: 'Save Activity', exact: true }).click();
  await expect(form.getByText('Activity title is required.')).toBeVisible();
  await expect(form.getByLabel(/Activity title/)).toHaveAttribute('maxlength', '120');
  await expect(form.getByLabel('Notes / description')).toHaveAttribute('maxlength', '2000');
  await form.getByLabel(/Activity title/).fill('Test field visit');
  await form.getByLabel(/Activity type/).selectOption('Field Visit');
  await form.getByLabel('Time (optional)').fill('14:15');
  await expect(form.getByLabel('Linked resident (optional)')).toBeEnabled();
  await form.getByLabel('Linked resident (optional)').selectOption('resident-one');
  await form.getByLabel('Notes / description').fill('Bring the existing follow-up record.');
  await page.evaluate(() => { window.calendarTest.holdSave = true; });
  await form.getByRole('button', { name: 'Save Activity', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Saving...', exact: true })).toBeDisabled();
  await expect(form.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(form).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.calendarTest.releaseSave))).toBe(true);
  await page.evaluate(() => { window.calendarTest.holdSave = false; window.calendarTest.releaseSave(); });
  await expect(form).toHaveCount(0);
  await expect(panel.getByRole('listitem')).toHaveCount(4);
  expect(await page.evaluate(() => window.calendarTest.writes[0].payload)).toEqual({
    title: 'Test field visit', activityType: 'Field Visit', date: '2026-11-21', time: '14:15',
    notes: 'Bring the existing follow-up record.', residentId: 'resident-one',
  });
  await panel.getByRole('button', { name: /View Personal activity: Test field visit/ }).click();
  let details = page.getByRole('dialog', { name: 'Test field visit', exact: true });
  await expect(details.getByText('Bring the existing follow-up record.')).toBeVisible();
  await expect(details.getByText('Test Resident', { exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Edit', exact: true }).click();
  form = page.getByRole('dialog', { name: 'Edit activity', exact: true });
  await expect(form.getByLabel(/Activity title/)).toHaveValue('Test field visit');
  await form.getByLabel(/Activity title/).fill('Updated field visit');
  await form.getByRole('button', { name: 'Save Activity', exact: true }).click();
  await expect(form).toHaveCount(0);
  await panel.getByRole('button', { name: /View Personal activity: Updated field visit/ }).click();
  details = page.getByRole('dialog', { name: 'Updated field visit', exact: true });
  page.once('dialog', dialog => dialog.accept());
  await details.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(details).toHaveCount(0);
  await expect(panel.getByRole('listitem')).toHaveCount(3);
  expect(await page.evaluate(() => window.calendarTest.writes.map(write => write.operation))).toEqual(['create', 'update', 'delete']);
});

test('a failed resident directory does not prevent saving an unlinked activity', async ({ page }) => {
  const panel = await mount(page, { errors: { residents: true } });
  await panel.locator('header').getByRole('button', { name: 'Add Activity' }).click();
  const form = page.getByRole('dialog', { name: 'Add Activity', exact: true });
  await expect(form.getByLabel('Linked resident (optional)')).toBeDisabled();
  await form.getByLabel(/Activity title/).fill('Unlinked reminder');
  await page.evaluate(() => { window.calendarTest.saveError = 'Save unavailable. Please retry.'; });
  await form.getByRole('button', { name: 'Save Activity', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('Save unavailable. Please retry.');
  await expect(form.getByLabel(/Activity title/)).toHaveValue('Unlinked reminder');
  await page.evaluate(() => { window.calendarTest.saveError = ''; });
  await form.getByRole('button', { name: 'Save Activity', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /View Personal activity: Unlinked reminder/ })).toBeVisible();
});

test('clinical details keep their existing edit permissions and revision-bound save', async ({ page }) => {
  const panel = await mount(page);
  await panel.getByRole('button', { name: /View Follow-up: Blood pressure follow-up/ }).click();
  const details = page.getByRole('dialog', { name: 'Blood pressure follow-up', exact: true });
  await expect(details.getByText('Existing follow-up instructions.')).toBeVisible();
  await details.getByRole('button', { name: 'Edit / reschedule', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Edit / reschedule follow-up', exact: true });
  await expect(form.getByLabel(/Purpose/)).toHaveValue('Blood pressure follow-up');
  await form.getByLabel(/Purpose/).fill('Updated follow-up purpose');
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /View Follow-up: Updated follow-up purpose/ })).toBeVisible();
  expect(await page.evaluate(() => window.calendarTest.writes[0].payload.expected_revision)).toBe(3);
});

test('view-only clinical permissions do not expose clinical mutations', async ({ page }) => {
  const panel = await mount(page, { permissions: ['followups.view', 'services.view'] });
  await expect(page.getByRole('button', { name: 'Schedule follow-up', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: /View Follow-up: Blood pressure follow-up/ }).click();
  const details = page.getByRole('dialog', { name: 'Blood pressure follow-up', exact: true });
  await expect(details.getByRole('button')).toHaveCount(2);
  await details.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(panel.locator('header').getByRole('button', { name: 'Add Activity' })).toBeVisible();
});

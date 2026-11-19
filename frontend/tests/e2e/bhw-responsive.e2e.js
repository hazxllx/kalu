import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

test.use({ video: 'off' });

const frontend = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'http://bhw-fixture.test';
const householdPath = '/app/bhw/households';
const longName = 'SyntheticHouseholdHead'.repeat(5);
const address = 'SyntheticSitioAddress'.repeat(8);
const member = { id: 'member-1', name: 'SyntheticMember'.repeat(7), relationship: 'Head', sex: 'Female', age: 30 };
const household = {
  id: 'HH-001', headName: longName, streetAddress: address, purok: 'Purok 1', barangay: 'Fixture Barangay',
  collectorName: 'SyntheticAssignedCollector'.repeat(5), families: 1, memberCount: 1, members: [member],
  hhStatus: 'Active', riskLevel: 'Low', verificationStatus: 'Returned for Correction',
};
const fixtureModules = {
  '@/context/AuthContext': `export const useAuth = () => ({ user: { id: 'bhw-fixture', role: 'bhw', barangay: 'Fixture Barangay' } });`,
  '@/context/PermissionsContext': `const can = key => ['households.view', 'households.create', 'residents.profile.view'].includes(key); export const usePermissions = () => ({ can, canAny: keys => keys.some(can) });`,
  '@/hooks/useSyncStatus': `export const useSyncStatus = () => ({ online: true });`,
  '@/hooks/useHouseholdWorkers': `export default function useHouseholdWorkers() { throw Error('Unexpected risk workflow'); }`,
  '@/services/api/householdRiskApi': `export const householdRiskApi = { getWorkflow() { throw Error('Unexpected risk workflow'); } };`,
  '@/services/api/householdsApi': `
    const household = ${JSON.stringify(household)};
    const empty = async () => ({ rows: [] });
    const visits = [{ id: 'visit-1', visitNumber: 1, visitDate: '2025-01-01', visitReason: 'Initial Profiling', profileSnapshot: household, recordedByName: household.collectorName }];
    export const householdsApi = {
      list: empty, searchResidents: empty,
      get: async () => ({ household }), listVisits: async () => ({ visits }),
      getMemberHealth: async () => ({ profile: { heightCm: 160, weightKg: 60 } }),
      monitoringSummary: async () => ({ totalHouseholds: 2, visitedHouseholds: 1, householdsWithoutVisits: 1,
        zones: [{ purok: household.purok, total: 2, visited: 1, notVisited: 1, households: [{ id: household.id, latestVisitDate: '2025-01-01', latestVisitNumber: 1 }] }] }),
      async createVisit(id, payload) {
        window.visitWrites.push({ id, ...payload });
        visits.unshift({ id: 'visit-' + (visits.length + 1), visitNumber: visits.length + 1, ...payload });
      },
    };`,
  '@/services/api': `export { householdsApi } from '@/services/api/householdsApi'; export const intakeApi = { searchResidents: async () => [] };`,
  '@/services/offline/householdOfflineService': `
    import { householdsApi } from '@/services/api/householdsApi';
    export const getHouseholdOffline = async () => (await householdsApi.get()).household;
    export const listHouseholdsOffline = async ({ params }) => {
      const household = await getHouseholdOffline();
      window.householdSearch = params.q;
      const rows = [household, { ...household, id: 'HH-002', headName: 'Second Synthetic Head' }]
        .filter(row => !params.q || row.headName.toLowerCase().includes(params.q.toLowerCase()));
      return { rows, total: rows.length };
    };
    export const createHouseholdOffline = async ({ payload }) => {
      window.initialProfile = payload;
      return { household: { id: 'HH-003' } };
    };
    export const updateHouseholdOffline = () => { throw Error('Unexpected household update'); };
    export const saveMemberMeasurementsOffline = () => { throw Error('Unexpected measurement write'); };`,
};

let fixture;
let stylesheet;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  const cssUrl = new URL('../../src/styles/index.css', import.meta.url);
  const css = await readFile(cssUrl, 'utf8');
  const [bundle, compiled] = await Promise.all([
    build({
      absWorkingDir: frontend, bundle: true, write: false, minify: true,
      tsconfig: fileURLToPath(new URL('../../jsconfig.json', import.meta.url)),
      stdin: { resolveDir: frontend, loader: 'jsx', contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { BrowserRouter, Routes, Route } from 'react-router-dom';
        import Households from './src/features/households/pages/Households.jsx';
        import AddHousehold from './src/features/households/pages/AddHouseholdPage.jsx';
        import EditHousehold from './src/features/households/pages/EditHouseholdPage.jsx';
        import HouseholdDetail from './src/features/households/pages/HouseholdRiskDetail.jsx';
        window.visitWrites = [];
        createRoot(document.getElementById('root')).render(
          <BrowserRouter><Routes>
            <Route path="${householdPath}" element={<Households />} />
            <Route path="${householdPath}/new" element={<AddHousehold />} />
            <Route path="${householdPath}/:householdId/edit" element={<EditHousehold />} />
            <Route path="${householdPath}/:id" element={<HouseholdDetail />} />
          </Routes></BrowserRouter>
        );`,
      },
      plugins: [{ name: 'bhw-fixtures', setup(builder) {
        builder.onResolve({ filter: /^@\// }, ({ path }) => Object.hasOwn(fixtureModules, path) ? { path, namespace: 'bhw-fixtures' } : null);
        builder.onLoad({ filter: /.*/, namespace: 'bhw-fixtures' }, ({ path }) => ({ contents: fixtureModules[path], loader: 'js', resolveDir: frontend }));
      } }],
    }),
    postcss([tailwindcss(fileURLToPath(new URL('../../tailwind.config.js', import.meta.url)))])
      .process(css.replace(/^@import .+;$/gm, ''), { from: fileURLToPath(cssUrl) }),
  ]);
  fixture = bundle.outputFiles[0].text;
  stylesheet = compiled.css;
});

async function mount(page, path, width, height) {
  await page.setViewportSize({ width, height });
  await page.route('**/*', route => route.request().isNavigationRequest() && route.request().url() === `${origin}${path}`
    ? route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width, initial-scale=1"><div class="lg:pl-72"><main class="app-main mx-auto min-w-0 max-w-content px-3 py-5 sm:px-4 sm:py-6 md:px-8 md:py-8"><div id="root"></div></main></div>' })
    : route.abort());
  await page.goto(`${origin}${path}`);
  await page.addStyleTag({ content: stylesheet });
  await page.addScriptTag({ content: fixture });
}

async function fits(locator) {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

async function touchTarget(locator, square = false) {
  await expect(locator).toBeVisible();
  const { width, height } = await locator.boundingBox();
  expect(Math.round(height)).toBeGreaterThanOrEqual(44);
  if (square) expect(Math.round(width)).toBeGreaterThanOrEqual(44);
}

for (const [width, height] of [[390, 844], [768, 1024], [1366, 768]]) {
  test(`BHW list, dialogs, and visits fit ${width}x${height}`, async ({ page }) => {
    await mount(page, householdPath, width, height);
    const table = page.getByRole('region', { name: 'Households table' });
    const cards = page.getByRole('button', { name: 'Cards', exact: true });
    const tableButton = page.getByRole('button', { name: 'Table', exact: true });
    await expect(width < 1024 ? cards : tableButton).toHaveAttribute('aria-pressed', 'true');
    await touchTarget(cards);
    await page.getByRole('searchbox', { name: 'Search households' }).fill('Second Synthetic');
    await expect.poll(() => page.evaluate(() => window.householdSearch)).toBe('Second Synthetic');
    await expect(page.getByText('1 of 1 households', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Clear all', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.householdSearch)).toBe('');
    await tableButton.click();
    await expect(table.getByRole('row')).toHaveCount(4);
    const filterId = table.getByRole('button', { name: 'Filter Household ID', exact: true });
    await filterId.click();
    await expect(page.getByPlaceholder('Filter ID...')).toBeInViewport({ ratio: 1 });
    await page.getByPlaceholder('Filter ID...').fill('HH-001');
    await expect(table.getByRole('row')).toHaveCount(3);
    await filterId.click();
    await page.getByRole('button', { name: 'Clear all', exact: true }).click();
    await expect(table.getByRole('row')).toHaveCount(4);
    const zone = table.getByRole('button', { name: /Purok 1/ });
    await zone.click();
    await expect(table.getByRole('row')).toHaveCount(2);
    await zone.click();
    await expect(table.getByRole('row')).toHaveCount(4);
    expect(await table.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await fits(page.locator('html'));

    await cards.click();
    await expect(page.getByRole('heading', { name: 'Second Synthetic Head' })).toBeVisible();
    const card = page.getByRole('heading', { name: longName, exact: true }).locator('../..').locator('..');
    await fits(card);
    const detailsButton = card.getByRole('button', { name: 'View details' });
    await touchTarget(detailsButton);
    await detailsButton.click();
    const detailDialog = page.getByRole('dialog', { name: 'Household details' });
    const closeDetails = detailDialog.getByRole('button', { name: 'Close household details' });
    await expect(closeDetails).toBeFocused();
    await touchTarget(closeDetails, true);
    await fits(detailDialog.locator('.overflow-y-auto').first());
    const health = detailDialog.getByRole('button', { name: `Health profile for ${member.name}` });
    await health.click();
    const healthDialog = page.getByRole('dialog', { name: 'Member health profile' });
    await expect(healthDialog.getByLabel('Height (cm)')).toHaveValue('160');
    await fits(healthDialog.locator('.overflow-y-auto').first());
    await page.keyboard.press('Escape');
    await expect(healthDialog).toHaveCount(0);
    await expect(health).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(detailDialog).toHaveCount(0);
    await expect(detailsButton).toBeFocused();

    await card.getByRole('button', { name: 'Visit history', exact: true }).click();
    await expect(page).toHaveURL(`${origin}${householdPath}/${household.id}`);
    const visitDate = page.getByLabel('Visit date');
    const visitReason = page.getByLabel('Visit reason');
    const recordVisit = page.getByRole('button', { name: 'Record Visit', exact: true });
    for (const control of [visitDate, visitReason, recordVisit]) await touchTarget(control);
    await page.getByText('View profile saved at this visit').click();
    await fits(page.getByRole('listitem').filter({ hasText: 'First Visit' }));
    await expect(page.getByText(`Address: ${address}`, { exact: true })).toBeVisible();
    await visitDate.fill('2025-02-03');
    await visitReason.selectOption('Monitoring');
    await recordVisit.click();
    await expect(page.getByText('Second Visit', { exact: false }).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.visitWrites)).toMatchObject([
      { id: household.id, visitDate: '2025-02-03', visitReason: 'Monitoring', updatedSections: [], requestId: expect.any(String) },
    ]);
    await fits(page.locator('html'));

    await page.getByRole('link', { name: 'Back to Households' }).click();
    await page.getByRole('button', { name: 'Cards', exact: true }).click();
    await card.getByRole('button', { name: 'View details' }).click();
    await detailDialog.getByRole('button', { name: 'Edit household profile' }).click();
    await expect(page).toHaveURL(`${origin}${householdPath}/${household.id}/edit`);
    const editVisit = page.getByRole('button', { name: 'Record visit without profile changes' });
    await touchTarget(editVisit);
    await page.getByLabel('Visit date').fill('2025-02-04');
    await editVisit.click();
    await expect(page.getByRole('status')).toHaveText('Visit recorded.');
    expect(await page.evaluate(() => window.visitWrites.at(-1))).toMatchObject({ id: household.id, visitDate: '2025-02-04', visitReason: 'Follow-up' });
    await fits(page.locator('html'));
  });

  test(`BHW initial visit and member form fit ${width}x${height}`, async ({ page }) => {
    await mount(page, `${householdPath}/new`, width, height);
    const visits = page.getByRole('button', { name: /Visit Tracking/ });
    await touchTarget(visits);
    await visits.click();
    await expect(visits).toHaveAttribute('aria-expanded', 'true');
    await touchTarget(page.getByLabel('First Visit Date'));
    await page.getByLabel('First Visit Date').fill('2025-02-05');
    await page.getByPlaceholder('Search existing residents or enter a name').fill('New Synthetic Household');
    await page.getByLabel('Purok/Zone').selectOption('Purok 1');
    await page.getByLabel('Street Address / Sitio').fill('Synthetic Street');
    await page.getByLabel('Last Name', { exact: false }).fill('Fixture');
    await page.getByLabel('First Name', { exact: false }).fill('Synthetic');
    await page.getByLabel("Mother's Maiden Name").fill('Fixture');
    await page.getByLabel('Primary Water Source').selectOption({ index: 1 });
    await page.getByLabel('Toilet Facility Type').selectOption({ index: 1 });
    const addMember = page.getByRole('button', { name: 'Add Member', exact: true });
    await addMember.click();
    const dialog = page.getByRole('dialog', { name: 'Add household member' });
    const scrollBody = dialog.locator('.overflow-y-auto').first();
    await fits(scrollBody);
    await touchTarget(dialog.getByRole('button', { name: 'Close', exact: true }), true);
    await dialog.getByRole('button', { name: 'Add Member', exact: true }).click();
    await expect(dialog.getByText('Name is required.', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Full Name')).toHaveAttribute('aria-invalid', 'true');
    await fits(scrollBody);
    await dialog.getByLabel('Full Name').fill(member.name);
    await dialog.getByLabel('Relationship to Household Head').selectOption({ index: 1 });
    const female = dialog.getByRole('radio', { name: 'Female', exact: true });
    await touchTarget(female);
    await female.click();
    const confirm = dialog.getByRole('button', { name: 'Add Member', exact: true });
    await touchTarget(confirm);
    await scrollBody.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(confirm).toBeInViewport();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(addMember).toBeFocused();
    await fits(page.locator('html'));
    await page.getByRole('button', { name: 'Save Household', exact: true }).click();
    await expect(page).toHaveURL(`${origin}${householdPath}`);
    expect(await page.evaluate(() => window.initialProfile)).toMatchObject({
      initialVisitDate: '2025-02-05', initialVisitReason: 'Initial Profiling', initialVisitRequestId: expect.any(String),
      members: [{ name: member.name, sex: 'Female' }],
    });
  });
}

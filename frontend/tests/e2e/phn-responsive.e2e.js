import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

// Mount the production components without a server or any real account data.
test.use({ channel: process.env.PHN_UI_BROWSER_CHANNEL || undefined, video: 'off' });
const frontend = fileURLToPath(new URL('../../', import.meta.url));
const purpose = 'Follow-up for a long clinical purpose that should wrap at narrow viewport widths';
const location = 'Municipal Rural Health Unit with a long facility location';
const title = 'Community Health and Nutrition Assessment Program for All Eligible Residents';
const description = 'Program description with eligibility, a schedule and registration instructions. '.repeat(8).trim();
const visits = Array.from({ length: 10 }, (_, i) => ({
  id: `visit-${i}`, residentName: `Resident ${i}`, barangay: 'Test Barangay',
  purpose, location, assigned_provider: 'Test PHN', scheduled_date: i === 9 ? '2099-01-01' : '2020-01-01',
  scheduled_time: '09:00', priority: i === 0 ? 'High' : 'Low', status: i === 8 ? 'Completed' : 'Scheduled',
}));
const modules = {
  '@/features/health-records/components/LabResultsPanel': 'export default function LabResultsPanel() { return null; }',
  '@/context/AuthContext': `export const useAuth = () => ({ user: { id: 'test-phn', name: 'Test PHN', role: 'phn' } });`,
  '@/components/common/Card': `import React from 'react'; export const Card = ({ children, className = '', ...props }) => <section className={className} {...props}>{children}</section>;`,
  '@/services/api/phnWorkflow': `export const phnWorkflowApi = { listConsultationHealthServices: async () => [] };`,
  '@/features/certificates/components/MedicalCertificateModal': `import React from 'react'; export default function MedicalCertificateModal() { return null; }`,
  '@/features/consultations/components/MedicineSelector': `import React from 'react'; export default function MedicineSelector() { return <div aria-label="Medication selector" />; }`,
  '@/lib/dateUtils': `export const formatClinicalDateTime = value => ({ date: value || '—', time: '—' });`,
  '@/context/PermissionsContext': `
    const can = (permission) => !window.readOnly && permission !== 'services.delete';
    export const usePermissions = () => ({ can, canAny: (keys) => keys.some(can), matrixLoadState: { status: 'ready' } });`,
  '@/hooks/useSyncStatus': `export const useSyncStatus = () => ({});`,
  '@/services/offline/followUpOfflineService': `
    export const listFollowUpsOffline = async () => ${JSON.stringify(visits)};
    export const listFollowUpResidentsOffline = () => new Promise(resolve => { window.resolveResidents = resolve; });
    export const createFollowUpOffline = () => { throw Error('Unexpected write'); };
    export const updateFollowUpOffline = createFollowUpOffline;`,
  '@/services/api': `
    export const healthServicesApi = {
      list: async () => ({ rows: [${JSON.stringify({
        id: 'service-1', name: title, description, category: 'Maternal', active: true,
        facility: location, assignedPersonnel: [{ name: 'Test PHN' }], registrationCount: 3,
      })}] }),
      meta: async () => ({ categories: ['Maternal'] }),
      reference: async () => ({ barangays: [], facilities: [] }),
      personnel: async () => ({ rows: [] }),
    };`,
};
let fixture;
let stylesheet;
test.beforeAll(async () => {
  const cssUrl = new URL('../../src/styles/index.css', import.meta.url);
  const css = await readFile(cssUrl, 'utf8');
  const [bundle, compiled] = await Promise.all([
    build({
      absWorkingDir: frontend, bundle: true, write: false, minify: true,
      tsconfig: fileURLToPath(new URL('../../jsconfig.json', import.meta.url)),
      stdin: { resolveDir: frontend, loader: 'jsx', contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
         import { MemoryRouter } from 'react-router-dom';
         import FollowUps from './src/features/follow-ups/pages/MidwifeFollowUp.jsx';
         import Programs from './src/features/health-services/components/HealthServicesManager.jsx';
         import Checkup from './src/features/consultations/components/PhnCheckupWorkbench.jsx';
        window.mountPhn = (page, draft) => createRoot(document.getElementById('root')).render(
          <MemoryRouter initialEntries={[{ pathname: '/phn', state: draft && { followUpDraft: draft } }]}>
            {page === 'followups' ? <FollowUps /> : <Programs />}
          </MemoryRouter>
         );
         window.mountCheckup = onComplete => createRoot(document.getElementById('root')).render(
           <Checkup
             patient={{ id: 'visit-1', residentId: 'resident-1', patient: 'A Resident with a Longer Name', status: 'In Check-up', riskAssessmentStatus: 'incomplete', riskReason: 'Assessment incomplete. Missing measurements: oxygen saturation.', triage: { bloodPressure: '120/80', date: '2026-11-19' } }}
             onClose={() => { window.checkupClosed = true; }}
             onComplete={onComplete}
           />
         );`,
      },
      plugins: [{ name: 'phn-fixtures', setup(builder) {
        builder.onResolve({ filter: /^@\// }, ({ path }) => Object.hasOwn(modules, path) ? { path, namespace: 'phn-fixtures' } : null);
         builder.onLoad({ filter: /.*/, namespace: 'phn-fixtures' }, ({ path }) => ({ contents: modules[path], loader: 'jsx', resolveDir: frontend }));
      } }],
    }),
    postcss([tailwindcss(fileURLToPath(new URL('../../tailwind.config.js', import.meta.url)))])
      .process(css.replace(/^@import .+;$/gm, ''), { from: fileURLToPath(cssUrl) }),
  ]);
  fixture = bundle.outputFiles[0].text;
  stylesheet = compiled.css;
});

async function mount(page, screen, draft, readOnly = false) {
  await page.route('**/*', (route) => route.abort());
  await page.setContent('<main class="p-3"><div id="root"></div></main>');
  await page.addStyleTag({ content: stylesheet });
  await page.addScriptTag({ content: fixture });
  await page.evaluate(({ screen, draft, readOnly }) => {
    window.readOnly = readOnly;
    window.mountPhn(screen, draft);
  }, { screen, draft, readOnly });
}

test('PHN follow-up cards fit narrow screens and retain actions, filters, and pagination', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await mount(page, 'followups');
  await page.waitForFunction(() => window.resolveResidents);
  await page.evaluate(() => window.resolveResidents([]));
  const table = page.locator('.follow-up-monitoring-grid');
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(8);
  await expect(table.locator('thead')).toBeHidden();
  await expect(rows.nth(0)).toContainText(purpose);
  await expect(rows.nth(0)).toContainText(location);
  expect(await rows.evaluateAll((records) => records.every((row, i) => {
    const { height, top, bottom } = row.getBoundingClientRect();
    const next = records[i + 1]?.getBoundingClientRect();
    const cells = Array.from(row.querySelectorAll('td'));
    return height > 64 && (!next || bottom < next.top) && row.scrollWidth <= row.clientWidth &&
      cells.every((cell) => cell.scrollWidth <= cell.clientWidth && cell.getBoundingClientRect().top >= top && cell.getBoundingClientRect().bottom <= bottom);
  }))).toBe(true);

  await rows.nth(0).getByRole('button', { name: 'Actions for Resident 0' }).click();
  await page.getByRole('menuitem', { name: 'View Details' }).click();
  await expect(page.getByRole('dialog', { name: 'Follow-up Details' })).toContainText('Resident 0');
  await page.getByRole('dialog').getByRole('button', { name: /close/i }).click();
  await page.getByRole('button', { name: 'Go to next page' }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Resident 8');
  await page.getByRole('combobox', { name: 'Follow-up status' }).selectOption('Overdue');
  await expect(rows).toHaveCount(8);
  await expect(rows.last()).toContainText('Resident 7');
  await page.getByRole('combobox', { name: 'Follow-up priority' }).selectOption('High');
  await expect(rows).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search follow-ups' }).fill('Resident 1');
  await expect(table).toContainText('No follow-ups match');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(table.locator('thead')).toBeVisible();
  await expect(rows.first()).toHaveCSS('display', 'table-row');
});

for (const residentId of ['target-resident', 'missing-resident']) {
  test(`assessment draft resolves ${residentId} by ID after the directory loads`, async ({ page }) => {
    await mount(page, 'followups', { residentId, resident: 'Same Name', reason: 'Draft assessment' });
    await page.waitForFunction(() => window.resolveResidents);
    const dialog = page.getByRole('dialog', { name: 'Schedule Follow-up' });
    await expect(dialog).toHaveCount(0);
    await page.evaluate(() => window.resolveResidents([
      { id: 'different-resident', firstName: 'Same', lastName: 'Name' },
      { id: 'target-resident', firstName: 'Same', lastName: 'Name' },
    ]));
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('different-resident', { exact: false })).toHaveCount(0);
    await expect(dialog.getByText('target-resident', { exact: false })).toHaveCount(residentId === 'target-resident' ? 2 : 0);
    await expect(dialog.getByRole('textbox', { name: /reason/i })).toHaveValue('Draft assessment');
  });
}

test('live program cards wrap the title, expand the description, and keep permitted actions', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await mount(page, 'programs');
  const card = page.locator('article.health-service-card');
  await expect(card.getByRole('heading', { name: title })).toBeVisible();
  await expect(card.locator('.health-service-card-header')).toHaveCSS('flex-direction', 'column');
  await expect(card.locator('img')).toHaveCSS('height', '96px');
  expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(card.locator('summary .line-clamp-2')).toHaveCSS('-webkit-line-clamp', '2');
  await expect(card.locator('details p')).toBeHidden();
  await card.getByText('View Details', { exact: true }).click();
  await expect(card.locator('details p')).toHaveText(description);
  await expect(card.locator('details p')).toBeVisible();
  await expect(card.locator('dd').filter({ hasText: location })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Registrations (3)' })).toBeVisible();
  await card.getByRole('button', { name: 'Service actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Deactivate' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(card.locator('.health-service-card-header')).toHaveCSS('flex-direction', 'row');
});

test('check-up modal keeps the header and footer accessible while saving at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.route('**/*', (route) => route.abort());
  await page.setContent('<main class="p-3"><div id="root"></div></main>');
  await page.addStyleTag({ content: stylesheet });
  await page.addScriptTag({ content: fixture });
  await page.evaluate(() => window.mountCheckup(() => new Promise((resolve) => { window.finishCheckup = resolve; })));

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('A Resident with a Longer Name');
  await expect(dialog).toContainText('Incomplete');
  await expect(dialog).toContainText('oxygen saturation');
  await expect(dialog).not.toContainText('Low');
  const concern = dialog.getByLabel('Health Concern');
  const assessment = dialog.getByLabel('Assessment / Findings');
  await expect(concern).toHaveAttribute('list', 'phn-health-concerns');
  const scrollRegion = dialog.locator('.overflow-y-auto').first();
  await expect(scrollRegion).toBeVisible();
  expect(await scrollRegion.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await concern.fill('Routine Monitoring');
  await assessment.fill('Reviewed current findings');
  await dialog.getByLabel(/treatment \/ recommendations/i).fill('Recorded follow-up and monitoring plan.');
  await dialog.getByRole('button', { name: 'Complete Check-up' }).click();
  await expect(dialog.getByRole('button', { name: /Saving/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await page.evaluate(() => window.finishCheckup());
  await expect(dialog.getByRole('button', { name: 'Complete Check-up' })).toBeEnabled();
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('follow-up and program layouts have no horizontal page overflow at requested widths', async ({ page }) => {
  for (const width of [360, 375, 390, 414, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await mount(page, 'followups');
    await page.waitForFunction(() => window.resolveResidents);
    await page.evaluate(() => window.resolveResidents([]));
    await expect(page.locator('.follow-up-monitoring-grid tbody tr').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `follow-up page overflow at ${width}px`).toBe(true);

    await mount(page, 'programs');
    const card = page.locator('article.health-service-card').first();
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `program page overflow at ${width}px`).toBe(true);
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth), `program card overflow at ${width}px`).toBe(true);
  }
});

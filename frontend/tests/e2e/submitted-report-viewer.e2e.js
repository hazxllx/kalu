import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

test.use({ channel: process.env.PHN_UI_BROWSER_CHANNEL || undefined, video: 'off' });

const frontend = fileURLToPath(new URL('../../', import.meta.url));
const report = {
  id: 'report-1', reportType: 'Target Client List', title: 'November enrollment',
  barangay: 'Test Barangay', status: 'Received', senderRole: 'health_supervisor',
  recipientRole: 'rhu_personnel', submittedAt: '2026-11-01T00:00:00Z',
  content: {
    columns: Array.from({ length: 12 }, (_, index) => ({ label: `Column ${index}` })),
    rows: [Array.from({ length: 12 }, (_, index) => `Submitted value ${index}`)],
    scope: 'LongMunicipalityLabel'.repeat(12),
  },
};
const mocks = {
  '@/context/AuthContext': `export const useAuth = () => ({ user: window.user, role: window.user.role, isAuthenticated: true, authChecked: true });`,
  '@/context/PermissionsContext': `export const usePermissions = () => ({ can: () => window.canView, matrixLoadState: { status: 'ready' } });`,
  '@/context/BarangaysContext': `export const useBarangays = () => ({ barangays: [] });`,
  '@/services/api': `
    const report = ${JSON.stringify(report)};
    export const reportsApi = {
      listAll: async () => { window.listRequests++; return [report]; },
      get: async () => {
        if (window.denyDetail) throw new Error('Report not found.');
        return { record: window.malformed ? { ...report, content: { columns: [null], rows: [['invalid']] } } : report };
      },
    };`,
};
let fixture;
let styles;

test.beforeAll(async () => {
  const css = await readFile(new URL('../../src/styles/index.css', import.meta.url), 'utf8');
  const [bundle, stylesheet] = await Promise.all([
    build({
      absWorkingDir: frontend, bundle: true, write: false,
      stdin: { resolveDir: frontend, loader: 'jsx', contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
        import ProtectedRoute from './src/routes/ProtectedRoute.jsx';
        import Inbox from './src/features/health-records/pages/PhnTclSubmissions.jsx';
        window.mountInbox = ({ canView, role = 'phn', municipalityId = 'm1', direct = false, denyDetail = false, malformed = false }) => {
          window.canView = canView;
          window.user = { id: 'phn-1', role, municipalityId };
          window.denyDetail = denyDetail;
          window.malformed = malformed;
          window.listRequests = 0;
          createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/app/phn/tcls']}>
            {direct ? <Routes>
              <Route element={<ProtectedRoute allow={['phn']} />}>
                <Route element={<><nav>Dashboard navigation</nav><Outlet /></>}>
                  <Route path="/app/phn/tcls" element={<Inbox />} />
                </Route>
              </Route>
              <Route path="*" element={<p>Dashboard fallback</p>} />
            </Routes> : <Inbox />}
          </MemoryRouter>);
        };`,
      },
      plugins: [{ name: 'submitted-report-fixtures', setup(builder) {
        builder.onResolve({ filter: /^@\// }, ({ path }) => Object.hasOwn(mocks, path) ? { path, namespace: 'report-fixtures' } : null);
        builder.onLoad({ filter: /.*/, namespace: 'report-fixtures' }, ({ path }) => ({ contents: mocks[path] }));
      } }],
    }),
    postcss([tailwindcss(fileURLToPath(new URL('../../tailwind.config.js', import.meta.url)))])
      .process(css.replace(/^@import .+;$/gm, ''), { from: fileURLToPath(new URL('../../src/styles/index.css', import.meta.url)) }),
  ]);
  fixture = bundle.outputFiles[0].text;
  styles = stylesheet.css;
});

async function mount(page, options) {
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: fixture });
  await page.evaluate((settings) => window.mountInbox(settings), options);
}

test('PHN report permission denial renders an explicit state without fetching submissions', async ({ page }) => {
  await mount(page, { canView: false });
  await expect(page.getByText(/Submitted documents are unavailable/)).toBeVisible();
  expect(await page.evaluate(() => window.listRequests)).toBe(0);
});

for (const [reason, settings] of [
  ['wrong role', { role: 'mho' }],
  ['missing assignment', { municipalityId: null }],
  ['missing permission', { canView: false }],
]) {
  test(`direct TCL URL denies ${reason} before mounting the dashboard`, async ({ page }) => {
    await mount(page, { canView: true, direct: true, ...settings });
    await expect(page.getByRole('heading', { name: 'Access Restricted' })).toBeVisible();
    await expect(page.getByText(/Dashboard navigation|Dashboard fallback/)).toHaveCount(0);
    expect(await page.evaluate(() => window.listRequests)).toBe(0);
  });
}

test('a denied report detail shows no metadata, snapshot or review action', async ({ page }) => {
  await mount(page, { canView: true, denyDetail: true });
  await page.getByRole('button', { name: 'View', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Submitted TCL document' });
  await expect(dialog.getByText('Report not found.')).toBeVisible();
  await expect(dialog.getByText('Submission Information')).toHaveCount(0);
  await expect(dialog.getByRole('table')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /mark/i })).toHaveCount(0);
});

test('a malformed saved snapshot shows the unavailable state', async ({ page }) => {
  await mount(page, { canView: true, malformed: true });
  await page.getByRole('button', { name: 'View', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Submitted TCL document' });
  await expect(dialog.getByText('Report content unavailable')).toBeVisible();
  await expect(dialog.getByRole('table')).toHaveCount(0);
});

for (const width of [360, 1280]) {
  test(`PHN oversight keeps a wide submitted snapshot readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await mount(page, { canView: true, direct: true });
    await page.getByRole('button', { name: 'View', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Submitted TCL document' });
    await expect(dialog.getByText(/Read-only oversight/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Mark Reviewed' })).toHaveCount(0);
    const table = dialog.getByRole('region', { name: 'Submitted records table' });
    await expect(table.getByText('Submitted value 11', { exact: true })).toBeAttached();
    const bounds = await dialog.boundingBox();
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await table.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      return element.scrollLeft > 0 && element.getBoundingClientRect().right <= window.innerWidth;
    })).toBe(true);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
  });
}

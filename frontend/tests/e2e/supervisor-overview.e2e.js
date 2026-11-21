import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

test.use({ video: 'off' });

const frontend = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'http://supervisor-overview.test';
const modules = {
  '@/context/AuthContext': `export const useAuth = () => ({ user: { id: 'fixture', role: 'health_supervisor', barangay: 'San Isidro' } });`,
  '@/context/PermissionsContext': `export const usePermissions = () => ({ can: key => ['reports.analytics.view', 'reports.view', 'consultation.requests.view'].includes(key) });`,
  '@/services/api': `export const consultationsApi = { list: async () => ({ rows: [{ id: 'one', barangay: 'San Isidro', createdAt: '2026-08-15T00:00:00Z' }], total: 1 }) }; export const referralsApi = {}, followUpsApi = {}, residentsApi = {}, healthServicesApi = {};`,
  '@/services/api/monitoringApi': `export const buildBarangayHealthOverview = () => ({});`,
  '@/services/api/earlyWarningApi': `
    export const fetchBarangayBoundaries = async () => ({ type: 'FeatureCollection', features: [] });
    export const fetchRecentBarangayActivities = async () => ({ activities: window.emptyPopulation ? [] : [{ id: 'fixture-event', kind: 'followup_completed', title: 'Follow-up completed', description: 'A scheduled follow-up was marked completed.', occurredAt: '2026-11-20T01:20:00Z' }] });
    export function fetchEarlyWarningData(barangay) {
      const counts = window.emptyPopulation ? [0, 0, 0, 0] : [6, 3, 0, 1];
      const rows = ['Low Risk', 'Moderate Risk', 'High Risk', 'Unassessed'].map((name, index) => ({ name, value: counts[index] }));
      return { scope: { barangay }, riskDistribution: rows, reportingRiskDistribution: rows };
    }
    export function fetchCommunityMap({ barangay, from }) {
      const conditions = from === '2026-11-01' ? [{ name: 'Fever', value: 2 }, { name: 'Respiratory', value: 4 }, { name: 'Others', value: 8 }] : [];
      return { scope: 'barangay', scopeComplete: true, summary: { activeCases: 0 }, conditionTotals: conditions,
        barangays: [{ name: barangay, caseCount: 0, activeCases: 0, completedCases: 0, conditions }] };
    }`,
  '@/features/analytics/components/CommunityHealthMap': `export default function MapFixture() { return null; }`,
};

let script, stylesheet;
test.beforeAll(async () => {
  const cssUrl = new URL('../../src/styles/index.css', import.meta.url);
  const css = await readFile(cssUrl, 'utf8');
  const [bundle, compiled] = await Promise.all([
    build({
      absWorkingDir: frontend, bundle: true, write: false, minify: true,
      stdin: { resolveDir: frontend, loader: 'jsx', contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { MemoryRouter } from 'react-router-dom';
        import Dashboard from './src/features/dashboards/pages/HealthSupervisorDashboard.jsx';
        createRoot(document.getElementById('root')).render(<MemoryRouter><Dashboard /></MemoryRouter>);`, },
      plugins: [{ name: 'dashboard-fixtures', setup(builder) {
        builder.onResolve({ filter: /^@\// }, ({ path }) => Object.hasOwn(modules, path) ? { path, namespace: 'dashboard-fixtures' } : null);
        builder.onLoad({ filter: /.*/, namespace: 'dashboard-fixtures' }, ({ path }) => ({ contents: modules[path], resolveDir: frontend }));
      } }],
    }),
    postcss([tailwindcss(fileURLToPath(new URL('../../tailwind.config.js', import.meta.url)))])
      .process(css.replace(/^@import .+;$/gm, ''), { from: fileURLToPath(cssUrl) }),
  ]);
  script = bundle.outputFiles[0].text;
  stylesheet = compiled.css;
});

for (const width of [1366, 320]) {
  test(`dashboard keeps its layout without community overview at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.clock.setFixedTime(new Date('2026-11-21T08:00:00+08:00'));
    await page.route('**/*', route => route.request().url() === `${origin}/`
      ? route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width, initial-scale=1"><div class="lg:pl-72"><main class="px-3"><div id="root"></div></main></div>' })
      : route.abort());
    await page.goto(origin);
    await page.evaluate(empty => { window.emptyPopulation = empty; }, width === 320);
    await page.addStyleTag({ content: stylesheet });
    await page.addScriptTag({ content: script });

    const overview = page.getByRole('region', { name: 'Community Health Overview' });
    await expect(overview).toHaveCount(0);
    await expect(page.locator('.hs-overview, .hs-overview-grid')).toHaveCount(0);
    for (const name of ['Case Trends', 'Common Conditions', 'Resident Risk Distribution']) {
      await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'View Reports' })).toHaveAttribute('href', '/app/health_supervisor/reports');
    const updates = page.getByRole('region', { name: 'Recent Barangay Updates' });
    await expect(updates.getByText('Latest monitoring activities in your assigned barangay.')).toBeVisible();
    if (width === 320) await expect(updates.getByText('No recent monitoring activities recorded.')).toBeVisible();
    else await expect(updates.getByRole('heading', { name: 'Follow-up completed' })).toBeVisible();
    expect(await updates.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const [mapBox, updateBox] = await Promise.all([page.getByRole('region', { name: 'Community Health Map' }).boundingBox(), updates.boundingBox()]);
    expect(updateBox.y).toBeGreaterThanOrEqual(mapBox.y + mapBox.height);
    expect(updateBox.x).toBeCloseTo(mapBox.x, 0);
    expect(updateBox.width).toBeCloseTo(mapBox.width, 0);
    await expect(page.getByRole('region', { name: 'Cases Requiring Attention' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Upcoming Activities' })).toBeVisible();
    expect(await page.locator('.hs-dashboard').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.getByRole('combobox', { name: 'Reporting month' }).selectOption('9');
    await expect(overview).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Community Health Map' })).toBeVisible();
  });
}

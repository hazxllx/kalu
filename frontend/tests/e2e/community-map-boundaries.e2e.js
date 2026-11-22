import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

test.use({ video: 'off' });

const frontend = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'http://community-map-boundaries.test';
const syntheticBarangays = [
  {
    id: 'fixture-north', name: 'Fixture Barangay North', latitude: 14.6008, longitude: 121.001,
    hasCoordinates: true, caseCount: 12, highRiskResidents: 3, pendingFollowUps: 2,
    conditions: [{ name: 'Tuberculosis', value: 2 }, { name: 'Respiratory', value: 4 }, { name: 'Dengue', value: 6 }],
  },
  {
    id: 'fixture-south', name: 'Fixture Barangay South', latitude: 14.6008, longitude: 121.004,
    hasCoordinates: true, caseCount: 5, highRiskResidents: 1, pendingFollowUps: 1,
    conditions: [{ name: 'Tuberculosis', value: 1 }, { name: 'Respiratory', value: 4 }, { name: 'Dengue', value: 0 }],
  },
];

// These small polygons are synthetic interaction fixtures, not production boundaries.
const syntheticBoundaries = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature', properties: { name: 'Fixture Barangay North' },
      geometry: { type: 'Polygon', coordinates: [[[121, 14.5995], [121.002, 14.5995], [121.002, 14.602], [121, 14.602], [121, 14.5995]]] },
    },
    {
      type: 'Feature', properties: { name: 'Fixture Barangay South' },
      geometry: { type: 'Polygon', coordinates: [[[121.003, 14.5995], [121.005, 14.5995], [121.005, 14.602], [121.003, 14.602], [121.003, 14.5995]]] },
    },
  ],
};

const fixtureModules = {
  '@/services/api/earlyWarningApi': `
    export async function fetchCommunityMap() {
      return window.__communityMapApiFixture || { barangays: [] };
    }
  `,
  '@/components/common/EmptyState': `
    export default function EmptyState({ title, description }) {
      return <div role="status"><strong>{title}</strong><p>{description}</p></div>;
    }
  `,
  '@/components/common/ErrorState': `
    export default function ErrorState({ title, message, onRetry }) {
      return <div role="alert"><strong>{title}</strong><p>{message}</p>{onRetry && <button onClick={onRetry}>Retry</button>}</div>;
    }
  `,
  '@/lib/localSafety': `export const DEFAULT_MAP_STYLE_URL = 'http://community-map-boundaries.test/style.json';`,
};

let script;
let appStyles;
let leafletStyles;

test.beforeAll(async () => {
  const indexCssUrl = new URL('../../src/styles/index.css', import.meta.url);
  const leafletCssUrl = new URL('../../node_modules/leaflet/dist/leaflet.css', import.meta.url);
  const [indexCss, leafletCss] = await Promise.all([
    readFile(indexCssUrl, 'utf8'),
    readFile(leafletCssUrl, 'utf8'),
  ]);
  const [bundle, compiled] = await Promise.all([
    build({
      absWorkingDir: frontend,
      bundle: true,
      write: false,
      minify: true,
      format: 'esm',
      resolveExtensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
      stdin: {
        resolveDir: frontend,
        loader: 'jsx',
        contents: `
          import React, { useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import { MemoryRouter } from 'react-router-dom';
          import CommunityHealthMap from './src/features/analytics/components/CommunityHealthMap.jsx';

          const barangays = ${JSON.stringify(syntheticBarangays)};
          const boundaryLayer = ${JSON.stringify(syntheticBoundaries)};
          const options = [
            ['caseCount', 'Recorded Cases'],
            ['highRiskResidents', 'High-Risk Residents'],
            ['pendingFollowUps', 'Pending Follow-ups'],
            ['commonConditions', 'Common Conditions'],
          ];

          function Harness() {
            const [metric, setMetric] = useState('caseCount');
            const [selectedName, setSelectedName] = useState(null);
            const [state, setState] = useState('fixture');
            const conditions = metric === 'commonConditions' ? ['Tuberculosis', 'Respiratory'] : null;
            const metricLabel = options.find(([value]) => value === metric)[1];
            return <MemoryRouter><main>
              <label>Map layer <select aria-label="Community map layer" value={metric} onChange={event => setMetric(event.target.value)}>
                {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              <label>Fixture state <select aria-label="Fixture state" value={state} onChange={event => setState(event.target.value)}>
                <option value="fixture">Synthetic barangay fixtures</option><option value="empty">Empty data</option><option value="error">Fetch error</option>
              </select></label>
              <div id="map-root">
                <CommunityHealthMap
                  variant="dashboard"
                  height={260}
                  barangays={state === 'empty' ? [] : barangays}
                  center={{ latitude: 14.6008, longitude: 121.0025 }}
                  error={state === 'error' ? 'Synthetic fixture fetch failed.' : ''}
                  showCountLabels
                  displayMetric={metric === 'commonConditions' ? 'caseCount' : metric}
                  metricLabel={metricLabel}
                  visibleConditions={conditions}
                  selectedName={selectedName}
                  onSelect={row => setSelectedName(row.name)}
                  boundaryLayer={boundaryLayer}
                  periodLabel="Synthetic reporting period"
                />
              </div>
            </main></MemoryRouter>;
          }

          createRoot(document.getElementById('root')).render(<Harness />);
        `,
      },
      plugins: [{
        name: 'community-map-fixtures',
        setup(builder) {
          builder.onResolve({ filter: /^@\// }, ({ path: importPath }) => {
            if (Object.hasOwn(fixtureModules, importPath)) return { path: importPath, namespace: 'community-map-fixture' };
            const base = path.resolve(frontend, 'src', importPath.slice(2));
            const resolved = [base, ...['.js', '.jsx', '.ts', '.tsx'] .map(extension => `${base}${extension}`)]
              .find(candidate => existsSync(candidate));
            return resolved ? { path: resolved } : null;
          });
          builder.onLoad({ filter: /.*/, namespace: 'community-map-fixture' }, ({ path: importPath }) => ({ contents: fixtureModules[importPath], loader: 'jsx', resolveDir: frontend }));
          builder.onResolve({ filter: /^@maplibre\/maplibre-gl-leaflet$/ }, () => ({ path: 'maplibre-adapter', namespace: 'community-map-mock' }));
          builder.onResolve({ filter: /^maplibre-gl$/ }, () => ({ path: 'maplibre-gl', namespace: 'community-map-mock' }));
          builder.onResolve({ filter: /^maplibre-gl\/dist\/maplibre-gl-worker\.mjs\?worker&url$/ }, () => ({ path: 'maplibre-worker', namespace: 'community-map-mock' }));
          builder.onLoad({ filter: /.*/, namespace: 'community-map-mock' }, ({ path: moduleName }) => ({
            loader: 'js',
            contents: moduleName === 'maplibre-adapter'
              ? `export function maplibreGL() { return { addTo() { return { remove() {} }; } }; }`
              : moduleName === 'maplibre-gl'
                ? `export function setWorkerUrl() {}`
                : `export default 'mocked-maplibre-worker-url';`,
          }));
          builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'empty' }));
        },
      }],
    }),
    postcss([tailwindcss(fileURLToPath(new URL('../../tailwind.config.js', import.meta.url)))])
      .process(indexCss.replace(/^@import .+;$/gm, ''), { from: fileURLToPath(indexCssUrl) }),
  ]);
  script = bundle.outputFiles[0].text;
  appStyles = compiled.css;
  leafletStyles = leafletCss;
});

async function launchMap(page, width) {
  await page.setViewportSize({ width, height: 820 });
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url === `${origin}/`) {
      return route.fulfill({
        contentType: 'text/html',
        body: '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>',
      });
    }
    if (url === `${origin}/style.json`) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [] }) });
    }
    return route.abort();
  });
  await page.goto(origin);
  await page.addStyleTag({ content: leafletStyles });
  await page.addStyleTag({ content: appStyles });
  await page.addScriptTag({ content: script, type: 'module' });
}

async function clickBoundary(page, name) {
  const pathLocator = page.locator('.leaflet-barangay-boundaries-pane path.leaflet-interactive').nth(name.endsWith('North') ? 0 : 1);
  await expect(pathLocator).toBeVisible();
  const point = await pathLocator.evaluate(pathElement => {
    const point = pathElement.getPointAtLength(pathElement.getTotalLength() * 0.25);
    const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(pathElement.getScreenCTM());
    return { x: screenPoint.x, y: screenPoint.y };
  });
  await page.mouse.click(point.x, point.y);
  return pathLocator;
}

for (const width of [1366, 320]) {
  test(`real Leaflet boundaries, layers, legend and selection at ${width}px`, async ({ page }) => {
    await launchMap(page, width);

    const map = page.locator('#map-root .leaflet-container');
    const legend = page.getByRole('group', { name: 'Recorded Cases map legend' });
    await expect(map).toBeVisible();
    expect((await map.boundingBox()).height).toBe(260);
    await expect(page.locator('.hs-map-place-label strong')).toHaveText(['Fixture Barangay North', 'Fixture Barangay South']);
    expect(await page.evaluate(() => ({
      boundary: Number(getComputedStyle(document.querySelector('.leaflet-barangay-boundaries-pane')).zIndex),
      overlay: Number(getComputedStyle(document.querySelector('.leaflet-overlay-pane')).zIndex),
      markers: Number(getComputedStyle(document.querySelector('.leaflet-marker-pane')).zIndex),
    }))).toEqual({ boundary: 350, overlay: 400, markers: 600 });
    expect((await legend.boundingBox()).y).toBeGreaterThanOrEqual((await map.boundingBox()).y + 260);

    const layers = [
      { label: 'Recorded Cases', value: 'caseCount', legend: 'Recorded cases', count: '12', color: 'rgb(37, 99, 166)', popup: 'Recorded cases' },
      { label: 'High-Risk Residents', value: 'highRiskResidents', legend: 'High-risk residents', count: '3', color: 'rgb(179, 32, 44)', popup: 'High-risk residents' },
      { label: 'Pending Follow-ups', value: 'pendingFollowUps', legend: 'Pending follow-up', count: '2', color: 'rgb(183, 131, 32)', popup: 'Pending follow-ups' },
    ];
    for (const layer of layers) {
      await page.getByRole('combobox', { name: 'Community map layer' }).selectOption(layer.value);
      const activeLegend = page.getByRole('group', { name: `${layer.label} map legend` });
      const entry = activeLegend.locator('span').filter({ hasText: new RegExp(`^${layer.legend}$`) });
      await expect(entry).toBeVisible();
      const iconColor = await entry.locator('i').evaluate(icon => getComputedStyle(icon).backgroundColor);
      expect(iconColor).toBe(layer.color);
      console.log('leaflet paths', await page.locator('#map-root svg path').evaluateAll(paths => paths.map(marker => ({ className: marker.getAttribute('class'), fill: getComputedStyle(marker).fill, stroke: getComputedStyle(marker).stroke, pane: marker.parentElement?.parentElement?.parentElement?.className }))));
      const northMarker = page.locator('#map-root svg path').nth(2);
      expect(await northMarker.evaluate(marker => getComputedStyle(marker).fill)).toBe(iconColor);
      await expect(page.locator('.hs-map-place-label').nth(0)).toContainText(layer.count);

      const boundaryPath = await clickBoundary(page, 'Fixture Barangay North');
      await expect(boundaryPath).toHaveAttribute('stroke', '#2563A6');
      expect(Number(await boundaryPath.getAttribute('stroke-width'))).toBe(3);
      await expect(page.getByText(layer.popup, { exact: true })).toBeVisible();
      await expect(page.locator('.leaflet-popup-content')).toContainText(layer.count);
      await page.getByRole('combobox', { name: 'Community map layer' }).selectOption(layer.value);
      await expect(page.locator('.leaflet-popup')).toBeVisible();
      await expect(page.locator('.leaflet-popup-content')).toContainText(layer.count);

      await northMarker.click();
      await expect(page.locator('.leaflet-popup')).toBeVisible();
      await expect(page.locator('.leaflet-popup-content')).toContainText('Fixture Barangay North');
    }

    await page.getByRole('combobox', { name: 'Community map layer' }).selectOption('commonConditions');
    const conditionsLegend = page.getByRole('group', { name: 'Common Conditions map legend' });
    for (const [name, color] of [['Respiratory', 'rgb(8, 145, 178)'], ['Tuberculosis', 'rgb(124, 58, 237)']]) {
      const entry = conditionsLegend.locator('span').filter({ hasText: new RegExp(`^${name}$`) });
      await expect(entry).toBeVisible();
      await expect(entry.locator('i')).toHaveCSS('border-color', color);
      expect(await page.locator('#map-root svg path').evaluateAll(paths => paths.map(marker => getComputedStyle(marker).stroke)))
        .toContain(color);
    }
    await expect(page.locator('.hs-map-place-label').nth(0)).toContainText('6');
    await expect(page.locator('.hs-map-place-label').nth(1)).toContainText('5');
    await expect(conditionsLegend.getByText('Selected barangay', { exact: true })).toBeVisible();

    await page.getByRole('combobox', { name: 'Fixture state' }).selectOption('empty');
    await expect(page.getByText('No available barangay data')).toBeVisible();
    await page.getByRole('combobox', { name: 'Fixture state' }).selectOption('error');
    await expect(page.getByRole('alert')).toContainText('Synthetic fixture fetch failed.');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
}

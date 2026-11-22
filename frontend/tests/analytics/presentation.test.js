import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as risk from '../../src/lib/riskLevel.js';
import * as legend from '../../src/features/analytics/lib/communityMapLegend.js';

const require = createRequire(import.meta.url);
// Compile the actual JSX so assertions exercise rendered labels and styles.
async function loadComponent(path, overrides = {}) {
  const filename = new URL(`../../src/${path}`, import.meta.url);
  const source = await readFile(filename, 'utf8');
  const { code } = await transformWithEsbuild(source, filename.pathname, { loader: 'jsx', format: 'cjs', jsx: 'transform' });
  const module = { exports: {} };
  const load = (id) => {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (id === '@/lib/riskLevel') return risk;
    if (id === '@/lib/designTokens') return { TYPE: { body: { family: 'sans-serif' } } };
    if (id === 'lucide-react') return {};
    if (id.startsWith('@/')) return {};
    return require(id);
  };
  new Function('require', 'module', 'exports', code)(load, module, module.exports);
  return module.exports;
}

test('both risk badges render canonical aliases and neutral unassessed values', async () => {
  for (const path of ['components/common/RiskBadge.jsx', 'components/system/RiskLabel.jsx']) {
    const { default: Badge } = await loadComponent(path);
    for (const [input, label, color, fixtureId] of [
      ['Medium', 'Moderate', 'amber', 'R-TEST-017'], ['High Risk', 'High', 'rose', 'R-TEST-018'],
      ['Low Risk', 'Low', 'emerald', 'R-TEST-016'], [undefined, 'Unassessed', 'slate', 'R-TEST-019'],
      ['unrecognized', 'Unassessed', 'slate', 'R-TEST-INVALID'],
    ]) {
      const html = renderToStaticMarkup(React.createElement(Badge, { level: input }));
      assert.match(html, new RegExp(`>${label}</span>`), fixtureId);
      assert.match(html, new RegExp(`bg-${color}-`), fixtureId);
    }
  }
});

test('household risk badges reuse the clinical palette while status badges keep their existing labels', async () => {
  const { default: Badge } = await loadComponent('components/common/RiskBadge.jsx');
  const { default: HouseholdBadge } = await loadComponent('features/households/components/HHBadge.jsx', {
    '../lib/householdOptions': { hhBadgeTone: () => 'household-status-tone' },
    '../../../components/common/RiskBadge': Badge,
  });
  for (const [input, expected] of [['Low', 'Low'], ['Medium', 'Moderate'], ['High Risk', 'High'], [null, 'Unassessed'], ['unknown', 'Unassessed']]) {
    const html = renderToStaticMarkup(React.createElement(HouseholdBadge, { value: input, risk: true }));
    assert.match(html, new RegExp(`>${expected}</span>`));
    assert.ok(html.includes(risk.RISK_PRESENTATION[expected].badge));
  }
  const status = renderToStaticMarkup(React.createElement(HouseholdBadge, { value: 'Active' }));
  assert.match(status, />Active</);
  assert.match(status, /household-status-tone/);
});

test('risk overview preserves synthetic mixed aliases and unassessed counts', async () => {
  const { default: Overview } = await loadComponent('features/analytics/components/RiskOverview.jsx');
  const html = renderToStaticMarkup(React.createElement(Overview, { distribution: [
    { name: 'High Risk', value: 2 }, { name: 'Medium', value: 3 },
    { name: 'Moderate', value: 5 }, { name: 'Low', value: 6 }, { name: 'Unassessed', value: 4 },
  ] }));
  assert.match(html, /bg-amber-700[^>]*style="width:40%"/);
  assert.match(html, /bg-rose-700[^>]*style="width:10%"/);
  assert.match(html, />Unassessed</);
  assert.doesNotMatch(html, />Medium</);
});

test('reporting year uses calendar years for January boundaries, ranges, and all records', async () => {
  const { reportingYearLabel } = await loadComponent('features/dashboards/pages/MHODashboard.jsx');
  assert.equal(reportingYearLabel({ from: '2031-01-01', to: '2031-12-31' }), '2031');
  assert.equal(reportingYearLabel({ from: '2030-12-31', to: '2031-01-01' }), '2030-2031');
  assert.equal(reportingYearLabel({ from: null, to: '2032-01-01' }), '2032');
  assert.equal(reportingYearLabel({ from: '2033-01-01', to: null }), '2033');
  assert.equal(reportingYearLabel({}), 'All years');
});

test('map shades the displayed metric and reports its count, legend and selected period', async () => {
  const wrapper = ({ children }) => React.createElement('div', null, children);
  const marker = ({ children, pathOptions }) => React.createElement('div', { 'data-color': pathOptions.fillColor }, children);
  const { default: Map } = await loadComponent('features/analytics/components/CommunityHealthMap.jsx', {
    'react-leaflet': { MapContainer: wrapper, CircleMarker: marker, GeoJSON: () => null, Pane: wrapper, Popup: wrapper, Tooltip: wrapper, ZoomControl: () => null, useMap: () => ({}) },
    'framer-motion': { useReducedMotion: () => true },
    '@maplibre/maplibre-gl-leaflet': {},
    'maplibre-gl': { setWorkerUrl: () => {} },
    'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url': '',
    'leaflet/dist/leaflet.css': {}, 'maplibre-gl/dist/maplibre-gl.css': {},
    '@/features/analytics/lib/purokGeometry': { validPurokGeoJson: () => null },
    '@/features/analytics/lib/communityMapLegend': legend,
  });
  const barangays = [
    { id: 'a', name: 'Synthetic A', hasCoordinates: true, latitude: 13, longitude: 123, caseCount: 100, activeCases: 2, highRiskResidents: 999, reportingHighRiskResidents: 3, conditions: [{ name: 'Test', value: 100 }], intensity: 1 },
    { id: 'b', name: 'Synthetic B', hasCoordinates: true, latitude: 14, longitude: 123, caseCount: 1, activeCases: 20, conditions: [{ name: 'Test', value: 1 }], intensity: 0.01 },
  ];
  const html = renderToStaticMarkup(React.createElement(Map, {
    barangays, displayMetric: 'activeCases', metricLabel: 'Active cases',
    periodLabel: '2030-12-01 to 2031-01-31', showCountLabels: true, visibleConditions: ['Test'],
  }));
  assert.match(html, /data-color="#F6C453"/);
  assert.match(html, /data-color="#B91C1C"/);
  assert.match(html, /<dt>Active cases<\/dt><dd>2<\/dd>/);
  assert.match(html, /<dt>Active cases<\/dt><dd>20<\/dd>/);
  assert.match(html, /Active cases: relative intensity/);
  assert.match(html, /2030-12-01 to 2031-01-31/);
  assert.doesNotMatch(html, /<dd>100<\/dd>/);
  assert.match(html, /<dt>High-risk residents<\/dt><dd>3<\/dd>/);
  assert.doesNotMatch(html, /<dd>999<\/dd>/);

  const dashboardHtml = renderToStaticMarkup(React.createElement(Map, {
    variant: 'dashboard', height: 260, displayMetric: 'highRiskResidents', metricLabel: 'High-Risk Residents',
    periodLabel: 'Latest recorded resident risk', showCountLabels: true, selectedName: 'Fixture Barangay',
    barangays: [{ id: 'dashboard-a', name: 'Fixture Barangay', hasCoordinates: true, latitude: 13, longitude: 123,
      caseCount: 11, highRiskResidents: 4, pendingFollowUps: 2, conditions: [{ name: 'Fever', value: 5 }] }],
  }));
  assert.match(dashboardHtml, /class="hs-map-legend"[^>]*role="group"/);
  assert.match(dashboardHtml, />High-risk residents<\/span>/);
  assert.doesNotMatch(dashboardHtml, /No records|Lower|Moderate|Higher/);
  assert.match(dashboardHtml, /Fixture Barangay/);
  assert.match(dashboardHtml, /data-color="#B3202C"/);
  assert.match(dashboardHtml, /<dt>Recorded cases<\/dt><dd>11<\/dd>/);
  assert.match(dashboardHtml, /<dt>High-risk residents<\/dt><dd>4<\/dd>/);
  assert.match(dashboardHtml, /<dt>Pending follow-ups<\/dt><dd>2<\/dd>/);
});

test('health trend requests share the selected reporting range and captions', async () => {
  const source = await readFile(new URL('../../src/features/analytics/pages/HealthTrends.jsx', import.meta.url), 'utf8');
  assert.match(source, /const muniRange = activityRange/);
  for (const method of ['earlyWarning', 'communityMap']) {
    assert.match(source, new RegExp(`${method}\\(\\{ barangay: assignedBarangay, from: muniRange.from, to: muniRange.to \\}`));
  }
  assert.doesNotMatch(source, /past 12 months|last 12 months yet|min="2020"|max="2099"/);
  assert.match(source, /normalizeRiskDistribution\(ew.reportingRiskDistribution \?\? ew.riskDistribution\)/);
  assert.match(source, /normalizeRiskDistribution\(muniEW.reportingRiskDistribution \?\? muniEW.riskDistribution\)/);
});

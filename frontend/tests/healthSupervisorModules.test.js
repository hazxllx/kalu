import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { transform } from 'esbuild';

const source = async (path) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
const residentsSource = await source('features/residents/pages/ResidentsPage.jsx');
const followUpsSource = await source('features/follow-ups/pages/MidwifeFollowUp.jsx');
const reportsSource = await source('features/reports/pages/ReportsPage.jsx');
const servicesSource = await source('features/health-services/components/HealthServicesManager.jsx');
const trendsSource = await source('features/analytics/pages/HealthTrends.jsx');

let serial = 0;
async function mountResidents(context) {
  const Panel = ({ children, ...props }) => React.createElement('div', props, children);
  const Empty = () => null;
  const deps = {
    useAuth: () => ({ user: context.user }),
    usePermissions: () => ({ can: (permission) => context.permissions.has(permission), matrixLoadState: { status: 'ready' } }),
    useSearchParams: () => [context.params, (params) => { context.params = params; }],
    useToast: () => ({ showToast: () => {} }),
    useBarangays: () => ({ barangays: [] }),
    getSupervisorScope: (user) => user.role === 'health_supervisor'
      ? { level: user.assignedBarangay ? 'barangay' : 'unassigned', assignedBarangay: user.assignedBarangay }
      : null,
    HS_SCOPE: { BARANGAY: 'barangay' },
    isPhn: (user) => user?.role === 'phn',
    PageHeader: ({ title, action }) => React.createElement('header', null, title, action),
    Card: Panel,
    DataTable: Empty,
    SkeletonList: Empty,
    RiskBadge: ({ level }) => React.createElement('span', null, level),
    StatusBadge: ({ value }) => React.createElement('span', null, value),
    ErrorState: ({ message }) => React.createElement('p', { role: 'alert' }, message),
    EmptyState: Empty,
    ResidentConflictReview: Empty,
    SearchableSelect: Empty,
    ButtonSelectGroup: Empty,
    dateOfBirth: () => ({}),
    isStrictMobile: () => true,
    getLinkedGuardianOptions: () => [],
    listResidentsOffline: async () => ({ rows: [], warning: null }),
    residentsApi: { get: (...args) => context.get(...args) },
    createResidentOffline: Empty,
    updateResidentOffline: Empty,
    Plus: Empty, Search: Empty, X: Empty, ChevronDown: Empty, Eye: Empty, Pencil: Empty, CheckCircle2: Empty, Users: Empty,
  };
  const globalName = `__residentModuleTest${serial++}`;
  globalThis[globalName] = deps;
  const injected = residentsSource.replace(/^import\s+([\s\S]*?)\s+from\s+(["'])([^"']+)\2;?/gm, (statement, bindings, _quote, path) => {
    if (path === 'react') return statement.replace('"react"', JSON.stringify(import.meta.resolve('react')));
    return bindings.trim().startsWith('{')
      ? `const ${bindings} = globalThis.${globalName};`
      : `const ${bindings.trim()} = globalThis.${globalName}.${bindings.trim()};`;
  });
  const compiled = await transform(injected, { loader: 'jsx', jsx: 'transform' });
  const { default: ResidentsPage } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
  let renderer;
  await act(async () => { renderer = create(React.createElement(ResidentsPage)); });
  return {
    renderer,
    update: () => act(async () => { renderer.update(React.createElement(ResidentsPage)); }),
    close: () => { act(() => renderer.unmount()); delete globalThis[globalName]; },
  };
}

const residentContext = (params = '') => ({
  user: { id: 'owner-a', role: 'health_supervisor', assignedBarangay: 'San Isidro' },
  params: new URLSearchParams(params),
  permissions: new Set(['residents.directory.view', 'residents.profile.view']),
  get: async () => { throw new Error('No linked resident requested'); },
});

test('HS URL search initializes and synchronizes without resetting typed input', async () => {
  const context = residentContext('q=initial&risk=High');
  const page = await mountResidents(context);
  try {
    const search = () => page.renderer.root.findByProps({ id: 'resident-search' });
    assert.equal(search().props.value, 'initial');
    assert.equal(page.renderer.root.findByProps({ id: 'resident-risk' }).props.value, 'High');
    act(() => search().props.onChange({ target: { value: 'typed search' } }));
    await page.update();
    assert.equal(search().props.value, 'typed search');
    context.params = new URLSearchParams('q=from-url&risk=Low');
    await page.update();
    assert.equal(search().props.value, 'from-url');
    assert.equal(page.renderer.root.findByProps({ id: 'resident-risk' }).props.value, 'Low');
  } finally { page.close(); }
});

test('other roles do not adopt supervisor URL search or profile deep links', async () => {
  const context = residentContext('q=ignored&residentId=resident-a');
  context.user = { id: 'phn-owner', role: 'phn' };
  let calls = 0;
  context.get = async () => { calls += 1; };
  const page = await mountResidents(context);
  try {
    const search = page.renderer.root.findByType('input');
    assert.equal(search.props.value, '');
    assert.equal(calls, 0);
  } finally { page.close(); }
});

test('resident deep links fail closed for missing scope or profile permission', async () => {
  for (const missing of ['scope', 'permission']) {
    const context = residentContext('residentId=resident-a');
    if (missing === 'scope') context.user.assignedBarangay = null;
    else context.permissions.delete('residents.profile.view');
    let calls = 0;
    context.get = async () => { calls += 1; };
    const page = await mountResidents(context);
    try {
      assert.equal(calls, 0);
      assert.equal(page.renderer.root.findAllByProps({ 'aria-label': 'Resident Profile' }).length, 0);
      assert.match(JSON.stringify(page.renderer.toJSON()), /required|not permitted/);
    } finally { page.close(); }
  }
});

test('resident deep-link response cannot cross an account switch and unknown verification is not approved', async () => {
  const context = residentContext('residentId=resident-a');
  const pending = [];
  context.get = (id, options) => new Promise((resolve) => pending.push({ id, options, resolve }));
  const page = await mountResidents(context);
  try {
    assert.deepEqual(pending[0].options, { ownerId: 'owner-a' });
    context.user = { id: 'owner-b', role: 'health_supervisor', assignedBarangay: 'San Antonio' };
    await page.update();
    assert.deepEqual(pending[1].options, { ownerId: 'owner-b' });
    await act(async () => { pending[0].resolve({ resident: { id: 'resident-a', firstName: 'Old Account Record', barangay: 'San Isidro' } }); });
    assert.equal(page.renderer.root.findAllByProps({ 'aria-label': 'Resident Profile' }).length, 0);
    await act(async () => { pending[1].resolve({ resident: { id: 'resident-a', firstName: 'Authorized Record', barangay: 'San Antonio' } }); });
    assert.equal(page.renderer.root.findAll((node) => node.type === 'div' && node.props['aria-label'] === 'Resident Profile').length, 1);
    const output = JSON.stringify(page.renderer.toJSON());
    assert.match(output, /Authorized Record/);
    assert.match(output, /Unknown/);
    assert.doesNotMatch(output, /Old Account Record/);
  } finally { page.close(); }
});

test('out-of-scope resident responses are rejected and the profile retry uses the same authorized ID', async () => {
  const context = residentContext('residentId=resident-a');
  context.get = async () => ({ resident: { id: 'resident-a', barangay: 'San Antonio' } });
  const page = await mountResidents(context);
  try {
    assert.equal(page.renderer.root.findAllByProps({ 'aria-label': 'Resident Profile' }).length, 0);
    assert.match(JSON.stringify(page.renderer.toJSON()), /not available in your assigned barangay/);
    context.get = async (id, options) => {
      assert.equal(id, 'resident-a');
      assert.deepEqual(options, { ownerId: 'owner-a' });
      return { resident: { id, barangay: 'San Isidro' } };
    };
    await act(async () => page.renderer.root.findByProps({ title: 'Resident profile unavailable' }).props.onRetry());
    assert.equal(page.renderer.root.findAll((node) => node.type === 'div' && node.props['aria-label'] === 'Resident Profile').length, 1);
  } finally { page.close(); }
});

test('overdue monitoring excludes terminal visits and never fabricates a missing date', async () => {
  const code = followUpsSource.slice(followUpsSource.indexOf('const TERMINAL_FOLLOW_UP_STATUSES'), followUpsSource.indexOf('const FOLLOW_UP_STATUS_FILTERS'));
  const { isOverdue } = await import(`data:text/javascript;base64,${Buffer.from(`const manilaDateKey = () => '2026-11-07';\n${code}\nexport { isOverdue };`).toString('base64')}`);
  assert.equal(isOverdue({ status: 'Scheduled', scheduledDateRaw: '2026-11-06' }), true);
  assert.equal(isOverdue({ status: 'Scheduled', scheduledDateRaw: '2026-11-07' }), false);
  for (const status of ['Completed', 'Missed', 'Cancelled', 'Rejected']) assert.equal(isOverdue({ status, scheduledDateRaw: '2026-11-06' }), false);
  assert.equal(isOverdue({ status: 'Pending', scheduledDateRaw: '' }), false);
  assert.equal(isOverdue({ status: 'Scheduled', scheduledDateRaw: 'invalid' }), false);
  assert.equal(isOverdue({ status: 'Scheduled', scheduledDateRaw: '2026-00-00' }), false);
  assert.match(followUpsSource, /String\(row\.id\) === followUpParam/);
  assert.match(followUpsSource, /loadedOwner !== user\?\.id/);
  assert.match(followUpsSource, /_offlineResidentName: selectedResident\.name/);
  assert.match(followUpsSource, /supervisor && followUpSource\?\.source === "cache" &&/);
});

test('HS charts and form failures use authorized sources and explicit unavailable states', () => {
  assert.match(residentsSource, /verified: true/);
  assert.doesNotMatch(residentsSource, /verificationStatus \|\| ["']verified["']/);
  assert.match(reportsSource, /can\("reports\.analytics\.view"\)/);
  assert.match(reportsSource, /authorizedViewsApi\.earlyWarning/);
  assert.doesNotMatch(reportsSource, /services\/local\/dashboardData/);
  const detailModal = reportsSource.slice(reportsSource.indexOf('{/* Report Details Modal'));
  assert.match(detailModal, /submitError && <p role="alert"/);
  assert.match(detailModal, /Retry submission to/);
  assert.match(detailModal, /detailContent\.history\.map/);
  assert.match(servicesSource, /Promise\.allSettled/);
  assert.match(servicesSource, /referenceState\.errors\.join/);
  assert.match(servicesSource, /loading \|\| error \? "Unavailable"/);
  assert.match(trendsSource, /supervisor \? "supervisor-input/);
  assert.match(trendsSource, /isAnimationActive=\{!supervisor\}/);
  assert.doesNotMatch(trendsSource, /assessed > 0[^\n]+: '0%'/);
});

function healthTrendLoader({ supervisor, assignedBarangay, canViewAnalytics = true, api }) {
  const marker = 'const load = useCallback(async (options) => {';
  const start = trendsSource.indexOf(marker) + marker.length;
  const end = trendsSource.indexOf('}, [assignedBarangay', start);
  assert.ok(start >= marker.length && end > start);
  return new Function('supervisor', 'assignedBarangay', 'canViewAnalytics', 'period', 'muniRange', 'authorizedViewsApi', 'lastActivityPeriod', `return async (options) => {${trendsSource.slice(start, end)}};`)(
    supervisor, assignedBarangay, canViewAnalytics, '3m', { from: '2026-09-01', to: '2026-11-07' }, api, () => ({ from: '2026-09-01', to: '2026-11-07' }),
  );
}

test('supervisor health trends use only the required scoped aggregate, not an unused map request', async () => {
  let mapCalls = 0;
  const aggregate = { scope: { barangay: 'San Antonio' }, activity: { rows: [] } };
  const loader = healthTrendLoader({ supervisor: true, assignedBarangay: 'San Antonio', api: {
    earlyWarning: async (params, options) => {
      assert.equal(params.barangay, 'San Antonio');
      assert.deepEqual(options, { ownerId: 'owner-a' });
      return aggregate;
    },
    communityMap: async () => { mapCalls += 1; throw new Error('An unused map must not block these charts'); },
  } });
  assert.deepEqual(await loader({ ownerId: 'owner-a' }), { ew: aggregate, map: null });
  assert.equal(mapCalls, 0);
});

test('health-trend loads reject missing permission, assignment and out-of-scope aggregates', async () => {
  let calls = 0;
  const api = { earlyWarning: async () => { calls += 1; return { scope: { barangay: 'San Isidro' } }; } };
  await assert.rejects(healthTrendLoader({ supervisor: true, assignedBarangay: null, api })(), /assignment is required/);
  await assert.rejects(healthTrendLoader({ supervisor: true, assignedBarangay: 'San Antonio', canViewAnalytics: false, api })(), /not permitted/);
  assert.equal(calls, 0);
  await assert.rejects(healthTrendLoader({ supervisor: true, assignedBarangay: 'San Antonio', api })(), /outside your assigned barangay/);
  assert.equal(calls, 1);
});

test('municipal health trends retain both original aggregate and map integrations', async () => {
  const calls = [];
  const ew = { scope: { level: 'municipality' } };
  const map = { scope: 'municipal', barangays: [] };
  const loader = healthTrendLoader({ supervisor: false, assignedBarangay: null, api: {
    earlyWarning: async (_params, options) => { calls.push(['aggregate', options]); return ew; },
    communityMap: async (_params, options) => { calls.push(['map', options]); return map; },
  } });
  assert.deepEqual(await loader({ ownerId: 'mho-owner' }), { ew, map });
  assert.deepEqual(calls, [['aggregate', { ownerId: 'mho-owner' }], ['map', { ownerId: 'mho-owner' }]]);
});

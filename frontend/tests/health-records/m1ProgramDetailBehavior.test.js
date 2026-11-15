import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { transform } from 'esbuild';
import { M1_INDICATORS } from '../../../backend/src/config/m1Catalog.js';
import { getProgram, getBreadcrumbPath } from '../../src/features/health-records/lib/m1ProgramConfig.js';
import * as reportingPeriod from '../../src/features/health-records/lib/reportingPeriod.js';

const source = await readFile(new URL('../../src/features/health-records/pages/M1ProgramDetailTemplate.jsx', import.meta.url), 'utf8');
const maternal = M1_INDICATORS.filter((row) => row.section === 'B');
const response = () => ({
  program: 'prenatal', records: [],
  warnings: [
    'Legacy catalog measures retain 4 prenatal check-ups and 2 postpartum check-ups.',
    'Records include maternal cases contributing derived events in this period.',
  ],
  indicators: Object.fromEntries(maternal.map((row, i) => [row.code, { ...row, total: i }])),
});
let serial = 0;
async function mount(load = async () => response(), drill = async () => ({ records: [], count: 0 }), programId = 'prenatal') {
  const calls = [];
  const Panel = ({ children, ...props }) => React.createElement('div', props, children);
  const Empty = () => null;
  const ErrorState = ({ title, message, onRetry }) => React.createElement('div', null, title, message, onRetry && React.createElement('button', { onClick: onRetry }, 'Try Again'));
  const DataTable = ({ rows, columns }) => React.createElement('table', null,
    React.createElement('thead', null, React.createElement('tr', null, columns.map((column) => React.createElement('th', { key: column.key }, column.label)))),
    React.createElement('tbody', null, rows.map((row, index) => React.createElement('tr', { key: row.id || row.rowId || index }, columns.map((column) => React.createElement('td', { key: column.key, className: column.wrap ? 'whitespace-normal' : '' }, column.render ? column.render(row) : String(row[column.key] ?? '')))))));
  const M1IndicatorTable = ({ rows, onView }) => React.createElement(DataTable, { rows, columns: [
    { key: 'code', label: 'Indicator Code' }, { key: 'name', label: 'Indicator Name', wrap: true }, { key: 'total', label: 'Value' },
    { key: 'action', label: 'Action', render: (row) => React.createElement('button', { onClick: () => onView(row) }, 'View') },
  ] });
  const M1DrilldownDialog = ({ indicator, records, error }) => indicator ? React.createElement('div', { role: 'dialog' }, error || (records || []).map((record) => React.createElement('span', { key: record.id }, record.id))) : null;
  const M1ReportingPeriod = ({ period, onPeriodChange }) => React.createElement('div', null, ['monthly', 'quarterly', 'annual'].map((value) => React.createElement('button', { key: value, 'aria-pressed': period === value, onClick: () => onPeriodChange(value) }, value[0].toUpperCase() + value.slice(1))));
  const TclTabs = ({ tabs, active, onChange }) => React.createElement('div', { role: 'tablist' }, tabs.map((tab) => React.createElement('button', { key: tab.value, role: 'tab', 'aria-selected': active === tab.value, onClick: () => onChange(tab.value) }, tab.label)));
  const deps = {
    ...reportingPeriod, periodLabel: reportingPeriod.periodLabel,
    useSearchParams: () => [new URLSearchParams(), () => {}], getProgram, getBreadcrumbPath,
    useAuth: () => ({ user: { id: 'supervisor-a' } }),
    M1PageHeader: ({ title }) => React.createElement('h1', null, title), M1ReportingPeriod, M1IndicatorTable, M1DrilldownDialog,
    Card: Panel, ErrorState, StatusBadge: ({ value }) => React.createElement('span', null, value), DataTable,
    TablePagination: Empty, SkeletonTable: Empty, TclEmptyState: ({ title, description }) => React.createElement('div', null, title, description), TclTabs,
    TclToolbar: Empty, X: Empty,
    m1Api: { drilldown: drill },
  };
  const key = `__m1DetailTest${serial++}`;
  globalThis[key] = deps;
  const injected = source.replace(/^import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2;?/gm, (statement, bindings, _quote, path) => {
    if (path === 'react') return statement.replace(/['"]react['"]/, JSON.stringify(import.meta.resolve('react')));
    return bindings.trim().startsWith('{')
      ? `const ${bindings.replace(/\bas\b/g, ':')} = globalThis.${key};`
      : `const ${bindings.trim()} = globalThis.${key}.${bindings.trim()};`;
  });
  const compiled = await transform(injected, { loader: 'jsx', jsx: 'transform' });
  const { createM1ProgramDetailPage } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
  const Page = createM1ProgramDetailPage(programId, { listRecords: async (params) => { calls.push(params); return load(params); } });
  let renderer;
  await act(async () => { renderer = create(React.createElement(Page)); });
  return {
    renderer, calls,
    text: () => JSON.stringify(renderer.toJSON()),
    click: (label) => act(async () => {
      renderer.root.findAllByType('button').find((button) => button.children.includes(label)).props.onClick();
    }),
    close: () => { act(() => renderer.unmount()); delete globalThis[key]; },
  };
}

test('maternal catalog rows render once in their own subsection with original names and values', async () => {
  const page = await mount();
  try {
    assert.equal(page.calls.length, 1);
    const tables = page.renderer.root.findAllByType('table');
    assert.equal(tables.length, 1);
    const verifySection = (subsection, table) => {
      const expected = maternal.filter((row) => row.subsection === subsection.catalogSubsection);
      const rows = table.findByType('tbody').findAllByType('tr');
      assert.equal(rows.length, expected.length);
      rows.forEach((row, i) => {
        const cells = row.findAllByType('td');
        assert.equal(cells[0].children[0], expected[i].code);
        assert.equal(cells[1].children[0], expected[i].name);
        assert.equal(cells[2].children[0], String(maternal.indexOf(expected[i])));
        assert.match(cells[1].props.className, /whitespace-normal/);
      });
    };
    verifySection(getProgram('prenatal').subsections[0], tables[0]);
    await page.click('Intrapartum and Newborn Care');
    verifySection(getProgram('prenatal').subsections[1], page.renderer.root.findByType('table'));
    assert.doesNotMatch(page.text(), /"B3_28"/);
    await page.click('Postpartum Care');
    assert.equal(page.renderer.root.findAllByType('table').length, 1);
    verifySection(getProgram('prenatal').subsections[2], page.renderer.root.findByType('table'));
    assert.doesNotMatch(page.text(), /"B1_1"/);
    assert.equal(page.calls.length, 1, 'tab switches reuse the fetched reporting values');
    assert.doesNotMatch(page.text(), /Indicator B[123]_/);
    assert.doesNotMatch(page.text(), /Clinical definition and workbook compatibility notice/);
    assert.doesNotMatch(page.text(), /Reporting notes/);
    assert.doesNotMatch(page.text(), /Legacy catalog measures retain/);
    assert.doesNotMatch(page.text(), /Records include maternal cases contributing/);
  } finally { page.close(); }
});

test('monthly, quarterly and annual controls issue exactly one correctly shaped request', async () => {
  const page = await mount();
  try {
    assert.equal(page.calls[0].month, new Date().getMonth() + 1);
    await page.click('Quarterly');
    assert.deepEqual(page.calls[1], { period: 'quarterly', year: new Date().getFullYear(), quarter: reportingPeriod.quarterOfMonth0(new Date().getMonth()) });
    await page.click('Annual');
    assert.deepEqual(page.calls[2], { period: 'annual', year: new Date().getFullYear() });
    assert.equal(page.calls.length, 3);
  } finally { page.close(); }
});

test('API failures show an error and retry without fabricated indicator rows', async () => {
  let fail = true;
  const page = await mount(async () => { if (fail) throw new Error('Service unavailable'); return response(); });
  try {
    assert.match(page.text(), /Unable to load M1 data/);
    assert.match(page.text(), /Service unavailable/);
    assert.equal(page.renderer.root.findAllByType('table').length, 0);
    fail = false;
    await page.click('Try Again');
    assert.equal(page.calls.length, 2);
    assert.equal(page.renderer.root.findAllByType('table').length, 1);
  } finally { page.close(); }
});

test('missing names, wrong sections, nonnumeric values and unexpected subsections fail closed', async () => {
  for (const patch of [{ name: '' }, { name: 'Indicator B1_1' }, { section: 'A' }, { total: null }, { subsection: 'Unknown' }]) {
    const result = response();
    Object.assign(result.indicators.B1_1, patch);
    const page = await mount(async () => result);
    try {
      assert.match(page.text(), /Manual review required/);
      assert.equal(page.renderer.root.findAllByType('table').length, 0);
    } finally { page.close(); }
  }
});

test('empty reports are distinct from failed requests', async () => {
  const page = await mount(async () => ({ program: 'prenatal', records: [], indicators: {} }));
  try {
    assert.match(page.text(), /No indicator data/);
    assert.doesNotMatch(page.text(), /Unable to load M1 data/);
  } finally { page.close(); }
});

test('indicator View fetches real drilldown data for the selected reporting period', async () => {
  const calls = [];
  const page = await mount(undefined, async (...args) => { calls.push(args); return { records: [{ id: 'real-event' }], count: 1 }; });
  try {
    await act(async () => page.renderer.root.findAllByType('button').find((button) => button.children.includes('View')).props.onClick());
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], maternal[0].code);
    assert.deepEqual(calls[0][1], page.calls[0]);
    assert.match(page.text(), /real-event/);
  } finally { page.close(); }
});

test('quarterly drilldown uses the selected quarter and displays request failures', async () => {
  const calls = [];
  const page = await mount(undefined, async (...args) => { calls.push(args); throw new Error('Records unavailable'); });
  try {
    await page.click('Quarterly');
    await page.click('View');
    assert.deepEqual(calls[0][1], page.calls[1]);
    assert.equal(calls[0][1].period, 'quarterly');
    assert.match(page.text(), /Records unavailable/);
    assert.doesNotMatch(page.text(), /No underlying records available/);
    await page.click('Annual');
    assert.equal(page.renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
  } finally { page.close(); }
});

test('a superseded reporting request cannot overwrite the selected period', async () => {
  let resolveFirst;
  let first = true;
  const page = await mount(() => {
    if (first) {
      first = false;
      return new Promise((resolve) => { resolveFirst = resolve; });
    }
    const result = response();
    result.indicators.B1_1.total = 12345;
    return result;
  });
  try {
    await page.click('Annual');
    assert.match(page.text(), /12345/);
    await act(async () => { resolveFirst(response()); });
    assert.match(page.text(), /12345/);
    assert.equal(page.calls.length, 2);
  } finally { page.close(); }
});

test('enrollment displays actual API records instead of an empty indicator report', async () => {
  const page = await mount(async () => ({ program: 'enrollment', indicators: {}, records: [{
    id: 'enrollment-1', resident_id: 'resident-1', resident: { first_name: 'Ana', last_name: 'Cruz' },
    program: 'Existing health program', created_at: '2026-11-01T00:00:00Z', status: 'active', next_visit: '2026-11-15',
  }] }), undefined, 'enrollment');
  try {
    assert.match(page.text(), /Ana Cruz/);
    assert.match(page.text(), /Existing health program/);
    assert.match(page.text(), /2026-11-01/);
    assert.doesNotMatch(page.text(), /No indicator data/);
    assert.equal(page.renderer.root.findAllByType('table').length, 1);
  } finally { page.close(); }
});

test('category tabs render only the selected catalog subsection with original values', async () => {
  const indicators = M1_INDICATORS.filter((row) => row.section === getProgram('oral').fhsisSection)
    .map((row) => ({ ...row, total: 4 }));
  const page = await mount(async () => ({ program: 'oral', records: [], indicators: Object.fromEntries(indicators.map((row) => [row.code, row])) }), undefined, 'oral');
  try {
    const categories = [...new Set(indicators.map((row) => row.subsection))];
    for (const category of categories) {
      if (categories.length > 1) await page.click(category);
      assert.equal(page.renderer.root.findAllByType('table').length, 1);
      const visible = page.renderer.root.findByType('tbody').findAllByType('tr');
      assert.equal(visible.length, indicators.filter((row) => row.subsection === category).length);
      assert.equal(page.renderer.root.findAllByProps({ role: 'tab', 'aria-selected': true }).length, categories.length > 1 ? 1 : 0);
    }
    assert.equal(page.calls.length, 1);
  } finally { page.close(); }
});

test('NCD keeps Filariasis, Schistosomiasis and configured risk assessment categories separate', async () => {
  const indicators = M1_INDICATORS.filter((row) => row.section === 'E' || (row.section === 'F' && ['F_1', 'F_2', 'F_3', 'F_4', 'F_9', 'F_10'].includes(row.code)))
    .map((row) => ({ ...row, total: 7 }));
  const page = await mount(async () => ({ program: 'ncd', records: [], indicators: Object.fromEntries(indicators.map((row) => [row.code, row])) }), undefined, 'ncd');
  try {
    assert.doesNotMatch(page.text(), /Unable to load M1 data/);
    assert.ok(page.renderer.root.findAllByProps({ role: 'tab' }).some((tab) => tab.children.includes('E1. Filariasis')));
    await page.click('E2. Schistosomiasis');
    const visible = page.renderer.root.findByType('tbody').findAllByType('tr');
    const expected = indicators.filter((row) => row.subsection === 'E2. Schistosomiasis');
    assert.equal(visible.length, expected.length);
    visible.forEach((row, index) => assert.equal(row.findAllByType('td')[1].children[0], expected[index].name));
    assert.equal(page.calls.length, 1);
  } finally { page.close(); }
});

test('all seven program configurations render their real catalog responses without section mismatches', async () => {
  const sections = { prenatal: 'B', ncd: 'F', cervical: 'F', visual: 'F', oral: 'D', environmental: 'G', enrollment: null };
  for (const [programId, section] of Object.entries(sections)) {
    const catalog = section ? M1_INDICATORS.filter((row) => row.section === section).slice(0, 1) : [];
    const page = await mount(async () => ({ program: programId, records: [], indicators: Object.fromEntries(catalog.map((row) => [row.code, { ...row, total: 0 }])) }), undefined, programId);
    try {
      assert.doesNotMatch(page.text(), /Unable to load M1 data/, programId);
      assert.equal(page.renderer.root.findAllByType('table').length, programId === 'enrollment' ? 0 : 1, programId);
    } finally { page.close(); }
  }
});

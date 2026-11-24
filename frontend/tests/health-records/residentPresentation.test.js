import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { transformWithEsbuild } from 'vite';
import * as serviceFormat from '../../src/features/health-services/lib/visitPlanFormat.js';
import * as snapshotHelpers from '../../src/features/dashboards/lib/residentHealthSnapshot.js';
import { medicalHistoryForRecord } from '../../src/features/health-records/lib/healthRecordPdf.js';
import * as consultationRisk from '../../src/features/consultations/lib/consultationRisk.js';

const Empty = () => null;
const Container = ({ children }) => React.createElement('div', null, children);
const Header = ({ title, subtitle, action }) => React.createElement('header', null, title, subtitle, action);
const Range = () => null;
const text = (node) => JSON.stringify(node.toJSON());
const button = (renderer, label) => renderer.root.findAllByType('button').find((node) =>
  node.children.filter((child) => typeof child === 'string').join('').trim() === label);

async function compile(relativePath, imports, globals = {}) {
  const path = new URL(relativePath, import.meta.url);
  const { code } = await transformWithEsbuild(await readFile(path, 'utf8'), path.pathname, { loader: 'jsx', format: 'cjs', jsx: 'transform' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)((id) => {
    if (id === 'react') return React;
    if (id === 'lucide-react') return new Proxy({}, { get: () => Empty });
    assert.ok(Object.hasOwn(imports, id), `Unexpected dependency: ${id}`);
    return { __esModule: true, ...imports[id] };
  }, module, module.exports, ...Object.values(globals));
  return module.exports.default;
}

const latest = { id: 'latest', date: '2026-11-20', vitals: { bloodPressure: '120/80' } };
const older = { id: 'older', date: '2026-10-01', vitals: { bloodPressure: '110/70' } };
const fullRecord = {
  resident: { name: 'Test Resident', healthRecordNo: 'RHU-000123', sex: 'Female' }, consultations: [latest, older],
  vaccinations: [{ id: 'inside', date: '2026-10-01' }, { id: 'outside', date: '2026-11-20' }],
};

async function healthPage(t, respond = async () => fullRecord) {
  const calls = [];
  const exports = [];
  const timers = new Map();
  let timerId = 0;
  const Page = await compile('../../src/features/health-records/pages/HealthRecord.jsx', {
    '@/components/common/PageHeader': { default: Header },
    '@/components/common/Card': { Card: Container },
    '@/components/tables/TablePagination': { default: Empty },
    '@/components/common/DateRangeFilter': { default: Range, matchesDateRange: (value, from, to) => (!from || value >= from) && (!to || value <= to) },
    '@/components/common/UniversalDetailsModal': {
      default: ({ open, record, actions, onClose }) => open ? React.createElement('div', null,
        record.description,
        record.information?.map((item) => React.createElement('p', { key: item.label }, `${item.label}: ${item.value}`)),
        record.sections?.map((section) => React.createElement('section', { key: section.title },
          React.createElement('h3', null, section.title),
          section.content)),
        actions,
        React.createElement('button', { type: 'button', onClick: onClose }, 'Close')) : null,
    },
    '@/services/api': {
      residentsApi: { myHealthRecords: (params) => { calls.push(params); return respond(params); } },
      visitPlansApi: { directory: async () => ({ facilities: [] }) },
      referralsApi: { get: async () => ({ record: {} }) },
    },
    '@/context/AuthContext': { useAuth: () => ({ user: { id: 'resident-1', role: 'resident' } }) },
    '@/features/referrals/lib/referralPdf': { downloadReferralPdf: async () => {} },
    '@/features/health-records/lib/healthRecordPdf': { medicalHistoryForRecord, downloadHealthRecordPdf: async (data) => { exports.push(data); } },
    '@/features/consultations/lib/consultationRisk': consultationRisk,
    '@/features/consultations/utils/bpClassification': { bloodPressureBadgeClassName: () => '' },
    '@/components/common/RiskBadge': { default: ({ level, mediumLabel }) => React.createElement('span', null, level === 'Moderate' ? mediumLabel : level || 'Unassessed') },
    '@/features/health-records/lib/pregnancyVisibility': { shouldShowPregnancyStatus: () => true },
    '@/features/health-records/components/LabResultsPanel': { default: Empty },
    '@/lib/dateUtils': { formatLongDate: (value) => value },
  }, {
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(Page)); });
  t.after(() => act(() => renderer.unmount()));
  return { renderer, calls, exports, flush: () => act(async () => {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach((callback) => callback());
  }) };
}

test('range lives in history, preserves latest vitals, filters export immediately, and resets history', async (t) => {
  const { renderer, calls, exports, flush } = await healthPage(t, async (params) =>
    params.from ? { ...fullRecord, consultations: [older] } : fullRecord);
  assert.equal(renderer.root.findAllByType(Range).length, 0);
  assert.equal(renderer.root.findByType('header').findAllByType(Range).length, 0);
  await act(async () => button(renderer, 'Consultation History').props.onClick());
  const range = renderer.root.findByType(Range);
  await act(async () => {
    range.props.onFromChange('2026-10-01');
    range.props.onToChange('2026-10-01');
  });
  // Export before the history debounce fires must use the newly selected dates.
  await act(async () => { await renderer.root.findByProps({ 'aria-busy': false }).props.onClick(); });
  assert.deepEqual(calls.at(-1), { from: '2026-10-01', to: '2026-10-01' });
  assert.deepEqual(exports[0].consultations, [older]);
  assert.deepEqual(exports[0].vaccinations.map((item) => item.id), ['inside']);
  await flush();
  assert.match(text(renderer), /110\/70/);
  assert.doesNotMatch(text(renderer), /120\/80/);
  await act(async () => button(renderer, 'Overview').props.onClick());
  assert.match(text(renderer), /Latest Vitals.*2026-11-20/);
  assert.match(text(renderer), /120\/80/);
  await act(async () => button(renderer, 'Consultation History').props.onClick());
  await act(async () => button(renderer, 'Reset filters').props.onClick());
  assert.deepEqual(calls.at(-1), {});
  assert.equal(renderer.root.findByType(Range).props.from, '');
  assert.match(text(renderer), /120\/80/);
});

test('saved consultation risk, clinical context and dated prescriptions appear without medical-history placeholders', async (t) => {
  const assessment = { level: 'High', reasons: [{ ruleId: 'pregnancy_elevated_bp', message: 'High BP during pregnancy requires maternal evaluation.' }] };
  const recorded = { ...latest, serviceId: 'maternal-actual', serviceName: 'Registered Maternal Care', consultationRiskAssessment: assessment,
    clinicalContext: { pregnancyStatus: 'pregnant', existingConditions: [{ name: 'Hypertension', status: 'stable', significant: true }] },
    medicationList: [{ genericName: 'Recorded medicine', strength: '100 mg' }] };
  const { renderer, exports } = await healthPage(t, async () => ({ ...fullRecord, consultations: [recorded, older] }));
  assert.match(text(renderer), /Hypertension/);
  assert.match(text(renderer), /Pregnant \(recorded 2026-11-20\)/);
  assert.match(text(renderer), /Recorded medicine 100 mg \(recorded 2026-11-20\)/);
  assert.match(text(renderer), /High/);
  await act(async () => button(renderer, 'Consultation History').props.onClick());
  assert.match(text(renderer), /Registered Maternal Care/);
  assert.match(text(renderer), /High BP during pregnancy/);
  await act(async () => { await renderer.root.findByProps({ 'aria-busy': false }).props.onClick(); });
  assert.match(exports[0].medicalHistory.chronicConditions, /Hypertension/);
  assert.match(exports[0].medicalHistory.pregnancyStatus, /Pregnant/);
});

test('late filtered response cannot replace reset history', async (t) => {
  let finishFiltered;
  const { renderer, flush } = await healthPage(t, (params) => params.from
    ? new Promise((resolve) => { finishFiltered = resolve; }) : Promise.resolve(fullRecord));
  await act(async () => button(renderer, 'Consultation History').props.onClick());
  await act(async () => renderer.root.findByType(Range).props.onFromChange('2026-10-01'));
  await flush();
  await act(async () => button(renderer, 'Reset filters').props.onClick());
  await act(async () => finishFiltered({ ...fullRecord, consultations: [older] }));
  assert.match(text(renderer), /120\/80/);
  assert.match(text(renderer), /2 matching consultations/);
});

test('service details open per card, preserve registration, and show only supplied fields', async (t) => {
  const Page = await compile('../../src/features/health-services/pages/ResidentHealthServices.jsx', {
    '@radix-ui/react-dialog': {
      Root: Container, Portal: Container, Overlay: Empty, Content: Container,
      Title: Container, Description: Empty, Close: Container,
    },
    '@/components/common/PageHeader': { default: Header },
    '@/components/common/Card': { Card: Container },
    '@/components/common/ErrorState': { default: Empty },
    '@/components/common/Skeleton': { Skeleton: Empty },
    '@/components/tables/TablePagination': { default: Empty },
    '@/components/common/DateRangeFilter': { default: Range },
    '@/components/common/UniversalDetailsModal': {
      default: ({ open, record, actions, onClose }) => open ? React.createElement('div', null,
        record.description,
        record.information?.map((item) => React.createElement('p', { key: item.label }, `${item.label}: ${item.value}`)),
        record.sections?.map((section) => React.createElement('section', { key: section.title },
          React.createElement('h3', null, section.title),
          section.content)),
        actions,
        React.createElement('button', { type: 'button', onClick: onClose }, 'Close')) : null,
    },
    '@/context/AuthContext': { useAuth: () => ({ user: {} }) },
    '@/services/api': { visitPlansApi: { directory: async () => ({ facilities: [{ type: 'BHC', name: 'Test Center', services: [
      { id: 'a', name: 'Service A', description: 'First line\nSecond line\nThird line\nFourth line', facilityName: 'Test Center', visitPolicy: 'walk_in', availability: { open: true }, weekdays: [1], windowStart: '08:00', windowEnd: '10:00' },
      { id: 'b', name: 'Service B', description: 'Short description', availability: { open: false }, weekdays: [] },
    ] }] }) } },
    '../components/VisitPlanModal': { default: Empty },
    '../lib/visitPlanFormat': serviceFormat,
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(Page)); });
  t.after(() => act(() => renderer.unmount()));
  const cards = renderer.root.findAllByType('article');
  const detailButtons = () => renderer.root.findAllByType('button').filter((node) => node.children.join('').trim() === 'View details');
  assert.equal(detailButtons().length, 2);
  assert.equal(cards[0].findAllByType('h3').length, 1);
  assert.doesNotMatch(cards[0].props.className, /h-full/);
  await act(async () => detailButtons()[0].props.onClick());
  assert.match(text(renderer), /Recurring days/);
  assert.match(text(renderer), /Barangay or facility/);
  assert.doesNotMatch(text(renderer), /Requirements|Eligibility|Schedule to be announced/);
  assert.ok(button(renderer, 'Register'));
  await act(async () => button(renderer, 'Close').props.onClick());
  assert.equal(renderer.root.findAllByType('article').length, 2);
});

test('dashboard snapshot retains latest values and recent activity without chart presentation', async (t) => {
  const Snapshot = await compile('../../src/features/dashboards/components/ResidentHealthSnapshot.jsx', {
    'react-router-dom': { Link: Container },
    '@/features/dashboards/lib/residentHealthSnapshot': snapshotHelpers,
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(Snapshot, { health: { consultations: [older, latest], riskLevel: 'low' }, loading: false, timeline: [{ type: 'Health consultation', title: 'Consultation recorded', date: latest.date }] })); });
  t.after(() => act(() => renderer.unmount()));
  assert.match(text(renderer), /120\/80/);
  assert.match(text(renderer), /Low Risk/);
  assert.match(text(renderer), /Recent health activity/);
  assert.equal(renderer.root.findAllByType('svg').length, 0);
  assert.doesNotMatch(text(renderer), /Vitals trend|Total consultations|Completed follow-ups/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { transformWithEsbuild } from 'vite';

const require = createRequire(import.meta.url);
const filename = new URL('../../src/features/settings/components/SubmittedRequests.jsx', import.meta.url);
const { code } = await transformWithEsbuild(await readFile(filename, 'utf8'), filename.pathname, { loader: 'jsx', format: 'cjs', jsx: 'transform' });
const text = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join(' ') : node?.children ? text(node.children) : '';
const request = { id: 'historic-approved', status: 'approved', fromBarangay: 'San Isidro', toBarangay: 'San Antonio', submittedAt: '2026-09-10T01:00:00Z', reviewedAt: '2026-09-11T01:00:00Z' };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
async function mount(t, {
  get = async () => ({ history: [request] }),
  query = '',
  verification = { request: null },
} = {}) {
  const calls = [];
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === '@/services/api') return { api: { get: async (path) => { calls.push(path); return get(path); } } };
    if (id === '@/services/api/verificationsApi') return { fetchMyVerification: async () => verification };
    if (id === '@/features/verification/components/VerificationBanner') return () => null;
    if (id === '@/context/AuthContext') return { useAuth: () => ({ user: { id: 'resident-1', role: 'resident' } }) };
    if (id === '@/components/common/Card') return { Card: ({ children, ...props }) => React.createElement('div', props, children) };
    if (id === 'lucide-react') return { RefreshCw: () => null };
    return require(id);
  }, module, module.exports);
  let renderer;
  await act(async () => { renderer = create(React.createElement(MemoryRouter, { initialEntries: [`/app/resident/profile${query}`] }, React.createElement(module.exports.default))); });
  t.after(() => act(() => renderer.unmount()));
  return { renderer, calls, text: () => text(renderer.toJSON()).replace(/\s+/g, ' '), click: async (label, index = 0) => {
    const button = renderer.root.findAllByType('button')
      .filter((node) => text(node).replace(/\s+/g, ' ').trim().toLowerCase().includes(label.toLowerCase()))[index];
    assert.ok(button, `Expected ${label}`);
    await act(async () => { button.props.onClick(); });
  } };
}

test('submitted history loads real outcomes and requests historical signed detail by its own id', async (t) => {
  const page = await mount(t, { query: '?request=historic-approved', get: async (path) => path.endsWith('/context')
    ? { history: [{ ...request, id: 'new-pending', status: 'pending' }, request] }
    : { transfer: { ...request, documents: [{ id: 'proof', fileName: 'original-address.pdf', readOnly: true, url: 'https://storage.example.test/signed' }] } } });
  assert.deepEqual(page.calls, ['/transfer-requests/context', '/transfer-requests/me/historic-approved']);
  assert.match(page.text(), /Pending/);
  assert.match(page.text(), /Residency transfer · Approved/);
  assert.match(page.text(), /San Isidro to San Antonio/);
  assert.match(page.text(), /September 10, 2026 · 9:00 AM/);
  assert.match(page.text(), /original-address.pdf/);
  assert.match(page.text(), /read-only/);
  const link = page.renderer.root.findByProps({ href: 'https://storage.example.test/signed' });
  assert.equal(link.props.target, '_blank');
  assert.equal(page.renderer.root.findAllByType('input').length, 0);
  assert.doesNotMatch(page.text(), /Delete|Upload|Provide corrections/);
});

test('history distinguishes loading, empty, errors and retry without inventing requests', async (t) => {
  const pending = deferred();
  let fail = false;
  const page = await mount(t, { get: async () => {
    if (fail) throw new Error('History unavailable');
    return pending.promise;
  } });
  assert.match(page.text(), /Loading submitted requests/);
  await act(async () => { pending.resolve({ history: [] }); });
  assert.match(page.text(), /No submitted requests yet/);
  fail = true;
  await page.click('Refresh Requests');
  assert.match(page.text(), /History unavailable/);
  fail = false;
  await page.click('Refresh Requests');
  assert.match(page.text(), /No submitted requests yet/);
});

test('request selection ignores a stale response after closing details', async (t) => {
  const pending = deferred();
  const page = await mount(t, { get: async (path) => path.endsWith('/context') ? { history: [request] } : pending.promise });
  await page.click('View request');
  assert.match(page.text(), /Loading request details/);
  await page.click('Close details');
  await act(async () => { pending.resolve({ transfer: { ...request, reason: 'Stale reason' } }); });
  assert.doesNotMatch(page.text(), /Stale reason|Residency transfer:/);
});

test('only returned requests expose the corrections action and refreshing renews signed detail', async (t) => {
  const correction = { ...request, status: 'resubmission_required', resubmissionInstructions: 'Please replace the address proof.' };
  const page = await mount(t, { query: '?request=historic-approved', get: async (path) => path.endsWith('/context') ? { history: [correction] } : { transfer: correction } });
  assert.match(page.text(), /Please replace the address proof/);
  assert.equal(page.renderer.root.findByType('a').props.href, '/register/transfer');
  await page.click('Refresh Requests');
  assert.equal(page.calls.filter((path) => path === '/transfer-requests/me/historic-approved').length, 2);
});

test('registration and transfers are sorted together with distinct status badges', async (t) => {
  const page = await mount(t, {
    verification: {
      hasResidentRecord: true,
      verification: {
        submittedByCurrentUser: true,
        status: 'approved',
        barangay: 'San Isidro',
        submittedAt: '2026-09-12T00:00:00Z',
      },
    },
    get: async () => ({
      history: [
        { ...request, id: 'under-review', status: 'under_review', submittedAt: '2026-09-13T00:00:00Z' },
        { ...request, id: 'rejected', status: 'rejected', submittedAt: '2026-09-10T00:00:00Z' },
        { ...request, id: 'pending', status: 'pending', submittedAt: '2026-09-11T00:00:00Z' },
      ],
    }),
  });
  const rows = page.renderer.root.findAllByType('li').map(text);
  assert.equal(rows.length, 4);
  assert.match(rows[0], /Under Review/);
  assert.match(rows[1], /Resident registration/);
  assert.match(rows[1], /Approved/);
  assert.match(rows[2], /Pending/);
  assert.match(rows[3], /Rejected/);
  const badgeTone = (label) => page.renderer.root.findAll((node) => node.type === 'span' && text(node) === label)[0].props.className;
  assert.match(badgeTone('Under Review'), /text-blue-800/);
  assert.match(badgeTone('Approved'), /text-emerald-800/);
  assert.match(badgeTone('Pending'), /text-amber-800/);
  assert.match(badgeTone('Rejected'), /text-rose-800/);
  assert.doesNotMatch(page.text(), /Verification status|Manual review|Approved by Health Supervisor/);
});

test('historical detail errors are explicit and do not erase the submitted history', async (t) => {
  const page = await mount(t, { query: '?request=not-owned', get: async (path) => {
    if (path.endsWith('/context')) return { history: [request] };
    throw new Error('Transfer request not found.');
  } });
  assert.match(page.text(), /Transfer request not found/);
  assert.match(page.text(), /San Isidro to San Antonio/);
  assert.equal(page.renderer.root.findAllByType('a').length, 0);
});

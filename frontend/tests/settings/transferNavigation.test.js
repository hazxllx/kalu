import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { transformWithEsbuild } from 'vite';

const require = createRequire(import.meta.url);
const text = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join(' ') : node?.children ? text(node.children) : '';
const panel = ({ children }) => React.createElement('div', null, children);
const empty = () => null;
const common = {
  '@/components/common/Card': { Card: panel },
  'lucide-react': new Proxy({}, { get: () => empty }),
  'framer-motion': { motion: { div: panel, li: ({ children }) => React.createElement('li', null, children) } },
};
async function load(relative, overrides) {
  const filename = new URL(relative, import.meta.url);
  const { code } = await transformWithEsbuild(await readFile(filename, 'utf8'), filename.pathname, { loader: 'jsx', format: 'cjs', jsx: 'transform' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (Object.hasOwn(common, id)) return common[id];
    return require(id);
  }, module, module.exports);
  return module.exports.default;
}

for (const role of ['resident', 'resident-limited', 'health_supervisor']) {
  test(`${role} opens an approval notification at the exact request and persists its read state`, async (t) => {
    const navigations = [];
    const marked = [];
    const Page = await load('../../src/features/notifications/pages/NotificationsPage.jsx', {
      'react-router-dom': { useNavigate: () => (path) => navigations.push(path) },
      '@/context/AuthContext': { useAuth: () => ({ role }) },
      '@/components/ui/use-toast': { useToast: () => ({ toast: () => {} }) },
      '@/components/common/PageHeader': empty,
      '@/components/common/EmptyState': empty,
      '@/services/local/notificationData': { ICONS: {}, CATEGORIES: {} },
      '@/services/notifications/unreadBus': { notifyUnreadChanged: () => {} },
      '@/services/api': { notificationsApi: {
        list: async () => ({ rows: [{ id: 'notice', title: 'Residency transfer approved', related_type: 'transfer_request_approved', related_id: 'historic request', category: 'information', created_at: '2026-11-20T01:00:00Z' }] }),
        markRead: async (id) => { marked.push(id); return { record: { id, read_at: '2026-11-21T01:00:00Z' } }; },
      } },
    });
    let renderer;
    await act(async () => { renderer = create(React.createElement(Page)); });
    t.after(() => act(() => renderer.unmount()));
    const notification = renderer.root.findAllByProps({ role: 'button' })[0];
    await act(async () => { await notification.props.onClick(); });
    assert.deepEqual(marked, ['notice']);
    assert.deepEqual(navigations, [role === 'health_supervisor'
      ? '/app/health_supervisor/transfer-requests?request=historic%20request'
      : '/app/resident/profile?request=historic%20request#submitted-requests']);
  });
}

test('approved transfer banner is absent from dashboard while pending requests remain visible', async (t) => {
  let transfer = { status: 'approved', residencyStatus: 'transfer_approved' };
  const Banner = await load('../../src/features/verification/components/TransferStatusBanner.jsx', {
    '@/services/api': { api: { get: async () => ({ transfer }) } },
    'react-router-dom': { Link: panel },
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(Banner)); });
  assert.equal(renderer.toJSON(), null);
  act(() => renderer.unmount());
  transfer = { status: 'pending', residencyStatus: 'transfer_pending', fromBarangay: 'San Isidro', toBarangay: 'San Antonio' };
  await act(async () => { renderer = create(React.createElement(Banner)); });
  t.after(() => act(() => renderer.unmount()));
  assert.match(text(renderer.toJSON()), /Your transfer request is being reviewed/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { transformWithEsbuild } from 'vite';

const require = createRequire(import.meta.url);
const path = new URL('../../src/features/dashboards/components/RecentBarangayUpdates.jsx', import.meta.url);
const { code } = await transformWithEsbuild(await readFile(path, 'utf8'), path.pathname, { loader: 'jsx', format: 'cjs', jsx: 'transform' });
const module = { exports: {} };
new Function('require', 'module', 'exports', code)((id) => {
  if (id === '@/components/common/ErrorState') return ({ title }) => React.createElement('p', { role: 'alert' }, title);
  if (id === 'lucide-react') return Object.fromEntries(['Activity', 'CalendarClock', 'ClipboardCheck', 'FilePlus2', 'Send'].map((name) => [name, () => React.createElement('svg')]));
  return require(id);
}, module, module.exports);
const Feed = module.exports.default;
const event = { id: 'event-1', kind: 'follow_up_completed', title: 'Follow-up completed', description: 'A follow-up completion was recorded.', occurredAt: '2026-11-20T01:20:00Z', target: { type: 'follow_up', id: 'followup-1' } };
const render = (props) => renderToStaticMarkup(React.createElement(StaticRouter, { location: '/' }, React.createElement(Feed, props)));

test('feed links only permitted record targets and formats the real timestamp in Philippine time', () => {
  const source = { data: { activities: [event] } };
  const allowed = render({ source, allowed: true, can: (key) => key === 'followups.view' });
  assert.match(allowed, /href="\/app\/health_supervisor\/followups\?followup=followup-1"/);
  assert.match(allowed, /dateTime="2026-11-20T01:20:00Z"/i);
  assert.match(allowed, /9:20 AM/);
  const restricted = render({ source, allowed: true, can: () => false });
  assert.doesNotMatch(restricted, /href=|followup-1/);
  assert.match(restricted, /Follow-up completed/);
});

test('feed distinguishes empty, loading, failed and unavailable states', () => {
  assert.match(render({ source: { data: { activities: [] } }, allowed: true }), /No recent monitoring activities recorded/);
  assert.match(render({ source: { loading: true }, allowed: true }), /Loading recent activities/);
  assert.match(render({ source: { error: 'Unavailable' }, allowed: true }), /Recent updates unavailable/);
  assert.match(render({ source: { data: { activities: [event] } }, allowed: false }), /Monitoring activity access unavailable/);
  assert.doesNotMatch(render({ source: { data: { activities: [event] } }, allowed: false }), /Follow-up completed/);
});

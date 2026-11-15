import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { transform } from 'esbuild';

const headerSource = await readFile(new URL('../../src/features/health-records/components/M1PageHeader.jsx', import.meta.url), 'utf8');
const backSource = await readFile(new URL('../../src/features/health-records/components/M1BackButton.jsx', import.meta.url), 'utf8');
const preparedBackSource = backSource.replace(/import \{ TCL_BACK_BUTTON_CLASS \} from "\.\/BackToTclButton";/,
  'const TCL_BACK_BUTTON_CLASS = "tcl-back-button";');
const compiled = await transform(preparedBackSource.replace(/from "(react|react-router-dom|lucide-react)"/g,
  (_match, name) => `from ${JSON.stringify(import.meta.resolve(name))}`), { loader: 'jsx', jsx: 'transform' });
const { default: M1BackButton } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);

async function mount({ state, entries = ['/direct'], fallback = '/app/health_supervisor/m1' } = {}) {
  const previousWindow = globalThis.window;
  globalThis.window = { history: { state, length: 20 } };
  const router = createMemoryRouter([{ path: '*', element: React.createElement(M1BackButton, { fallback, label: 'Back to M1 Programs' }) }], { initialEntries: entries, initialIndex: entries.length - 1 });
  let renderer;
  await act(async () => { renderer = create(React.createElement(RouterProvider, { router })); });
  return {
    router,
    back: () => act(async () => renderer.root.findByType('button').props.onClick()),
    close: () => {
      act(() => renderer.unmount());
      router.dispose();
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    },
  };
}

test('M1 overview and detail headers compose the authoritative Dashboard and TCL headers', () => {
  assert.match(headerSource, /HealthSupervisorPageHeader/);
  assert.match(headerSource, /TclPageHeader/);
  assert.match(headerSource, /variant === "overview"/);
  assert.match(headerSource, /M1BackButton/);
  assert.doesNotMatch(headerSource, /#[0-9A-Fa-f]{3,8}/);
});

test('detail Back uses app history when a previous M1 page exists', async () => {
  const page = await mount({ state: { idx: 1 }, entries: ['/app/health_supervisor/m1?month=5', '/app/health_supervisor/m1/oral-detail'] });
  try {
    await page.back();
    assert.equal(page.router.state.location.pathname, '/app/health_supervisor/m1');
    assert.equal(page.router.state.location.search, '?month=5');
    assert.equal(page.router.state.historyAction, 'POP');
  } finally { page.close(); }
});

test('direct detail visits replace with the contextual M1 fallback', async () => {
  const fallback = '/app/health_supervisor/m1-fhsis?period=quarterly&year=2026&quarter=2';
  const page = await mount({ state: { idx: 0 }, fallback });
  try {
    await page.back();
    assert.equal(page.router.state.location.pathname + page.router.state.location.search, fallback);
    assert.equal(page.router.state.historyAction, 'REPLACE');
  } finally { page.close(); }
});

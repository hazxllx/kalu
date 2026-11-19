import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const text = await readFile(new URL('../../src/features/dashboards/pages/MHODashboard.jsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('MHODashboard.jsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
let callback;
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'loadMap') {
    callback = node.initializer.arguments[0].getText(source);
  }
  ts.forEachChild(node, visit);
};
visit(source);
const load = new Function('mapRequest', 'fetchCommunityMap', 'condition', 'mapRange', 'setMap', 'setMapStatus', `return (${callback});`);

test('KFT-015 a late response or failure from an older reporting year cannot replace the current map', async () => {
  for (const failOld of [false, true]) {
    const pending = [];
    const request = { current: 0 };
    const fetch = (params) => new Promise((resolve, reject) => pending.push({ params, resolve, reject }));
    let map;
    let status;
    const make = (year) => load(request, fetch, 'All', { from: `${year}-01-01`, to: `${year}-12-31` },
      (value) => { map = value; }, (value) => { status = value; });
    const old = make(2025)();
    const current = make(2026)();
    assert.equal(map, null, 'previous period values are not presented as current while loading');
    assert.equal(pending[1].params.from, '2026-01-01');
    pending[1].resolve({ year: 2026 });
    await current;
    if (failOld) pending[0].reject(new Error('Synthetic older-year error'));
    else pending[0].resolve({ year: 2025 });
    await old;
    assert.deepEqual(map, { year: 2026 });
    assert.deepEqual(status, { loading: false, error: null });
  }
});

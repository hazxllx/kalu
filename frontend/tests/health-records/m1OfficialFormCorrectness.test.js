import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { transform } from 'esbuild';
import { M1_FORM_TEMPLATE } from '../../src/features/health-records/lib/m1OfficialFormTemplate.js';

const source = await readFile(new URL('../../src/features/health-records/components/M1OfficialForm.jsx', import.meta.url), 'utf8');
const deps = { M1_FORM_TEMPLATE, loadDocumentBranding: async () => ({}) };
globalThis.__m1OfficialCorrectness = deps;
const injected = source.replace(/^import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2;?/gm, (statement, bindings, _quote, path) => {
  if (path === 'react' || path === 'react-dom') return statement.replace(new RegExp(`['"]${path}['"]`), JSON.stringify(import.meta.resolve(path)));
  return `const ${bindings.replace(/\bas\b/g, ':')} = globalThis.__m1OfficialCorrectness;`;
});
const compiled = await transform(injected, { loader: 'jsx', jsx: 'transform' });
const { default: M1OfficialForm } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
delete globalThis.__m1OfficialCorrectness;

const allRows = (blocks) => blocks.flatMap((block) => block.rows || (block.type === 'split' ? [...allRows(block.left), ...allRows(block.right)] : []));
const mounted = (data) => {
  let renderer;
  act(() => { renderer = create(React.createElement(M1OfficialForm, { data })); });
  const row = (label) => renderer.root.findAllByType('tr').find((item) => item.findAllByType('td')[0]?.children.join('') === label);
  return { renderer, row, close: () => act(() => renderer.unmount()) };
};

test('workbook 8ANC/4PNC rows explicitly reject incompatible legacy four/two totals', () => {
  const rows = allRows(M1_FORM_TEMPLATE);
  const prenatal = rows.find((row) => row.code === 'B1_1');
  const postpartum = rows.find((row) => row.code === 'B3_28');
  assert.equal(prenatal.mappingStatus, 'unverified');
  assert.equal(postpartum.mappingStatus, 'unverified');
  const form = mounted({
    B1_1: { total: 7, byAge: { '10-14': 1, '15-19': 2, '20-49': 4 } },
    B3_28: { total: 5, byAge: { '10-14': 0, '15-19': 1, '20-49': 4 } },
  });
  try {
    for (const item of [prenatal, postpartum]) {
      const cells = form.row(item.label).findAllByType('td');
      assert.deepEqual(cells.slice(1, 5).map((cell) => cell.children.join('')), ['', '', '', '']);
      assert.match(cells[5].children.join(''), /Unverified.*legacy.*Approval required/);
    }
    assert.match(JSON.stringify(form.renderer.toJSON()), /not a verified workbook submission/);
  } finally { form.close(); }
});

test('unmapped and unavailable values stay blank while recorded compatible zero remains zero', () => {
  const rows = allRows(M1_FORM_TEMPLATE);
  const mapped = rows.find((row) => row.code === 'B1_2');
  const missing = rows.find((row) => row.code === 'B1_5');
  const unmapped = rows.find((row) => !row.code && /Multiple Micronutrient/.test(row.label));
  const form = mounted({ B1_2: { total: 0, byAge: { '10-14': 0, '15-19': 0, '20-49': 0 } } });
  try {
    assert.deepEqual(form.row(mapped.label).findAllByType('td').slice(1, 5).map((cell) => cell.children.join('')), ['0', '0', '0', '0']);
    for (const item of [missing, unmapped]) assert.deepEqual(form.row(item.label).findAllByType('td').slice(1, 5).map((cell) => cell.children.join('')), ['', '', '', '']);
  } finally { form.close(); }
});

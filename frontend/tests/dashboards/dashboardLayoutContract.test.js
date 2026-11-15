import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('DashboardLayout defines items using useMemo and filterNavByPermission', async () => {
  const source = await readFile(new URL('../../src/layouts/DashboardLayout.jsx', import.meta.url), 'utf8');

  // Verify that `items` is defined before it is used
  assert.match(
    source,
    /const\s+items\s*=\s*useMemo\s*\(\s*\(\)\s*=>\s*filterNavByPermission\s*\(\s*NAV\[roleKey\]\s*\|\|\s*\[\],\s*can,\s*user\s*\),\s*\[roleKey,\s*can,\s*user\]\s*\);/,
    'DashboardLayout must define items via filterNavByPermission'
  );

  // Verify that items definition appears before activeItem usage
  const itemsDefPos = source.indexOf('const items = useMemo');
  const activeItemPos = source.indexOf('const activeItem = items.find');
  assert.ok(itemsDefPos > 0, 'items definition must exist');
  assert.ok(activeItemPos > 0, 'activeItem must exist');
  assert.ok(itemsDefPos < activeItemPos, 'items must be defined before activeItem is evaluated');

  // Verify that visibleItems uses items
  const visibleItemsPos = source.indexOf('const visibleItems = items.filter');
  assert.ok(visibleItemsPos > 0, 'visibleItems must use items');
  assert.ok(itemsDefPos < visibleItemsPos, 'items must be defined before visibleItems is evaluated');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { conditionColor, mapLegend } from '../../src/features/analytics/lib/communityMapLegend.js';

const point = (count, conditions = []) => ({ displayedCaseCount: count, displayedConditions: conditions });

test('layer legends match recorded markers without implying unassessed or completed residents', () => {
  for (const [metric, label, color] of [
    ['Recorded Cases', 'Recorded cases', '#2563A6'],
    ['High-Risk Residents', 'High-risk residents', '#B3202C'],
    ['Pending Follow-ups', 'Pending follow-up', '#B78320'],
  ]) {
    const legend = mapLegend(metric, [point(3), point(0)], true);
    assert.equal(legend.color, color);
    assert.deepEqual(legend.entries, [{ label, color }, { label: `No ${label.toLowerCase()} recorded`, color: '#8294A8' }, { label: 'Selected barangay', color: '#2563A6', outline: true }]);
    assert.ok(legend.entries.every((item) => !/unassessed|completed/i.test(item.label)));
  }
});

test('condition legend contains only visible positive categories and matches ring colors', () => {
  const legend = mapLegend('Common Conditions', [point(4, [{ name: 'Dengue', value: 2 }, { name: 'Diabetes', value: 2 }, { name: 'Maternal', value: 0 }]), point(2, [{ name: 'Dengue', value: 2 }])], false);
  assert.deepEqual(legend.entries, ['Dengue', 'Diabetes'].map((label) => ({ label, color: conditionColor(label) })));
  assert.notEqual(conditionColor('Dengue'), conditionColor('Diabetes'));
  assert.deepEqual(mapLegend('Recorded Cases', [], false).entries, []);
});

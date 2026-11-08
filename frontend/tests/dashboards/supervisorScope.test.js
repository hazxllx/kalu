import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../src/lib/supervisorScope.js', import.meta.url), 'utf8');
const moduleSource = source
  .replace('"@/lib/roles"', JSON.stringify(new URL('../../src/lib/roles.js', import.meta.url).href))
  .replace('"@/lib/barangays"', JSON.stringify(new URL('../../src/lib/barangays.js', import.meta.url).href));
const scope = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
const supervisor = (barangay) => ({ role: 'health_supervisor', barangay });

test('supervisor coverage is only its authenticated approved assignment', () => {
  assert.deepEqual(scope.getSupervisorScope(supervisor('San Antonio')), { level: 'barangay', assignedBarangay: 'San Antonio' });
  assert.deepEqual(scope.supervisorVisibleBarangays(supervisor('San Antonio')), ['San Antonio']);
  assert.equal(scope.supervisorCoverageLabel(supervisor('San Antonio')), 'San Antonio');
});

test('missing and unsupported assignments fail closed instead of becoming municipal', () => {
  for (const user of [supervisor(null), supervisor(''), supervisor('Unregistered Barangay')]) {
    assert.equal(scope.getSupervisorScope(user).level, 'unassigned');
    assert.deepEqual(scope.supervisorVisibleBarangays(user), []);
    assert.equal(scope.supervisorCoverageLabel(user), 'Assignment unavailable');
    assert.deepEqual(scope.filterSupervisorRows([{ barangay: 'San Antonio' }], user), []);
  }
});

test('rows from other barangays or without authorized geography stay out of the supervisor view', () => {
  assert.deepEqual(scope.filterSupervisorRows([
    { id: 'assigned', barangay: 'San Antonio' },
    { id: 'outside', barangay: 'San Isidro' },
    { id: 'unknown' },
  ], supervisor('San Antonio')).map((row) => row.id), ['assigned']);
});

test('this refinement does not change scope behavior for other roles', () => {
  const user = { role: 'mho' };
  const rows = [{ barangay: 'San Antonio' }, { barangay: 'San Isidro' }];
  assert.equal(scope.getSupervisorScope(user), null);
  assert.deepEqual(scope.filterSupervisorRows(rows, user), rows);
});

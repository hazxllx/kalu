import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { normalizeResident, normalizeTcl, loadResidentDirectory, workersForResident, tclDateError } from '../../src/features/health-records/lib/tclData.js';

const workerId = '00000000-0000-4000-8000-000000000001';

test('TCL rows keep stable server IDs and returned clinical/schedule fields', () => {
  const record = normalizeTcl({ id: 'tcl-server', resident_id: 'resident-server', assigned_bhw: workerId, assignedBhwName: 'Actual worker', program: 'Diabetes', status: 'Monitoring', priority: 'High', last_visit: '2026-10-01', next_visit: '2026-11-07', notes: 'Saved notes' });
  assert.equal(record.id, 'tcl-server');
  assert.equal(record.residentId, 'resident-server');
  assert.equal(record.bhwId, workerId);
  assert.equal(record.bhw, 'Actual worker');
  assert.equal(record.status, 'Monitoring');
  assert.equal(record.nextVisit, '2026-11-07');
  assert.equal(record.notes, 'Saved notes');
  assert.throws(() => normalizeTcl(null), /incomplete TCL record/);
  assert.throws(() => normalizeTcl({ id: 'missing-resident' }), /incomplete TCL record/);
});

test('residents sharing a display name are never linked by name', async () => {
  const rows = await loadResidentDirectory(async () => ({ rows: [{ id: 'r1', firstName: 'Same', lastName: 'Name', barangayId: 'b1' }, { id: 'r2', firstName: 'Same', lastName: 'Name', barangayId: 'b2' }], total: 2 }));
  assert.deepEqual(rows.map((row) => row.id), ['r1', 'r2']);
  assert.equal(rows[0].name, rows[1].name);
  assert.equal(normalizeResident({ name: 'No server identity' }), null);
});

test('TCL registry reads residents beyond the first page and propagates source failures', async () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({ id: `r-${index}`, firstName: 'Resident', lastName: String(index) }));
  const offsets = [];
  const result = await loadResidentDirectory(async ({ limit, offset }) => {
    offsets.push(offset);
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  });
  assert.equal(result.length, 205);
  assert.deepEqual(offsets, [0, 100, 200]);
  await assert.rejects(loadResidentDirectory(async () => { throw new Error('Scoped API unavailable'); }), /Scoped API unavailable/);
  await assert.rejects(loadResidentDirectory(async () => ({})), /incomplete/);
  await assert.rejects(loadResidentDirectory(async () => ({ rows: [{ firstName: 'Missing identity' }] })), /stable identity/);
  await assert.rejects(loadResidentDirectory(async () => ({ rows: [], total: 1 })), /incomplete/);
});

test('only a genuine BHW in the selected resident barangay can be assigned', () => {
  const workers = [{ id: workerId, role: 'bhw', barangayId: 'b1' }, { id: 'other', role: 'bhw', barangayId: 'b2' }, { id: 'phn', role: 'phn', barangayId: null }];
  assert.deepEqual(workersForResident(workers, { id: 'resident', barangayId: 'b1' }).map((row) => row.id), [workerId]);
  assert.deepEqual(workersForResident(workers, { barangay: 'Unresolved display name' }), []);
  assert.deepEqual(workersForResident(workers, null), []);
});

test('enrollment does not imply a visit and validates actual date/time values', () => {
  assert.equal(tclDateError({ lastVisit: '', nextVisit: '', nextVisitTime: '' }), '');
  assert.notEqual(tclDateError({ lastVisit: '2026-02-30' }), '');
  assert.notEqual(tclDateError({ nextVisitTime: '09:00' }), '');
  assert.notEqual(tclDateError({ nextVisit: '2026-11-07', nextVisitTime: '25:00' }), '');
  assert.notEqual(tclDateError({ lastVisit: '2026-11-08', nextVisit: '2026-11-07' }), '');
  assert.equal(tclDateError({ nextVisit: '2026-11-07', nextVisitTime: '09:00' }), '');
});

test('bounded UI surfaces have no fabricated workers, local resident cache or name-based writes', async () => {
  const paths = ['features/households/pages/AddHouseholdPage.jsx', 'features/households/components/RiskActionModals.jsx', 'features/health-records/pages/TCLS.jsx'];
  const [add, risk, tcl] = await Promise.all(paths.map((path) => readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8')));
  for (const source of [add, risk, tcl]) assert.doesNotMatch(source, /Maria Cruz|Lourdes Ramos|Grace Aquino|Maria Dela Cruz|Ana Villanueva|ACTIVE_BHWS|services\/local\/(?:residentStore|dashboardData)/);
  assert.doesNotMatch(add, /collectorName:\s*form\./);
  assert.match(add, /Data Collector[\s\S]*?readOnly value=\{user\?\.name/);
  assert.match(risk, /await onSave\(selectedWorker.id, selectedWorker.role\)/);
  assert.match(tcl, /await tclApi\.create/);
  assert.match(tcl, /applyServerRecord\(result\)/);
  assert.doesNotMatch(tcl, /lastVisit:\s*todayIso\(/);
  const hook = await readFile(new URL('../../src/hooks/useHouseholdWorkers.js', import.meta.url), 'utf8');
  assert.match(hook, /current === request.current/);
  assert.match(hook, /state.ownerId === ownerId/);
  assert.doesNotMatch(hook, /localStorage|sessionStorage|\/users/);
});

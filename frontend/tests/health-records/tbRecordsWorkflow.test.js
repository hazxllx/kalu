import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadResidentDirectory,
  normalizeResident,
  workersForResident,
} from '../../src/features/health-records/lib/tclData.js';
import {
  buildTbRecordPayload,
  mapTbRecord,
  validateTbRecordForm,
} from '../../src/features/health-records/lib/tbRecords.js';

const BHW_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_BHW_UUID = '22222222-2222-4222-8222-222222222222';

test('P0-8: mapTbRecord extracts BHW UUID cleanly into bhwId without losing bhw name', () => {
  const mapped = mapTbRecord({
    id: 'tb-1',
    resident_id: 'res-1',
    program: 'TB Patients',
    assigned_bhw: BHW_UUID,
    assigned_bhw_name: 'BHW J. Santos',
    priority: 'High',
    status: 'Active',
    last_visit: '2026-06-01',
    next_visit: '2026-06-15',
  });
  assert.equal(mapped.bhwId, BHW_UUID);
  assert.equal(mapped.bhw, 'BHW J. Santos');
  assert.equal(Object.hasOwn(mapped, 'nextVisitTime'), false);
});

test('P0-8: validateTbRecordForm enforces BHW UUID selection in resident barangay, dates, and edit duplicate exclusion', () => {
  const workers = [
    { id: BHW_UUID, role: 'bhw', barangayId: 'brgy-1', fullName: 'BHW Santos' },
    { id: OTHER_BHW_UUID, role: 'bhw', barangayId: 'brgy-2', fullName: 'BHW Other' },
  ];
  const resident = normalizeResident({ id: 'res-1', firstName: 'Juan', lastName: 'Cruz', barangayId: 'brgy-1', barangay: 'San Jose' });
  const assignable = workersForResident(workers, resident);
  assert.deepEqual(assignable.map((w) => w.id), [BHW_UUID]);

  // Free text or out-of-barangay worker UUID is rejected.
  const badBhwErr = validateTbRecordForm({
    form: {
      residentId: 'res-1',
      program: 'TB Patients',
      bhw: 'free text name',
      lastVisit: '2026-06-10',
      nextVisit: '2026-06-20',
    },
    assignableBhws: assignable,
    records: [],
  });
  assert.match(badBhwErr.bhw, /available BHW/i);

  // Next visit preceding last visit is rejected by tclDateError.
  const badDateErr = validateTbRecordForm({
    form: {
      residentId: 'res-1',
      program: 'TB Patients',
      bhw: BHW_UUID,
      lastVisit: '2026-06-15',
      nextVisit: '2026-06-01',
    },
    assignableBhws: assignable,
    records: [],
  });
  assert.match(badDateErr.dates, /cannot precede/i);

  // Valid edit allows keeping same residentId + program without duplicate error.
  const existing = [{ id: 'tb-1', residentId: 'res-1', program: 'TB Patients' }];
  const editErr = validateTbRecordForm({
    form: {
      residentId: 'res-1',
      program: 'TB Patients',
      bhw: BHW_UUID,
      priority: 'High',
      status: 'Completed',
      lastVisit: '2026-06-10',
      nextVisit: '2026-06-20',
    },
    assignableBhws: assignable,
    records: existing,
    editingRecord: existing[0],
  });
  assert.deepEqual(editErr, {});
});

test('P0-8: buildTbRecordPayload produces create and edit payloads with assigned_bhw UUID', () => {
  const form = {
    residentId: 'res-1',
    program: 'TB Monitoring',
    bhw: BHW_UUID,
    priority: 'High',
    status: 'Completed',
    lastVisit: '2026-06-10',
    nextVisit: '2026-06-25',
    notes: 'Sputum converted',
  };

  const createPayload = buildTbRecordPayload(form, null);
  assert.equal(createPayload.residentId, 'res-1');
  assert.equal(createPayload.assigned_bhw, BHW_UUID);
  assert.equal(createPayload.next_visit, '2026-06-25');
  assert.equal(Object.hasOwn(createPayload, 'next_visit_time'), false);

  const editPayload = buildTbRecordPayload(form, { id: 'tb-1' });
  assert.equal(Object.prototype.hasOwnProperty.call(editPayload, 'residentId'), false);
  assert.equal(editPayload.assigned_bhw, BHW_UUID);
  assert.equal(editPayload.status, 'Completed');
});

test('P0-8: loadResidentDirectory paginates beyond 200 residents cleanly', async () => {
  const allRows = Array.from({ length: 245 }, (_, i) => ({
    id: `res-${i + 1}`,
    first_name: 'Resident',
    last_name: String(i + 1),
    barangay: 'San Jose',
    barangay_id: 'brgy-1',
  }));
  const loaded = await loadResidentDirectory(async ({ limit, offset }) => ({
    rows: allRows.slice(offset, offset + limit),
    total: allRows.length,
  }));
  assert.equal(loaded.length, 245);
});

test('P0-8: TBRecords wires resident pagination, BHW UUID select, date validation, edit, and status updates', () => {
  const src = fs.readFileSync(
    path.resolve('src/features/health-records/pages/TBRecords.jsx'),
    'utf8',
  );
  assert.match(src, /loadResidentDirectory/);
  assert.doesNotMatch(src, /limit:\s*200/);
  assert.match(src, /useHouseholdWorkers/);
  assert.match(src, /workersForResident/);
  assert.match(src, /tclApi\.update\(/);
  assert.match(src, /validateTbRecordForm/);
  assert.match(src, /updateStatus\(/);
  assert.match(src, /openEdit\(/);
  assert.doesNotMatch(src, /Next Follow-up Time|nextVisitTime|type="time"/);
  assert.match(src, /focus-visible:ring-2/);
  assert.match(src, /whitespace-nowrap px-4 py-3/);
});

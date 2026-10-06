import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as healthServices from '../src/services/healthServices.service.js';

const SERVICE_ID = '11111111-1111-4111-8111-111111111111';
const ATTENDANCE_ID = '22222222-2222-4222-8222-222222222222';
const USER = { id: 'phn-1', name: 'PHN One', role: 'phn', municipalityId: 'mun-1' };

let db;

const makeBuilder = (table) => {
  const state = { op: 'select', payload: null, filters: [], lower: [], upper: [], sort: null, embedService: false };
  const rowsFor = () => (db[table] ||= []);
  const matches = (row) => state.filters.every(([column, value]) => row[column] === value)
    && state.lower.every(([column, value]) => row[column] >= value)
    && state.upper.every(([column, value]) => row[column] <= value);
  const selected = () => {
    let rows = rowsFor().filter(matches);
    if (state.sort) {
      const { column, ascending } = state.sort;
      rows = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
    }
    return rows.map((row) => state.embedService
      ? { ...row, service: db.health_services.find((service) => service.id === row.service_id) || null }
      : row);
  };
  const builder = {
    select(columns = '*') { state.embedService = String(columns).includes('service:health_services'); return this; },
    insert(payload) { state.op = 'insert'; state.payload = payload; return this; },
    update(payload) { state.op = 'update'; state.payload = payload; return this; },
    eq(column, value) { state.filters.push([column, value]); return this; },
    gte(column, value) { state.lower.push([column, value]); return this; },
    lte(column, value) { state.upper.push([column, value]); return this; },
    order(column, { ascending = true } = {}) { state.sort = { column, ascending }; return this; },
    maybeSingle() { return Promise.resolve({ data: selected()[0] || null, error: null }); },
    single() {
      if (state.op === 'insert') {
        const row = { id: ATTENDANCE_ID, created_at: new Date().toISOString(), ...state.payload };
        rowsFor().push(row);
        return Promise.resolve({ data: row, error: null });
      }
      if (state.op === 'update') {
        const row = rowsFor().find(matches);
        if (row) Object.assign(row, state.payload);
        return Promise.resolve({ data: row || null, error: null });
      }
      return Promise.resolve({ data: selected()[0] || null, error: null });
    },
    then(resolve, reject) { return Promise.resolve({ data: selected(), error: null }).then(resolve, reject); },
  };
  return builder;
};

const supabase = { from: (table) => makeBuilder(table) };

beforeEach(() => {
  db = {
    health_services: [{
      id: SERVICE_ID,
      municipality_id: 'mun-1',
      barangay_id: null,
      created_by: 'mho-1',
    }],
    residents: [{ id: 'RES-001' }],
    health_service_attendance: [
      { id: ATTENDANCE_ID, service_id: SERVICE_ID, resident_id: 'RES-001', scheduled_date: '2026-10-04', attendance_status: 'scheduled', notes: '' },
      { id: 'attendance-older', service_id: SERVICE_ID, resident_id: 'RES-001', scheduled_date: '2026-10-01', attendance_status: 'attended', notes: '' },
    ],
    health_service_assignments: [],
  };
});

test('create attendance records service, resident and authenticated recorder', async () => {
  const record = await healthServices.createHealthServiceAttendance({
    user: USER,
    supabase,
    payload: {
      service_id: SERVICE_ID,
      resident_id: 'RES-001',
      scheduled_date: '2026-10-05',
      status: 'scheduled',
    },
  });

  assert.equal(record.service_id, SERVICE_ID);
  assert.equal(record.resident_id, 'RES-001');
  assert.equal(record.attendance_status, 'scheduled');
  assert.equal(record.recorded_by, USER.id);
  assert.equal(record.recorded_by_name, USER.name);
});

test('create attendance rejects a missing service_id', async () => {
  await assert.rejects(
    () => healthServices.createHealthServiceAttendance({
      user: USER,
      supabase,
      payload: { resident_id: 'RES-001', scheduled_date: '2026-10-05', status: 'scheduled' },
    }),
    (error) => error.statusCode === 422,
  );
});

test('create attendance rejects a status outside the check-constraint values', async () => {
  await assert.rejects(
    () => healthServices.createHealthServiceAttendance({
      user: USER,
      supabase,
      payload: {
        service_id: SERVICE_ID,
        resident_id: 'RES-001',
        scheduled_date: '2026-10-05',
        status: 'completed',
      },
    }),
    (error) => error.statusCode === 422,
  );
});

test('list attendance by service is ordered newest first', async () => {
  const rows = await healthServices.listAttendanceByService({
    user: USER,
    query: { service_id: SERVICE_ID },
    supabase,
  });
  assert.deepEqual(rows.map((row) => row.scheduled_date), ['2026-10-04', '2026-10-01']);
});

test('list attendance by resident returns only visible service rows', async () => {
  const rows = await healthServices.listAttendanceByResident({
    user: USER,
    query: { resident_id: 'RES-001' },
    supabase,
  });
  assert.deepEqual(rows.map((row) => row.scheduled_date), ['2026-10-04', '2026-10-01']);
  assert.equal('service' in rows[0], false);
});

test('update attendance status and notes; attended status gets a timestamp', async () => {
  const record = await healthServices.updateHealthServiceAttendance({
    user: USER,
    params: { id: ATTENDANCE_ID },
    payload: { status: 'attended', notes: 'Visit completed' },
    supabase,
  });
  assert.equal(record.attendance_status, 'attended');
  assert.equal(record.notes, 'Visit completed');
  assert.ok(Number.isFinite(Date.parse(record.attended_at)));
});

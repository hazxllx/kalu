import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as consultations from '../src/services/consultations.service.js';
import * as operational from '../src/services/operational.service.js';
import * as residentFollowups from '../src/services/residentFollowups.service.js';

const USER = { id: 'staff-1', name: 'PHN One', role: 'phn', municipalityId: 'mun-1' };
const RESIDENT_ID = 'RES-001';
const CONSULTATION_ID = 'VISIT-001';
const FOLLOWUP_ID = 'followup-001';

let db;

const makeBuilder = (table) => {
  const state = { op: 'select', payload: null, filters: [], order: null, limit: null, selection: '*' };
  const rowsFor = () => (db[table] ||= []);
  const matches = (row) => state.filters.every(([column, value]) => row[column] === value);
  const selected = () => {
    let rows = rowsFor().filter(matches);
    if (state.order) {
      const { column, ascending } = state.order;
      rows = [...rows].sort((a, b) => String(a[column] || '').localeCompare(String(b[column] || '')) * (ascending ? 1 : -1));
    }
    if (state.limit != null) rows = rows.slice(0, state.limit);
    return rows.map((row) => {
      const result = { ...row };
      if (state.selection.includes('consultation:visits!follow_ups_consultation_id_fkey')) {
        result.consultation = row.consultation_id
          ? db.visits.find((visit) => visit.id === row.consultation_id) || null
          : null;
      }
      if (state.selection.includes('resident:residents(')) {
        result.resident = db.residents.find((resident) => resident.id === row.resident_id) || null;
      }
      return result;
    });
  };
  const builder = {
    select(selection = '*') { state.selection = selection; return this; },
    insert(payload) { state.op = 'insert'; state.payload = payload; return this; },
    update(payload) { state.op = 'update'; state.payload = payload; return this; },
    eq(column, value) { state.filters.push([column, value]); return this; },
    order(column, { ascending = true } = {}) { state.order = { column, ascending }; return this; },
    limit(count) { state.limit = count; return this; },
    maybeSingle() { return Promise.resolve({ data: selected()[0] || null, error: null }); },
    single() {
      if (state.op === 'insert') {
        const row = { id: FOLLOWUP_ID, created_at: new Date().toISOString(), ...state.payload };
        rowsFor().push(row);
        return Promise.resolve({ data: selected()[0], error: null });
      }
      if (state.op === 'update') {
        const row = rowsFor().find(matches);
        if (row) Object.assign(row, state.payload);
        return Promise.resolve({ data: row ? selected()[0] : null, error: null });
      }
      return Promise.resolve({ data: selected()[0] || null, error: null });
    },
    then(resolve, reject) {
      if (state.op === 'insert') {
        const row = { id: FOLLOWUP_ID, created_at: new Date().toISOString(), ...state.payload };
        rowsFor().push(row);
        return Promise.resolve({ data: [row], error: null }).then(resolve, reject);
      }
      if (state.op === 'update') {
        const rows = rowsFor().filter(matches);
        rows.forEach((row) => Object.assign(row, state.payload));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      }
      return Promise.resolve({ data: selected(), error: null }).then(resolve, reject);
    },
  };
  return builder;
};

const supabase = { from: (table) => makeBuilder(table) };

beforeEach(() => {
  db = {
    residents: [{
      id: RESIDENT_ID,
      auth_user_id: 'resident-auth-1',
      barangay: 'Pili',
      barangay_id: 'brgy-1',
      municipality_id: 'mun-1',
      first_name: 'Resident',
      last_name: 'One',
    }],
    visits: [{
      id: CONSULTATION_ID,
      resident_id: RESIDENT_ID,
      visit_date: '2026-10-05T09:30:00Z',
      chief_complaint: 'Fever',
      status: 'completed',
    }],
    follow_ups: [],
    health_audit_logs: [],
    notifications: [],
  };
});

test('creates a follow-up linked to its consultation', async () => {
  const row = await operational.create({
    user: USER,
    kind: 'followups',
    supabase,
    payload: {
      residentId: RESIDENT_ID,
      consultation_id: CONSULTATION_ID,
      scheduled_date: '2026-10-10',
      purpose: 'Fever follow-up',
    },
  });

  assert.equal(row.consultation_id, CONSULTATION_ID);
});

test('rejects a linked follow-up when the consultation belongs to another resident', async () => {
  db.visits[0].resident_id = 'RES-OTHER';
  await assert.rejects(
    () => operational.create({
      user: USER,
      kind: 'followups',
      supabase,
      payload: {
        residentId: RESIDENT_ID,
        consultation_id: CONSULTATION_ID,
        scheduled_date: '2026-10-10',
        purpose: 'Fever follow-up',
      },
    }),
    (error) => error.statusCode === 422,
  );
  assert.equal(db.follow_ups.length, 0);
});

test('consultation sync sends its visit id on the created follow-up', async () => {
  const calls = [];
  const ops = {
    create: async (args) => { calls.push(args); },
    update: async () => {},
  };
  const queryBuilder = {
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
  };
  await consultations.syncConsultationFollowUp({
    user: USER,
    visit: { id: CONSULTATION_ID, residentId: RESIDENT_ID },
    payload: { nextVisitDate: '2026-10-10', chiefComplaint: 'Fever' },
    supabase: { from: () => queryBuilder },
    ops,
  });
  assert.equal(calls[0].payload.consultation_id, CONSULTATION_ID);
});

test('staff and resident follow-up fetches include the linked consultation summary', async () => {
  db.follow_ups.push({
    id: FOLLOWUP_ID,
    resident_id: RESIDENT_ID,
    consultation_id: CONSULTATION_ID,
    municipality_id: 'mun-1',
    barangay: 'Pili',
    scheduled_date: '2026-10-10',
    status: 'Scheduled',
    purpose: 'Fever follow-up',
  });

  const staffRows = await operational.list({ user: USER, kind: 'followups', supabase });
  assert.equal(staffRows[0].consultation.chief_complaint, 'Fever');

  const residentRows = await residentFollowups.listOwn({
    user: { id: 'resident-auth-1', role: 'resident' },
    supabase,
  });
  assert.deepEqual(residentRows[0].consultation, {
    id: CONSULTATION_ID,
    date: '2026-10-05T09:30:00Z',
    chiefComplaint: 'Fever',
    status: 'completed',
  });
});

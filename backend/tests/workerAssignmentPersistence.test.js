import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { saveWorkflow } from '../src/services/householdRiskWorkflow.service.js';
import { create, update, list } from '../src/services/operational.service.js';

const municipality = '10000000-0000-4000-8000-000000000001';
const barangay = '20000000-0000-4000-8000-000000000001';
const otherBarangay = '20000000-0000-4000-8000-000000000002';
const workerId = '30000000-0000-4000-8000-000000000001';
const midwifeId = '30000000-0000-4000-8000-000000000002';
const outsideId = '30000000-0000-4000-8000-000000000003';
const user = { id: 'test-supervisor', role: 'health_supervisor', municipalityId: municipality, barangayId: barangay, barangay: 'San Isidro' };

const memoryClient = (extra = {}) => {
  const tables = {
    profiles: [
      { id: workerId, full_name: 'Authorized Worker', role: 'bhw', status: 'active', municipality_id: municipality, barangay_id: barangay },
      { id: midwifeId, full_name: 'Authorized Midwife', role: 'health_supervisor', status: 'active', municipality_id: municipality, barangay_id: barangay },
      { id: outsideId, full_name: 'Other Barangay Worker', role: 'bhw', status: 'active', municipality_id: municipality, barangay_id: otherBarangay },
    ],
    residents: [{ id: 'resident-a', municipality_id: municipality, barangay_id: barangay, barangay: 'San Isidro' }],
    tcl_entries: [], household_risk_workflow: [], health_audit_logs: [], notifications: [],
    ...extra,
  };
  return {
    tables,
    from(table) {
      const conditions = [];
      let window = null;
      let action = null;
      const query = {
        select() { return query; }, order() { return query; }, limit(n) { window = [0, n - 1]; return query; },
        eq(key, value) { conditions.push((row) => row[key] === value); return query; },
        in(key, values) { conditions.push((row) => values.includes(row[key])); return query; },
        range(start, end) { window = [start, end]; return query; },
        insert(row) { action = ['insert', row]; return query; },
        upsert(row) { action = ['upsert', row]; return query; },
        update(row) { action = ['update', row]; return query; },
        async result(single = false) {
          const storage = tables[table] ||= [];
          let rows = storage.filter((row) => conditions.every((condition) => condition(row)));
          if (action) {
            if (action[0] === 'insert') { const row = { id: `row-${storage.length + 1}`, ...action[1] }; storage.push(row); rows = [row]; }
            else if (action[0] === 'upsert') {
              let row = storage.find((item) => item.household_id === action[1].household_id);
              if (!row) { row = {}; storage.push(row); }
              Object.assign(row, action[1]); rows = [row];
            } else for (const row of rows) Object.assign(row, action[1]);
          }
          if (window) rows = rows.slice(window[0], window[1] + 1);
          return { data: single ? rows[0] || null : rows, error: null };
        },
        single() { return query.result(true); }, maybeSingle() { return query.result(true); },
        then(resolve, reject) { return query.result().then(resolve, reject); },
      };
      return query;
    },
  };
};

test('household worker assignment persists a scoped FK/name and derives role instead of trusting the UI', async () => {
  const supabase = memoryClient();
  const result = await saveWorkflow({ id: 'household-a', user, supabase, scopeCheck: async () => ({ barangayId: barangay }), patch: { assignedWorker: workerId, assignedWorkerRole: 'phn' } });
  assert.equal(result.assignedWorkerId, workerId);
  assert.equal(result.assignedWorker, 'Authorized Worker');
  assert.equal(result.assignedWorkerRole, 'bhw');
  assert.equal(supabase.tables.household_risk_workflow[0].assigned_worker_id, workerId);
});

test('household assignments reject fabricated names and other-barangay account UUIDs before persistence', async () => {
  for (const assignedWorker of ['Demo Health Worker', outsideId]) {
    const supabase = memoryClient();
    await assert.rejects(saveWorkflow({ id: 'household-a', user, supabase, scopeCheck: async () => ({ barangayId: barangay }), patch: { assignedWorker } }), { statusCode: 422 });
    assert.equal(supabase.tables.household_risk_workflow.length, 0);
  }
});

test('TCL assignment saves a real BHW identity and returns the server name with the record', async () => {
  const supabase = memoryClient();
  const result = await create({ user, kind: 'tcl', supabase, payload: { resident_id: 'resident-a', program: 'NCD', assigned_bhw: workerId, assigned_bhw_name: 'Forged name' } });
  assert.equal(result.assignedBhwId, workerId);
  assert.equal(result.assignedBhwName, 'Authorized Worker');
  assert.equal(supabase.tables.tcl_entries[0].assigned_bhw, 'Authorized Worker');
});

test('TCL assignment cannot use a midwife or an out-of-barangay BHW as the assigned BHW', async () => {
  for (const assigned_bhw of [midwifeId, outsideId, 'Placeholder Worker']) {
    const supabase = memoryClient();
    await assert.rejects(create({ user, kind: 'tcl', supabase, payload: { resident_id: 'resident-a', program: 'NCD', assigned_bhw } }), { statusCode: 422 });
    assert.equal(supabase.tables.tcl_entries.length, 0);
  }
});

test('unrelated TCL edits preserve recorded historical name-only assignment without fabricating its ID', async () => {
  const supabase = memoryClient({ tcl_entries: [{ id: 'tcl-old', resident_id: 'resident-a', assigned_bhw: 'Previously recorded worker', status: 'Active' }] });
  const result = await update({ user, kind: 'tcl', id: 'tcl-old', supabase, payload: { status: 'Completed' } });
  assert.equal(result.assignedBhwName, 'Previously recorded worker');
  assert.equal(result.assignedBhwId, null);
});

test('TCL lists retrieve all scoped pages rather than silently cutting off at 200', async () => {
  const entries = Array.from({ length: 425 }, (_, i) => ({ id: `tcl-${i}`, resident_id: 'resident-a', barangay_id: barangay, assigned_bhw_id: workerId, assigned_bhw_name: 'Authorized Worker' }));
  const supabase = memoryClient({ tcl_entries: entries });
  const rows = await list({ user, kind: 'tcl', supabase });
  assert.equal(rows.length, 425);
  assert.equal(rows[424].assignedBhwId, workerId);
});

test('PostgreSQL assignment guards preserve history/FKs/RLS and block direct fabricated or cross-scope assignments', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create role anon; create role authenticated; create role service_role;
      create table profiles(id uuid primary key, full_name text, role text, status text, municipality_id uuid, barangay_id uuid);
      create table residents(id text primary key, municipality_id uuid, barangay_id uuid);
      create table households(id text primary key, municipality_id uuid, barangay_id uuid);
      create table tcl_entries(id text primary key, resident_id text references residents(id), assigned_bhw text not null default '', status text default 'Active');
      create table household_risk_workflow(household_id text primary key references households(id), assigned_worker text not null default '', assigned_worker_role text not null default '');
      alter table tcl_entries enable row level security;
      create policy tcl_existing_boundary on tcl_entries using (false);
      insert into residents values ('resident-a','${municipality}','${barangay}');
      insert into households values ('household-a','${municipality}','${barangay}');
      insert into profiles values ('${workerId}','Authorized Worker','bhw','active','${municipality}','${barangay}'), ('${outsideId}','Other Worker','bhw','active','${municipality}','${otherBarangay}');
      insert into tcl_entries(id,resident_id,assigned_bhw) values ('historical','resident-a','Unresolved historical name');
    `);
    const migration = await readFile(new URL('../../supabase/migrations/20261106042000_authorized_worker_assignments.sql', import.meta.url), 'utf8');
    await pg.exec(migration);
    await pg.exec(migration);
    assert.deepEqual((await pg.query("select assigned_bhw,assigned_bhw_id from tcl_entries where id='historical'")).rows, [{ assigned_bhw: 'Unresolved historical name', assigned_bhw_id: null }]);
    await pg.query("insert into tcl_entries(id,resident_id,assigned_bhw_id) values ('new','resident-a',$1)", [workerId]);
    assert.deepEqual((await pg.query("select assigned_bhw,assigned_bhw_name from tcl_entries where id='new'")).rows, [{ assigned_bhw: 'Authorized Worker', assigned_bhw_name: 'Authorized Worker' }]);
    await assert.rejects(pg.query("insert into tcl_entries(id,resident_id,assigned_bhw_id) values ('bad','resident-a',$1)", [outsideId]), /outside the authorized scope/);
    await assert.rejects(pg.query("insert into tcl_entries(id,resident_id,assigned_bhw) values ('fake','resident-a','Fake Worker')"), /not a name/);
    await pg.query("update tcl_entries set assigned_bhw_name='Forged name', status='Completed' where id='new'");
    assert.equal((await pg.query("select assigned_bhw_name from tcl_entries where id='new'")).rows[0].assigned_bhw_name, 'Authorized Worker');
    await pg.query('delete from profiles where id=$1', [workerId]);
    assert.deepEqual((await pg.query("select assigned_bhw_id,assigned_bhw_name from tcl_entries where id='new'")).rows, [{ assigned_bhw_id: null, assigned_bhw_name: 'Authorized Worker' }]);
    assert.equal((await pg.query("select count(*)::int as count from pg_policies where policyname='tcl_existing_boundary'")).rows[0].count, 1);
  } finally { await pg.close(); }
});

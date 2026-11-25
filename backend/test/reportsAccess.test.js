import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import express from 'express';
import { configureLocalTestEnvironment } from './helpers/localEnv.js';

configureLocalTestEnvironment();

const reportId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const migration = (file) => readFile(new URL(`../../supabase/migrations/${file}.sql`, import.meta.url), 'utf8');

test('direct report URLs use verified profile scope and permission for reads and review', async (t) => {
  const { getServiceClient } = await import('../src/config/supabase.js');
  const { default: router } = await import('../src/routes/reports.routes.js');
  const { default: errorHandler } = await import('../src/middleware/errorHandler.js');
  const client = getServiceClient();
  let role = 'phn';
  let municipality = 'm1';
  let granted = true;
  let status = 'Submitted';
  let recipientRole = 'phn';
  let historyReads = 0;
  t.mock.method(client.auth, 'getUser', async () => ({ data: { user: { id: actorId, app_metadata: { role: 'mho' } } } }));
  t.mock.method(client, 'from', (table) => {
    const data = {
      profiles: { id: actorId, role, status: 'active', municipality_id: municipality },
      personnel_accounts: { approval_status: 'approved' },
      role_permissions: [{ permission_id: 'reports.view', granted }],
      reports: { id: reportId, created_by: 'other', municipality_id: 'm1', recipient_role: recipientRole, status, content: { marker: 'snapshot' } },
      report_status_history: [],
    }[table];
    if (table === 'report_status_history') historyReads += 1;
    const chain = {
      select: () => chain, eq: () => chain, order: () => chain,
      maybeSingle: async () => ({ data }),
      then: (resolve) => Promise.resolve({ data }).then(resolve),
      update: () => assert.fail('Unauthorized review must never update a report'),
    };
    return chain;
  });
  const app = express();
  app.use(express.json());
  app.use('/reports', router);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const request = (review = false) => fetch(`http://127.0.0.1:${server.address().port}/reports/${reportId}${review ? '/review' : '?municipalityId=m1'}`, {
    headers: { Authorization: 'Bearer verified-token', 'Content-Type': 'application/json' },
    ...(review ? { method: 'PATCH', body: JSON.stringify({ status: 'Received' }) } : {}),
  });

  const detail = await request();
  assert.equal(detail.status, 200);
  assert.equal(detail.headers.get('cache-control'), 'no-store');
  assert.equal((await detail.json()).data.record.content.marker, 'snapshot');

  // An MHO cannot read or review a report routed to the PHN tier.
  role = 'mho';
  assert.equal((await request()).status, 404);
  assert.equal((await request(true)).status, 404);
  status = 'Draft';
  assert.equal((await request()).status, 404);
  assert.equal((await request(true)).status, 404);
  status = 'Submitted';
  recipientRole = 'mho';
  municipality = 'm2';
  assert.equal((await request()).status, 404);
  municipality = 'm1';
  assert.equal((await request()).status, 200);
  granted = false;
  assert.equal((await request()).status, 403);
  assert.equal(historyReads, 2);
});

test('PostgreSQL report and history RLS enforce assignment, PHN routing, read-only MHO oversight, permission, and draft ownership', {
  skip: !process.env.REPORT_RLS_PGLITE && 'Set REPORT_RLS_PGLITE to the local PGlite module entry point',
}, async (t) => {
  const { PGlite } = await import(pathToFileURL(process.env.REPORT_RLS_PGLITE));
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role authenticated;
    create schema auth;
    grant usage on schema auth to authenticated;
    create function auth.uid() returns uuid language sql stable as $$
      select current_setting('test.actor')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    create table profiles (id uuid primary key, role text, status text, municipality_id text, barangay_id text, facility_id text);
    create table role_permissions (role text, permission_id text, granted boolean);
    create function profile_role() returns text language sql stable security definer as $$ select role from profiles where id = auth.uid() $$;
    create function profile_municipality_id() returns text language sql stable security definer as $$ select municipality_id from profiles where id = auth.uid() $$;
    create function profile_barangay_id() returns text language sql stable security definer as $$ select barangay_id from profiles where id = auth.uid() $$;
    create function profile_facility_id() returns text language sql stable security definer as $$ select facility_id from profiles where id = auth.uid() $$;
    create function is_staff_active() returns boolean language sql stable security definer as $$ select status = 'active' from profiles where id = auth.uid() $$;
    create table reports (id int primary key, created_by uuid, sender_role text, recipient_role text,
      municipality_id text, barangay_id text, recipient_facility_id text, status text);
    create table report_status_history (report_id int references reports);
    alter table reports enable row level security;
    alter table report_status_history enable row level security;
    grant select, update on reports to authenticated;
    grant select on report_status_history to authenticated;
    create policy reports_select on reports for select to authenticated using (true);
    create policy report_status_history_select on report_status_history for select to authenticated using (true);
    create policy reports_update on reports for update to authenticated using (true);
  `);
  const personnel = await migration('20261101010000_health_personnel_account_management');
  await db.exec(personnel.match(/create function public\.personnel_actor_has_permission[\s\S]*?\$\$;/)[0]);
  await db.exec(await migration('20261119000000_scope_submitted_report_reads'));
  const routingMigration = await migration('20261201090000_route_barangay_reports_through_phn');
  const routedSelectPolicy = routingMigration.match(
    /drop policy if exists reports_select on public\.reports;[\s\S]*?\n  \);/,
  )?.[0];
  assert.ok(routedSelectPolicy, 'the report-routing migration must define the scoped reports_select policy');
  await db.exec(routedSelectPolicy);

  const actor = (id) => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
  await db.exec(`
    insert into profiles values
      ('${actor(1)}', 'health_supervisor', 'active', 'm1', 'b1', null),
      ('${actor(2)}', 'phn', 'active', 'm1', null, null),
      ('${actor(3)}', 'mho', 'active', 'm2', null, null),
      ('${actor(4)}', 'rhu_personnel', 'active', 'm1', null, 'f1'),
      ('${actor(5)}', 'rhu_personnel', 'active', 'm1', null, 'f2'),
      ('${actor(6)}', 'phn', 'active', null, null, null),
      ('${actor(7)}', 'admin', 'active', 'm1', null, null),
      ('${actor(8)}', 'health_supervisor', 'active', 'm2', 'b3', null),
      ('${actor(9)}', 'phn', 'active', 'm2', null, null);
    insert into reports values
      (1, '${actor(1)}', 'health_supervisor', 'rhu_personnel', 'm1', 'b1', 'f1', 'Submitted'),
      (2, '${actor(1)}', 'health_supervisor', 'rhu_personnel', 'm1', 'b1', 'f1', 'Draft'),
      (3, '${actor(1)}', 'health_supervisor', 'rhu_personnel', 'm1', 'b2', 'f2', 'Submitted'),
      (4, '${actor(2)}', 'phn', 'mho', 'm2', null, null, 'Submitted'),
      (5, '${actor(2)}', 'phn', 'mho', 'm2', null, null, 'Draft'),
      (6, '${actor(8)}', 'health_supervisor', 'phn', 'm2', 'b3', null, 'Submitted');
    insert into report_status_history select id from reports;
  `);

  const assume = (id) => db.exec(`reset role; set test.actor = '${actor(id)}'; set role authenticated`);
  const visible = async (ids) => {
    assert.deepEqual((await db.query('select id from reports order by id')).rows.map(({ id }) => id), ids);
    assert.deepEqual((await db.query('select report_id from report_status_history order by report_id')).rows.map(({ report_id }) => report_id), ids);
  };
  for (const [id, ids] of [[1, [1, 2]], [2, [1, 3]], [3, [4, 6]], [4, [1]], [5, [3]], [6, []], [7, []], [8, [6]], [9, [6]]]) {
    await assume(id);
    await visible(ids);
  }
  await assume(3);
  assert.equal((await db.query("update reports set status = 'Received' where id = 6")).affectedRows, 0,
    'MHO may monitor a report addressed to PHN but cannot act on it');
  await assume(9);
  assert.equal((await db.query("update reports set status = 'Received' where id = 6")).affectedRows, 1,
    'the addressed PHN retains the report workflow action');
  await assume(2);
  assert.equal((await db.query("update reports set status = 'Received'")).affectedRows, 0);
  await db.exec("reset role; insert into role_permissions values ('phn', 'reports.view', false), ('rhu_personnel', 'reports.view', false)");
  await assume(2);
  await visible([]);
  await assume(4);
  await visible([]);
  assert.equal((await db.query("update reports set status = 'Received'")).affectedRows, 0);
});

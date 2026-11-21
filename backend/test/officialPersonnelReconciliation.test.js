import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { assertOfficialPersonnelIdentity, buildProfilePatch, newRhuAssignment, reconcileOfficialPersonnel } from '../scripts/official-personnel.mjs';

const db = new PGlite({ extensions: { pgcrypto } });
const migrations = new URL('../../supabase/migrations/', import.meta.url);
const migration = '20261120133000_reconcile_provisioned_personnel.sql';
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const reconcile = async (id = null) => (await query('select public.reconcile_provisioned_personnel($1) as count', [id]))[0].count;
const account = async (role = 'phn', status = 'active', managed = false) => {
  const id = randomUUID();
  await query(`insert into auth.users(id,email,raw_app_meta_data) values ($1,$2,$3)`,
    [id, `${id}@example.test`, JSON.stringify(managed ? { personnel_managed: true } : {})]);
  await query('update public.profiles set role = $2, status = $3 where id = $1', [id, role, status]);
  return id;
};
const snapshot = async () => ({
  profiles: await query('select * from public.profiles order by id'),
  auth: await query('select * from auth.users order by id'),
  requests: await query('select * from public.staff_account_requests order by id'),
  outbox: await query('select * from public.personnel_notification_outbox order by id'),
});
let preMigrationId;

before(async () => {
  await db.exec(`
    create schema auth; create schema storage;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    create table auth.users(id uuid primary key, email text unique, raw_user_meta_data jsonb not null default '{}',
      raw_app_meta_data jsonb not null default '{}', email_confirmed_at timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table storage.buckets(id text primary key, name text not null, public boolean not null default false);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid);
    alter table storage.objects enable row level security;
    select set_config('request.jwt.claim.role', 'service_role', false);
  `);
  for (const name of (await readdir(migrations)).filter((name) => name.endsWith('.sql') && name < migration).sort()) {
    try { await db.exec(await readFile(new URL(name, migrations), 'utf8')); }
    catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
  }
  preMigrationId = await account();
  const before = await snapshot();
  await db.exec(await readFile(new URL(migration, migrations), 'utf8'));
  assert.deepEqual(await snapshot(), before);
}, { timeout: 120000 });
after(async () => { await db.close(); });

test('migration repairs existing gaps and repeat reconciliation preserves every lifecycle field', async () => {
  const lifecycle = (await query('select * from public.personnel_accounts where account_id = $1', [preMigrationId]))[0];
  assert.equal(lifecycle.approval_status, 'approved');
  assert.equal(lifecycle.activation_requested, true);
  assert.equal(lifecycle.setup_required, false);
  await query(`update public.personnel_accounts set approval_status = 'pending', setup_required = true,
    activation_requested = false, suspension_reason = 'Preserve decision', version = 42 where account_id = $1`, [preMigrationId]);
  const before = await query('select * from public.personnel_accounts where account_id = $1', [preMigrationId]);
  assert.equal(await reconcile(preMigrationId), 0);
  assert.deepEqual(await query('select * from public.personnel_accounts where account_id = $1', [preMigrationId]), before);
});

test('post-migration personnel infer current status without changing Auth, assignment, requests or mail', async () => {
  for (const [status, approval, activation] of [
    ['active', 'approved', true], ['disabled', 'approved', false], ['pending_verification', 'pending', false],
  ]) {
    const id = await account('phn', status);
    const before = await snapshot();
    assert.equal(await reconcile(id), 1);
    const lifecycle = (await query('select * from public.personnel_accounts where account_id = $1', [id]))[0];
    assert.equal(lifecycle.approval_status, approval);
    assert.equal(lifecycle.activation_requested, activation);
    assert.equal(lifecycle.setup_required, false);
    assert.deepEqual(await snapshot(), before);
    assert.equal(await reconcile(id), 0);
  }
});

test('legacy decisions retain historical reviewer and rejection reason', async () => {
  const actor = await account('admin');
  for (const status of ['approved', 'rejected', 'resubmission_required']) {
    const id = await account('bhw', 'disabled');
    await query(`insert into public.staff_account_requests(auth_user_id,full_name,email,role,status,decided_by,decided_at,rejection_reason)
      select id,full_name,email,role,$2,$3,now(),'Historical reason' from public.profiles where id = $1`, [id, status, actor]);
    const before = await snapshot();
    assert.equal(await reconcile(id), 1);
    const lifecycle = (await query('select * from public.personnel_accounts where account_id = $1', [id]))[0];
    assert.equal(lifecycle.approval_status, status === 'resubmission_required' ? 'pending' : status);
    if (status === 'approved') assert.equal(lifecycle.approved_by, actor);
    if (status === 'rejected') {
      assert.equal(lifecycle.rejected_by, actor);
      assert.equal(lifecycle.decision_reason, 'Historical reason');
    }
    assert.deepEqual(await snapshot(), before);
  }
});

test('resident roles, resident-linked staff and unfinished managed reservations cannot be adopted', async () => {
  const resident = await account('resident', 'pending_verification');
  const linked = await account();
  await query(`insert into public.residents(id,health_record_no,first_name,last_name,auth_user_id)
    values ('RES-RECONCILE','HR-RECONCILE','Linked','Resident',$1)`, [linked]);
  const managed = await account('phn', 'active', true);
  const reserved = await account();
  await query(`insert into public.personnel_account_operations(id,account_id,action,input)
    values ($1,$2,'create','{}')`, [randomUUID(), reserved]);
  const before = await snapshot();
  for (const id of [resident, linked, managed, reserved]) assert.equal(await reconcile(id), 0);
  assert.deepEqual(await snapshot(), before);
});

test('only the service role can invoke reconciliation, including bulk repair', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try { await assert.rejects(() => reconcile(), (error) => error.code === '42501'); }
    finally { await db.exec('reset role'); }
  }
  const id = await account('mho', 'disabled');
  await db.exec('set role service_role');
  try { assert.equal(await reconcile(id), 1); }
  finally { await db.exec('reset role'); }
});

test('reconciliation cannot adopt a profile with a mismatched Auth email', async () => {
  const id = await account();
  await query('update public.profiles set email = $2 where id = $1', [id, 'mismatched@example.test']);
  const before = await snapshot();
  assert.equal(await reconcile(id), 0);
  assert.deepEqual(await snapshot(), before);
});

test('public Auth metadata still creates only a resident without a personnel sidecar', async () => {
  const id = randomUUID();
  await query(`insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,'{"role":"admin","status":"active"}')`,
    [id, `${id}@example.test`]);
  const profile = (await query('select role,status from public.profiles where id = $1', [id]))[0];
  assert.deepEqual(profile, { role: 'resident', status: 'pending_verification' });
  assert.equal(await reconcile(id), 0);
  assert.deepEqual(await query('select * from public.personnel_accounts where account_id = $1', [id]), []);
});

test('a repaired official account can be edited and suspended through the existing admin workflow', async () => {
  const actor = await account('admin');
  const id = await account('mho', 'disabled');
  await reconcile(actor);
  await reconcile(id);
  const edited = (await query(`select public.admin_update_personnel_account($1,$2,$3,$4) as result`,
    [id, actor, JSON.stringify({ contact: '09171234567' }), randomUUID()]))[0].result;
  assert.equal(edited.contact, '09171234567');
  const suspended = (await query(`select public.admin_transition_personnel_account($1,$2,'suspend','Access review',false,$3) as result`,
    [id, actor, randomUUID()]))[0].result;
  assert.equal(suspended.status, 'disabled');
  assert.ok(suspended.personnel_account.suspended_at);
});

test('script reconciliation is read-only in check mode and surfaces RPC failures', async () => {
  const calls = [];
  const admin = { rpc: async (...args) => { calls.push(args); return { data: 1 }; } };
  await reconcileOfficialPersonnel(admin, 'official-id', false);
  assert.deepEqual(calls, []);
  assert.match(await reconcileOfficialPersonnel(admin, 'official-id', true), /CREATED/);
  assert.deepEqual(calls, [['reconcile_provisioned_personnel', { p_target_id: 'official-id' }]]);
  await assert.rejects(() => reconcileOfficialPersonnel({ rpc: async () => ({ error: { message: 'Missing migration' } }) }, 'id', true), /Missing migration/);
});

test('script identity preflight rejects resident links and managed reservations before writes', async () => {
  const client = (resident, reservation) => ({ from(table) {
    const builder = { select() { return this; }, eq() { return this; }, is() { return this; },
      async limit() { return { data: (table === 'residents' ? resident : reservation) ? [{ id: 'linked' }] : [] }; } };
    return builder;
  } });
  await assertOfficialPersonnelIdentity(client(false, false), { id: 'official' });
  for (const [resident, reservation, managed] of [[true, false, false], [false, true, false], [false, false, true]]) {
    await assert.rejects(() => assertOfficialPersonnelIdentity(client(resident, reservation), {
      id: 'official', app_metadata: { personnel_managed: managed },
    }), /cannot adopt/);
  }
});

test('new RHU fixtures use the seeded facility and supported stations and fail on missing seed data', () => {
  assert.deepEqual(newRhuAssignment({ rhuFacilityId: 'seeded-rhu' }), {
    facility_id: 'seeded-rhu', rhu_stations: ['triage', 'consultation'],
  });
  assert.throws(() => newRhuAssignment({}), /RHU facility not found/);
});

test('provisioning retries preserve staff roles, status and assignments, including incomplete legacy RHU scope', () => {
  const acct = { role: 'rhu_personnel', status: 'active', fullName: 'Official RHU', scope: 'municipality' };
  const scope = { municipalityId: 'official-municipality', rhuFacilityId: 'seeded-rhu' };
  for (const status of ['active', 'disabled', 'pending_verification']) {
    for (const role of ['admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw']) {
      const profile = { role, status, full_name: 'Existing', municipality_id: 'assigned',
        barangay_id: 'assigned-barangay', facility_id: 'assigned-facility', rhu_stations: ['triage'] };
      assert.deepEqual(buildProfilePatch(acct, profile, scope), {});
    }
  }
  assert.deepEqual(buildProfilePatch(acct, { role: 'rhu_personnel', status: 'active' }, scope), {});
  assert.deepEqual(buildProfilePatch(acct, { role: 'resident', status: 'pending_verification' }, scope), {
    role: 'rhu_personnel', status: 'active', full_name: 'Official RHU', municipality_id: 'official-municipality',
    facility_id: 'seeded-rhu', rhu_stations: ['triage', 'consultation'],
  });
  assert.deepEqual(buildProfilePatch({ role: 'resident', scope: 'none' }, {
    role: 'resident', status: 'pending_verification', full_name: 'Resident',
  }, scope), {});
});

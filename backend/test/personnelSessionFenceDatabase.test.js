import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const accountId = randomUUID();
const legacyId = randomUUID();
const completedId = randomUUID();
const query = async (sql, params = []) => (await db.query(sql, params)).rows;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    grant usage on schema auth, public to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create function auth.role() returns text language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role');
    $$;
    create table public.profiles (id uuid primary key, role text not null, status text not null);
    create table public.personnel_accounts (
      account_id uuid primary key, must_change_password boolean not null,
      setup_required boolean not null, version integer not null default 1,
      approval_status text not null default 'approved', suspended_at timestamptz,
      temporary_password_expires_at timestamptz, password_changed_at timestamptz
    );
    create table public.personnel_private_records (account_id uuid primary key, detail text not null);
    grant select on public.personnel_private_records to authenticated, service_role;
  `);
  await query("insert into public.profiles values ($1,'phn','active')", [completedId]);
  await query("insert into public.personnel_accounts(account_id,must_change_password,setup_required,password_changed_at) values ($1,false,false,now()-interval '10 minutes')", [completedId]);
  await query("insert into public.personnel_private_records values ($1,'Previously completed credentials')", [completedId]);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261120132500_personnel_session_fence.sql', import.meta.url), 'utf8'));
  await db.exec(`
    alter table public.personnel_private_records enable row level security;
    create policy own_record on public.personnel_private_records for select to authenticated
      using (account_id = auth.uid());
    create policy completed_credentials on public.personnel_private_records as restrictive for all to authenticated
      using (public.personnel_session_is_usable())
      with check (public.personnel_session_is_usable());
  `);
  await query("insert into public.profiles values ($1,'phn','active'),($2,'phn','active')", [accountId, legacyId]);
  await query('insert into public.personnel_accounts(account_id,must_change_password,setup_required) values ($1,true,true),($2,false,false)', [accountId, legacyId]);
  await query("insert into public.personnel_private_records values ($1,'Managed personnel record'),($2,'Existing personnel record')", [accountId, legacyId]);
});

after(async () => { await db?.close(); });

const asJwt = async (id, claims, action, role = 'authenticated') => {
  await db.exec(`set role ${role}`);
  await query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role',$2,false), set_config('request.jwt.claims',$3,false)",
    [id, role, JSON.stringify({ sub: id, role, ...claims })]);
  try { return await action(); }
  finally {
    await db.exec('reset role');
    await query("select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','',false), set_config('request.jwt.claims','',false)");
  }
};

const records = () => query('select * from public.personnel_private_records');
const lifecycle = async () => (await query('select * from public.personnel_accounts where account_id = $1', [accountId]))[0];

test('password setup keeps direct Data API access closed before completion', async () => {
  assert.deepEqual(await asJwt(accountId, { iat: Math.floor(Date.now() / 1000) }, records), []);
  assert.equal((await lifecycle()).credential_valid_after, 0);
});

test('migration also fences tokens predating a recorded historical password change', async () => {
  const row = (await query('select credential_valid_after from public.personnel_accounts where account_id = $1', [completedId]))[0];
  const cutoff = Number(row.credential_valid_after);
  assert.ok(cutoff > 0);
  assert.deepEqual(await asJwt(completedId, { iat: cutoff - 1 }, records), []);
  assert.equal((await asJwt(completedId, { iat: cutoff }, records))[0].detail, 'Previously completed credentials');
});

test('completion rejects old and same-second JWTs while allowing a newly issued login JWT', async () => {
  const issuedBeforeCompletion = Math.floor(Date.now() / 1000);
  await query('update public.personnel_accounts set must_change_password = false, setup_required = false where account_id = $1', [accountId]);
  const cutoff = Number((await lifecycle()).credential_valid_after);
  assert.ok(cutoff > issuedBeforeCompletion);
  assert.deepEqual(await asJwt(accountId, { iat: issuedBeforeCompletion }, records), []);
  assert.deepEqual(await asJwt(accountId, { iat: cutoff - 1 }, records), []);
  assert.equal((await asJwt(accountId, { iat: cutoff }, records))[0].detail, 'Managed personnel record');
});

test('missing or malformed issuance claims fail closed for accounts with completed credentials', async () => {
  for (const claims of [{}, { iat: null }, { iat: -1 }, { iat: 'invalid' }, { iat: '1e30' }, { iat: {} }]) {
    assert.deepEqual(await asJwt(accountId, claims, records), []);
  }
});

test('normal edits and idempotent completion do not invalidate a fresh session again', async () => {
  const cutoff = Number((await lifecycle()).credential_valid_after);
  await query('update public.personnel_accounts set version = version + 1, setup_required = false, must_change_password = false where account_id = $1', [accountId]);
  assert.equal(Number((await lifecycle()).credential_valid_after), cutoff);
  assert.equal((await asJwt(accountId, { iat: cutoff }, records)).length, 1);
});

test('clearing setup in separate trusted writes still establishes the credential fence', async () => {
  await query('update public.personnel_accounts set setup_required = true, must_change_password = true where account_id = $1', [accountId]);
  await query('update public.personnel_accounts set must_change_password = false where account_id = $1', [accountId]);
  assert.deepEqual(await asJwt(accountId, { iat: Number((await lifecycle()).credential_valid_after) }, records), []);
  await query('update public.personnel_accounts set setup_required = false where account_id = $1', [accountId]);
  assert.ok(Number((await lifecycle()).credential_valid_after) > 0);
});

test('existing accounts and trusted service-role operations retain their established access', async () => {
  assert.equal((await asJwt(legacyId, {}, records))[0].detail, 'Existing personnel record');
  assert.equal((await asJwt(accountId, {}, records, 'service_role')).length, 3);
  for (const role of ['anon', 'authenticated']) {
    await asJwt(accountId, {}, async () => {
      await assert.rejects(() => query('update public.personnel_accounts set credential_valid_after = 0'), (error) => error.code === '42501');
    }, role);
  }
});

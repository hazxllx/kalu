import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Apply every earlier repository migration in local PostgreSQL, not a simplified
// production schema or remote Supabase instance. All accounts/data are synthetic.
const database = new PGlite({ extensions: { pgcrypto } });
const migrations = new URL('../../supabase/migrations/', import.meta.url);
const candidate = '20261106020000_consultation_operation_idempotency.sql';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const RECIPIENT = '33333333-3333-4333-8333-333333333333';
const KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const query = async (sql, params = []) => (await database.query(sql, params)).rows;
let barangayId;
let originalLegacy;

before(async () => {
  await database.exec(`
    create schema auth; create schema storage;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb not null default '{}',raw_app_meta_data jsonb not null default '{}',email_confirmed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid);
    alter table storage.objects enable row level security;
    select set_config('request.jwt.claim.role','service_role',false);
  `);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith('.sql') && name < candidate).sort()) {
    try { await database.exec(await readFile(new URL(file, migrations), 'utf8')); }
    catch (error) { throw new Error(`Consultation baseline ${file}: ${error.message}`, { cause: error }); }
  }
  const municipalityId = (await query("select id from public.municipalities where name='Pili'"))[0]?.id
    || (await query("insert into public.municipalities(name) values ('Pili') returning id"))[0].id;
  barangayId = (await query("select id from public.barangays where municipality_id=$1 and name='San Antonio'", [municipalityId]))[0]?.id
    || (await query("insert into public.barangays(municipality_id,name) values ($1,'San Antonio') returning id", [municipalityId]))[0].id;
  for (const [id, role] of [[ACTOR, 'phn'], [RECIPIENT, 'resident']]) {
    await query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)', [id, `${id}@example.test`, JSON.stringify({ full_name: 'Synthetic Consultation Test' })]);
    await query("update public.profiles set role=$2,status='active',municipality_id=$3,barangay_id=$4 where id=$1", [id, role, municipalityId, role === 'resident' ? barangayId : null]);
  }
  await query("insert into public.residents(id,health_record_no,first_name,last_name,barangay_id,auth_user_id,verification_status) values ('RES-CONSULTATION-SCHEMA','HR-CONSULTATION-SCHEMA','Synthetic','Resident',$1,$2,'approved')", [barangayId, RECIPIENT]);
  await query("insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,status,chief_complaint,findings,treatment_given,created_at,updated_at) values ('VISIT-LEGACY-SCHEMA','RES-CONSULTATION-SCHEMA',$1,'phn','in_review','Legacy complaint','Legacy findings','Legacy treatment','2026-10-01T01:00:00Z','2026-10-02T02:00:00Z')", [ACTOR]);
  originalLegacy = (await query("select id,created_at,updated_at,status,findings from public.visits where id='VISIT-LEGACY-SCHEMA'"))[0];
  await database.exec(await readFile(new URL(candidate, migrations), 'utf8'));
}, { timeout: 120000 });
after(async () => { await database.close(); });

test('consultation migration preserves baseline legacy clinical rows and deployed schema compatibility', async () => {
  assert.deepEqual((await query("select id,created_at,updated_at,status,findings from public.visits where id='VISIT-LEGACY-SCHEMA'"))[0], originalLegacy);
  assert.equal((await query("select recorded_at from public.visits where id='VISIT-LEGACY-SCHEMA'"))[0].recorded_at, null);
});

test('initial operation completion works with the real scope triggers, FK/check constraints and notification schema', async () => {
  const details = { consultationDate: '2026-11-05', consultationTime: '00:15', chiefComplaint: 'Test complaint',
    findings: 'Test clinical finding', diagnosis: 'Test assessment', nextVisitDate: '2026-11-12', adviceGiven: 'Test advice' };
  await query(`insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,recorded_by_name,status,
    client_operation_key,client_operation_payload_hash,recorded_at,consultation_details)
    values ('VISIT-OPERATION-SCHEMA','RES-CONSULTATION-SCHEMA',$1,'phn','Test Clinician','completed',$2::uuid,$3,'2026-11-04T16:16:00Z',$4::jsonb)`,
  [ACTOR, KEY, 'a'.repeat(64), JSON.stringify(details)]);
  const complete = () => query("select public.complete_consultation_operation('VISIT-OPERATION-SCHEMA',$1::uuid) as result", [ACTOR]);
  assert.equal((await complete())[0].result.completed, true);
  await complete();
  const followups = await query("select * from public.follow_ups where consultation_id='VISIT-OPERATION-SCHEMA'");
  assert.equal(followups.length, 1);
  assert.equal(followups[0].barangay_id, barangayId);
  assert.equal(followups[0].created_by, ACTOR);
  assert.equal(followups[0].resident_decision, 'pending');
  assert.equal(followups[0].status, 'Pending');
  const notices = await query('select * from public.notifications where recipient_id=$1', [RECIPIENT]);
  assert.equal(notices.length, 2);
  assert.ok(notices.every((row) => !row.message.includes(details.findings) && !row.message.includes(details.diagnosis)));
  assert.equal((await query("select count(*)::integer as count from public.health_audit_logs where entity_id in ('VISIT-OPERATION-SCHEMA',$1)", [followups[0].id]))[0].count, 2);
  await assert.rejects(query("update public.visits set recorded_by_id=$1 where id='VISIT-OPERATION-SCHEMA'", [RECIPIENT]), { code: '23514' });
});

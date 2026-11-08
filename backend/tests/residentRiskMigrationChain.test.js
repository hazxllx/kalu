import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

test('resident risk RPCs execute against the complete deployed-schema migration chain, not synthetic table columns', async () => {
  const pg = new PGlite({ extensions: { pgcrypto } });
  try {
    // Platform-only shims; every KALUSAGAP table, policy and function below is
    // created from the actual migration files. No production connection is used.
    await pg.exec(`create schema auth; create schema storage;
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      grant usage on schema public,auth,storage to anon,authenticated,service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
      create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb not null default '{}',
        raw_app_meta_data jsonb not null default '{}',email_confirmed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
      create table storage.buckets(id text primary key,name text not null,public boolean not null default false);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid);
      alter table storage.objects enable row level security;
      grant select,insert,update,delete on storage.objects to authenticated;
      create policy objects_owner on storage.objects for all to authenticated using(owner=auth.uid()) with check(owner=auth.uid());
      select set_config('request.jwt.claim.role','service_role',false);`);
    const directory = new URL('../../supabase/migrations/', import.meta.url);
    for (const filename of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
      await pg.exec(await readFile(new URL(filename, directory), 'utf8'));
    }
    const municipalityId = randomUUID();
    const barangayId = randomUUID();
    const clinicianId = randomUUID();
    const pendingOwnerId = randomUUID();
    await pg.query('insert into municipalities(id,name) values($1,$2)', [municipalityId, 'Risk Schema Test']);
    await pg.query('insert into barangays(id,municipality_id,name) values($1,$2,$3)', [barangayId, municipalityId, 'San Isidro']);
    await pg.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [clinicianId, `${clinicianId}@example.test`, pendingOwnerId, `${pendingOwnerId}@example.test`]);
    await pg.query("update profiles set role='phn',status='active',municipality_id=$2 where id=$1", [clinicianId, municipalityId]);
    await pg.query("update profiles set role='resident',status='pending_verification',municipality_id=$2,barangay_id=$3 where id=$1", [pendingOwnerId, municipalityId, barangayId]);
    await pg.exec("insert into role_permissions(role,permission_id,granted) values('phn','reports.analytics.view',true) on conflict(role,permission_id) do update set granted=true");
    await pg.query(`insert into residents(id,health_record_no,first_name,last_name,municipality_id,barangay_id,barangay,auth_user_id)
      values('SCHEMA-RES-1','SCHEMA-HR-1','Schema One','Test',$1,$2,'San Isidro',null),
        ('SCHEMA-RES-2','SCHEMA-HR-2','Schema Two','Test',$1,$2,'San Isidro',$3)`, [municipalityId, barangayId, pendingOwnerId]);
    await pg.query(`insert into visits(id,resident_id,recorded_by_id,recorded_by_role,status,bp,visit_date)
      values('SCHEMA-VISIT-1','SCHEMA-RES-1',$1,'phn','completed','160/100','2026-11-05T09:00:00Z')`, [clinicianId]);
    const summary = (await pg.query('select resident_risk_summary($1,null,5,0) as result', [clinicianId])).rows[0].result;
    assert.equal(summary.summary.totalResidents, 2);
    assert.equal(summary.summary.high, 1);
    assert.equal(summary.highRisk[0].residentId, 'SCHEMA-RES-1');
    const detail = (await pg.query('select resident_risk_for_ids($1,$2) as result', [['SCHEMA-RES-1', 'SCHEMA-RES-2'], clinicianId])).rows[0].result;
    assert.equal(detail.length, 2);
    const own = (await pg.query('select resident_risk_for_ids($1,$2) as result', [['SCHEMA-RES-1', 'SCHEMA-RES-2'], pendingOwnerId])).rows[0].result;
    assert.deepEqual(own.map((row) => row.residentId), ['SCHEMA-RES-2']);
    const updated = (await pg.query('select recalculate_resident_risk(null,$1) as result', [municipalityId])).rows[0].result;
    assert.equal(updated.total, 2);
    assert.equal((await pg.query("select risk_level from residents where id='SCHEMA-RES-1'")).rows[0].risk_level, 'High');
    assert.equal((await pg.query("select has_function_privilege('authenticated','resident_risk_summary(uuid,text,integer,integer)','EXECUTE') as allowed")).rows[0].allowed, false);
  } finally { await pg.close(); }
});

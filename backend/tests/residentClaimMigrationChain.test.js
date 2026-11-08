import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

test('resident claims and ownership guards execute on the real migration chain, including preserved legacy duplicate links', async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } });
  const municipality = randomUUID();
  const barangay = randomUUID();
  const legacyOwner = randomUUID();
  const firstOwner = randomUUID();
  const secondOwner = randomUUID();
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  try {
    // Only Supabase platform objects are shimmed. All application tables,
    // constraints, triggers and claim RPCs come from actual sorted migrations.
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
    let legacyBefore;
    for (const filename of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
      if (filename === '20260927140000_resident_auth_user_unique.sql') {
        await pg.query('insert into municipalities(id,name) values($1,$2)', [municipality, 'Claim Chain Test']);
        await pg.query('insert into barangays(id,municipality_id,name) values($1,$2,$3)', [barangay, municipality, 'San Isidro']);
        await pg.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)',
          [legacyOwner, `${legacyOwner}@example.test`, firstOwner, `${firstOwner}@example.test`, secondOwner, `${secondOwner}@example.test`]);
        await pg.query(`insert into residents(id,health_record_no,first_name,last_name,birth_date,barangay,barangay_id,municipality_id,auth_user_id)
          values('RES-000810','CLAIM-HR-810','Legacy One','Test','1980-01-01','San Isidro',$1,$2,$3),
            ('RES-000811','CLAIM-HR-811','Legacy Two','Test','1981-01-01','San Isidro',$1,$2,$3)`, [barangay, municipality, legacyOwner]);
      }
      if (filename === '20261107151000_resident_claim_integrity.sql') {
        legacyBefore = (await pg.query("select id,health_record_no,first_name,last_name,birth_date,auth_user_id from residents where id in ('RES-000810','RES-000811') order by id")).rows;
      }
      await pg.exec(await readFile(new URL(filename, directory), 'utf8'));
    }

    await t.test('legacy rows are unchanged and the mandatory new guard does not depend on the skipped old index', async () => {
      assert.ok(legacyBefore);
      assert.deepEqual((await pg.query("select id,health_record_no,first_name,last_name,birth_date,auth_user_id from residents where id in ('RES-000810','RES-000811') order by id")).rows, legacyBefore);
      assert.equal((await pg.query("select to_regclass('public.residents_auth_user_id_unique') as name")).rows[0].name, null);
      assert.equal((await pg.query('select count(*)::integer as count from resident_auth_ownership_guard where auth_user_id=$1', [legacyOwner])).rows[0].count, 1);
      await assert.rejects(pg.query(`insert into residents(id,health_record_no,first_name,last_name,barangay,barangay_id,municipality_id,auth_user_id)
        values('RES-000812','CLAIM-HR-812','New Duplicate','Test','San Isidro',$1,$2,$3)`, [barangay, municipality, legacyOwner]), (error) => error.code === '23505');
      await pg.query("update residents set auth_user_id=auth_user_id where id='RES-000810'");
    });

    await pg.query(`insert into residents(id,health_record_no,first_name,last_name,birth_date,identity_no,barangay,barangay_id,municipality_id)
      values('RES-000813','CLAIM-HR-813','Claim One','Test','1990-05-20','CLAIM-CHAIN-ID','San Isidro',$1,$2),
        ('RES-000814','CLAIM-HR-814','Claim Two','Test','1991-05-20','','San Isidro',$1,$2)`, [barangay, municipality]);

    await t.test('wrong DOB and missing proof return SQL null and never attach either identity or ID', async () => {
      assert.equal((await pg.query("select (claim_resident_for_account($1,'CLAIM-CHAIN-ID','2000-01-01')).id as id", [firstOwner])).rows[0].id, null);
      assert.equal((await pg.query("select (activate_resident_by_id($1,'RES-000813','2000-01-01')).id as id", [firstOwner])).rows[0].id, null);
      assert.equal((await pg.query("select (activate_resident_by_id($1,'RES-000813',null)).id as id", [firstOwner])).rows[0].id, null);
      assert.equal((await pg.query("select auth_user_id from residents where id='RES-000813'")).rows[0].auth_user_id, null);
    });

    await t.test('competing claims have one winner and an account cannot attach a second resident', async () => {
      // PGlite queues a single local connection; this exercises actual atomic
      // statements and unique constraints, not multi-connection MVCC scheduling.
      const results = await Promise.all([
        pg.query("select (claim_resident_for_account($1,'CLAIM-CHAIN-ID','1990-05-20')).id as id", [firstOwner]),
        pg.query("select (activate_resident_by_id($1,'RES-000813','1990-05-20')).id as id", [secondOwner]),
      ]);
      assert.deepEqual(results.map((result) => result.rows[0].id), ['RES-000813', null]);
      await assert.rejects(pg.query("select activate_resident_by_id($1,'RES-000814','1991-05-20')", [firstOwner]), (error) => error.code === '23505');
      assert.equal((await pg.query("select auth_user_id from residents where id='RES-000814'")).rows[0].auth_user_id, null);
    });

    await t.test('owner replacement and a manual unlink/reassign bypass are blocked without blocking same-owner updates', async () => {
      await assert.rejects(pg.query("update residents set auth_user_id=$1 where id='RES-000813'", [secondOwner]), (error) => error.code === '23514');
      await assert.rejects(pg.query("update residents set auth_user_id=null where id='RES-000813'"), (error) => error.code === '23514');
      await pg.query("update residents set auth_user_id=$1 where id='RES-000813'", [firstOwner]);
      assert.equal((await pg.query("select auth_user_id from residents where id='RES-000813'")).rows[0].auth_user_id, firstOwner);
    });

    await t.test('legitimate Auth deletion uses FK SET NULL, preserving residents and clinical history for future proven claims', async () => {
      await pg.query("update profiles set role='phn',status='active',municipality_id=$2 where id=$1", [secondOwner, municipality]);
      await pg.query(`insert into visits(id,resident_id,recorded_by_id,recorded_by_role,status,visit_date,clinical_history)
        values('CLAIM-VISIT-1','RES-000813',$1,'phn','completed','2026-11-05T09:00:00Z','Preserve clinical history')`, [secondOwner]);
      await pg.query('delete from auth.users where id=$1', [firstOwner]);
      assert.equal((await pg.query("select auth_user_id from residents where id='RES-000813'")).rows[0].auth_user_id, null);
      assert.equal((await pg.query("select clinical_history from visits where id='CLAIM-VISIT-1'")).rows[0].clinical_history, 'Preserve clinical history');
      assert.equal((await pg.query("select (activate_resident_by_id($1,'RES-000813','1990-05-20')).id as id", [secondOwner])).rows[0].id, 'RES-000813');
      await pg.query('delete from auth.users where id=$1', [legacyOwner]);
      assert.deepEqual((await pg.query("select auth_user_id from residents where id in ('RES-000810','RES-000811') order by id")).rows.map((row) => row.auth_user_id), [null, null]);
    });

    await t.test('migration replay is idempotent and registry/RPC privileges remain private', async () => {
      await pg.exec(await readFile(new URL('20261107151000_resident_claim_integrity.sql', directory), 'utf8'));
      assert.equal((await pg.query("select has_table_privilege('service_role','resident_auth_ownership_guard','INSERT') as allowed")).rows[0].allowed, false);
      for (const role of ['anon', 'authenticated']) {
        assert.equal((await pg.query("select has_function_privilege($1,'activate_resident_by_id(uuid,text,date)','EXECUTE') as allowed", [role])).rows[0].allowed, false);
        assert.equal((await pg.query("select has_function_privilege($1,'claim_resident_for_account(uuid,text,date)','EXECUTE') as allowed", [role])).rows[0].allowed, false);
      }
      assert.equal((await pg.query("select has_function_privilege('service_role','activate_resident_by_id(uuid,text,date)','EXECUTE') as allowed")).rows[0].allowed, true);
      assert.equal((await pg.query("select count(*)::integer as count from residents where id in ('RES-000810','RES-000811','RES-000813','RES-000814')")).rows[0].count, 4);
    });
  } finally { await pg.close(); }
});

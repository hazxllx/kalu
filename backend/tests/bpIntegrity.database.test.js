import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { classifyBloodPressure } from '../../shared/bloodPressure.js';

test('BP snapshots survive the real atomic triage RPC and database validation preserves history', async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(`
    create schema auth; create schema storage;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
    create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb not null default '{}',raw_app_meta_data jsonb not null default '{}',email_confirmed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    select set_config('request.jwt.claim.role','service_role',false);
  `);
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  const migration = '20261120210000_bp_classification_integrity.sql';
  // Established triage schema plus this change, isolated from parallel personnel migrations.
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')
    && (name < '20261120130500' || name === migration)).sort()) {
    try { await db.exec(await readFile(new URL(file, directory), 'utf8')); }
    catch (error) { throw new Error(`${file}: ${error.message}`, { cause: error }); }
  }
  const actor = '11111111-1111-4111-8111-111111111111';
  const municipality = '22222222-2222-4222-8222-222222222222';
  const barangay = '33333333-3333-4333-8333-333333333333';
  const facility = '44444444-4444-4444-8444-444444444444';
  await db.exec(`
    insert into municipalities(id,name) values('${municipality}','BP Test Municipality');
    insert into barangays(id,municipality_id,name,status) values('${barangay}','${municipality}','San Antonio','Active');
    insert into facilities(id,municipality_id,name,type) values('${facility}','${municipality}','BP Test RHU','rhu');
    insert into auth.users(id,email,raw_user_meta_data) values('${actor}','bp-test@example.test','{"full_name":"Test Clinician"}');
    update profiles set status='active',role='rhu_personnel',municipality_id='${municipality}',facility_id='${facility}',rhu_stations=array['triage'] where id='${actor}';
  `);
  const resident = { id: 'BP-RESIDENT', health_record_no: 'BP-HR', first_name: 'Test', last_name: 'Resident',
    middle_name: '', age: 30, sex: 'Female', barangay_id: barangay, birth_date: null };
  let index = 0;
  for (const reading of ['110/70', '119/79', '120/75', '125/79', '129/79', '120/80', '120/89',
    '130/75', '135/85', '139/89', '140/80', '130/90', '150/95', '180/120', '181/80', '150/121', '185/125', '']) {
    for (const chiefComplaint of ['Checkup', 'Chest pain']) {
      const snapshot = classifyBloodPressure(reading, { chiefComplaint });
      const visit = { id: `BP-${index++}`, resident_id: resident.id, visit_date: '2026-11-20T09:00:00Z',
        chief_complaint: chiefComplaint, facility_id: facility, bp: reading, bp_classification: snapshot,
        triage_snapshot: { triageWarnings: [] } };
      const key = randomUUID();
      const params = [key, 'a'.repeat(64), actor, index === 1 ? JSON.stringify(resident) : null, JSON.stringify(visit)];
      const call = () => db.query('select create_submitted_triage($1::uuid,$2,$3::uuid,$4::jsonb,$5::jsonb) as result', params);
      const saved = (await call()).rows[0].result.visit;
      assert.equal(saved.bp, reading);
      assert.deepEqual(saved.bp_classification, snapshot);
      assert.deepEqual(saved.triage_snapshot.bloodPressureClassification, snapshot);
      assert.equal((await call()).rows[0].result.deduplicated, true);
    }
  }
  for (const bp of ['120/', '80/120', '120/201', '301/80', '120/80bad']) {
    await assert.rejects(db.query(`insert into visits(id,resident_id,recorded_by_id,recorded_by_role,facility_id,status,visit_date,bp)
      values('INVALID','BP-RESIDENT',$1,'rhu_personnel',$2,'draft',now(),$3)`, [actor, facility, bp]), { code: '23514' });
  }
  await db.exec(`alter table visits disable trigger validate_visit_bp_measurement;
    insert into visits(id,resident_id,recorded_by_id,recorded_by_role,facility_id,status,visit_date,bp,bp_classification)
      values('HISTORICAL','BP-RESIDENT','${actor}','rhu_personnel','${facility}','draft',now(),'old text','{"code":"low","label":"Historical label"}');
    alter table visits enable trigger validate_visit_bp_measurement;`);
  await db.exec(await readFile(new URL(migration, directory), 'utf8'));
  await db.exec("update visits set findings='Updated note' where id='HISTORICAL'");
  assert.deepEqual((await db.query("select bp,bp_classification from visits where id='HISTORICAL'")).rows[0],
    { bp: 'old text', bp_classification: { code: 'low', label: 'Historical label' } });
});

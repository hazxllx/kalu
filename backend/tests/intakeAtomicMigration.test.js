import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { mapVisitToPatient } from '../../frontend/src/lib/phnWorkflowMap.js';
import { classifyBloodPressure } from '../../shared/bloodPressure.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const MUNI = '22222222-2222-4222-8222-222222222222';
const BARANGAY = '33333333-3333-4333-8333-333333333333';
const FACILITY = '44444444-4444-4444-8444-444444444444';
const KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_KEY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const hash = 'a'.repeat(64);

test('atomic triage RPC is scoped, idempotent, and rolls back patient creation on visit failure', async (t) => {
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
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    try { await db.exec(await readFile(new URL(file, directory), 'utf8')); }
    catch (error) { throw new Error(`${file}: ${error.message}`, { cause: error }); }
  }
  await db.exec(`
    insert into public.municipalities(id,name) values('${MUNI}','Synthetic Triage Municipality');
    insert into public.barangays(id,municipality_id,name,status) values('${BARANGAY}','${MUNI}','San Antonio','Active');
    insert into public.facilities(id,municipality_id,name,type) values('${FACILITY}','${MUNI}','Synthetic Test RHU','rhu');
    insert into auth.users(id,email,raw_user_meta_data) values('${ACTOR}','synthetic-rhu@example.test','{"full_name":"Test Worker"}');
    update public.profiles set status='active',role='rhu_personnel',municipality_id='${MUNI}',facility_id='${FACILITY}',rhu_stations=array['triage'] where id='${ACTOR}';
  `);

  const resident = {
    id: 'RES-1', health_record_no: 'RHU-1', first_name: 'Ada', last_name: 'Example', middle_name: '', age: 30,
    sex: 'Female', barangay_id: BARANGAY, birth_date: null,
  };
  const visit = {
    id: 'SUB-1', visit_date: '2026-11-19T09:00:00Z', chief_complaint: 'Checkup', facility_id: FACILITY,
    bp: '120/80', height_cm: 170, weight_kg: 65, bmi: 22.5, blood_sugar: 100,
    bp_classification: classifyBloodPressure('120/80'),
    triage_snapshot: { triageWarnings: [] },
  };
  const call = async (key = KEY, fingerprint = hash, p = resident, v = visit) => {
    await db.query("select set_config('request.jwt.claim.role', 'service_role', false)");
    return db.query('select public.create_submitted_triage($1::uuid,$2,$3::uuid,$4::jsonb,$5::jsonb) as result',
      [key, fingerprint, ACTOR, p === null ? null : JSON.stringify(p), JSON.stringify(v)]);
  };
  const first = await call();
  assert.equal(first.rows[0].result.visit.status, 'submitted');
  const snapshot = first.rows[0].result.visit.triage_snapshot;
  assert.equal(snapshot.residentId, 'RES-1');
  assert.equal(snapshot.resident.id, 'RES-1');
  assert.equal(snapshot.recordedBy, ACTOR);
  assert.equal(snapshot.recordedByName, 'Test Worker');
  assert.equal(snapshot.vitals.bloodSugar, 100);
  assert.equal(snapshot.vitals.bmi, 22.5);
  assert.deepEqual(first.rows[0].result.visit.bp_classification, visit.bp_classification);
  assert.deepEqual(snapshot.bloodPressureClassification, visit.bp_classification);
  assert.equal(snapshot.submittedAt, first.rows[0].result.visit.submitted_at);
  assert.equal((await call()).rows[0].result.deduplicated, true);
  await assert.rejects(call(KEY, 'b'.repeat(64)), { code: '23505' });
  await assert.rejects(call(OTHER_KEY, hash, { ...resident, id: 'RES-ROLLBACK', health_record_no: 'HR-ROLLBACK', first_name: 'Rollback' }, { ...visit, id: 'SUB-ROLLBACK', visit_date: 'not-a-date' }), { code: '22007' });
  const rolledBack = await db.query("select count(*)::int as n from public.residents where id = 'RES-ROLLBACK'");
  assert.equal(rolledBack.rows[0].n, 0);
  await assert.rejects(call(OTHER_KEY, hash, { ...resident, id: 'RES-CROSS', health_record_no: 'HR-CROSS', first_name: 'Bela' }, { ...visit, id: 'SUB-CROSS', facility_id: '55555555-5555-4555-8555-555555555555' }), { code: '42501' });
  const counts = await db.query('select (select count(*)::int from public.residents) residents, (select count(*)::int from public.visits) visits');
  assert.deepEqual(counts.rows[0], { residents: 1, visits: 1 });
  const grants = await db.query(`select has_function_privilege('authenticated','public.create_submitted_triage(uuid,text,uuid,jsonb,jsonb)','EXECUTE') authenticated, has_function_privilege('service_role','public.create_submitted_triage(uuid,text,uuid,jsonb,jsonb)','EXECUTE') service_role`);
  assert.deepEqual(grants.rows[0], { authenticated: false, service_role: true });

  // An accepted referral's existing draft must be submitted in place. The
  // actual UUID FK and canonical receiving-assignment triggers remain enabled.
  const referralId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await db.exec(`insert into public.health_referrals(id,resident_id,status,recipient_personnel_id,recipient_facility_id,recipient_role,recipient_station,created_by)
    values('${referralId}','RES-1','Accepted','${ACTOR}','${FACILITY}','rhu_personnel','triage','${ACTOR}');
    insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,facility_id,status,visit_date,referral_id)
    values('SUB-REF-DRAFT','RES-1','${ACTOR}','rhu_personnel','${FACILITY}','draft',now(),'${referralId}');`);
  const refVisit = { ...visit, id: 'SUB-MUST-NOT-BE-CREATED', resident_id: 'RES-1', referral_id: referralId };
  const referralResult = (await call(OTHER_KEY, hash, null, refVisit)).rows[0].result.visit;
  assert.equal(referralResult.id, 'SUB-REF-DRAFT');
  assert.equal(referralResult.referral_id, referralId);
  assert.equal(referralResult.status, 'submitted');
  assert.equal((await call(OTHER_KEY, hash, null, refVisit)).rows[0].result.deduplicated, true);
  await assert.rejects(() => call('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', hash, null, refVisit), { code: '23505' });
  assert.equal((await db.query('select count(*)::int as n from public.visits')).rows[0].n, 2);
  for (const mutation of ["blood_sugar=99", "chief_complaint='Changed'", "resident_id='other'", 'triage_snapshot=null']) {
    await assert.rejects(() => db.exec(`update public.visits set ${mutation} where id='SUB-REF-DRAFT'`), { code: mutation.startsWith('resident_id') ? '42501' : '23514' });
  }
  await db.exec("update public.visits set findings='Recorded findings',treatment_given='Recorded treatment',status='completed' where id='SUB-REF-DRAFT'");
  const persisted = (await db.query("select * from public.visits where id='SUB-REF-DRAFT'")).rows[0];
  assert.equal(persisted.resident_id, 'RES-1');
  assert.deepEqual(persisted.triage_snapshot, referralResult.triage_snapshot);
  const display = mapVisitToPatient({ id: persisted.id, residentId: persisted.resident_id, status: persisted.status,
    triageSnapshot: persisted.triage_snapshot, resident: { id: 'RES-1' } });
  assert.equal(display.triage.weight, 65);
  assert.equal(display.triage.bloodPressure, '120/80');
  assert.equal(display.triage.bloodSugar, 100);
  assert.equal(display.triage.personnel, 'Test Worker');
  assert.equal(display.triage.id, 'SUB-REF-DRAFT');

  // The same atomic path must persist emergency context supplied by the server.
  const emergencyBp = classifyBloodPressure('185/125', { chiefComplaint: 'Chest pain' });
  const emergency = (await call('ffffffff-ffff-4fff-8fff-ffffffffffff', hash, null,
    { ...visit, id: 'SUB-EMERGENCY', resident_id: 'RES-1', bp: '185/125', chief_complaint: 'Chest pain', bp_classification: emergencyBp })).rows[0].result.visit;
  assert.equal(emergency.bp_classification.emergency, true);
  assert.equal(emergency.bp_classification.urgency, 'immediate');
  assert.deepEqual(emergency.triage_snapshot.bloodPressureClassification, emergencyBp);

  for (const bp of ['120/', '120/201', '80/120', '301/80', '120/80bad']) {
    await assert.rejects(db.query(`insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,facility_id,status,visit_date,bp)
      values('SUB-INVALID','RES-1',$1,'rhu_personnel',$2,'draft',now(),$3)`, [ACTOR, FACILITY, bp]), { code: '23514' });
  }
  // Model an old invalid row: applying the new migration must not rewrite it.
  await db.exec(`alter table public.visits disable trigger validate_visit_bp_measurement;
    insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,facility_id,status,visit_date,bp,bp_classification)
      values('SUB-HISTORICAL','RES-1','${ACTOR}','rhu_personnel','${FACILITY}','draft',now(),'old reading','{"code":"low","label":"Historical label"}');
    alter table public.visits enable trigger validate_visit_bp_measurement;`);
  await db.exec(await readFile(new URL('20261120210000_bp_classification_integrity.sql', directory), 'utf8'));
  await db.exec("update public.visits set findings='Historical note preserved' where id='SUB-HISTORICAL'");
  const old = (await db.query("select bp,bp_classification from public.visits where id='SUB-HISTORICAL'")).rows[0];
  assert.deepEqual(old, { bp: 'old reading', bp_classification: { code: 'low', label: 'Historical label' } });
});

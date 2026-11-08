import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// In-memory PostgreSQL only. No application functions, tables or policies are
// mocked, and no Supabase credentials, server, network or production writes run.
const db = new PGlite({ extensions: { pgcrypto } });
const directory = new URL('../../supabase/migrations/', import.meta.url);
const candidate = '20261107153000_atomic_transfer_scope_repair.sql';
const ids = Object.fromEntries(['municipality', 'foreignMunicipality', 'source', 'target', 'third',
  'foreign', 'legacy', 'sourceBhs', 'targetBhs', 'rhu', 'sourceService', 'rhuService',
  'duplicateMunicipality', 'duplicateSource', 'duplicateTarget', 'duplicateOwner']
  .map((key) => [key, randomUUID()]));
const people = {};
const scopeTables = ['visits', 'follow_ups', 'tcl_entries', 'maternal_records', 'maternal_visits', 'immunizations', 'health_referrals'];
const preservedTables = ['residents', 'profiles', ...scopeTables, 'referrals', 'health_referral_legacy_map',
  'health_referral_history', 'households', 'household_members', 'household_member_health_profiles',
  'visit_plans', 'appointments', 'health_service_attendance', 'health_services', 'health_service_assignments',
  'notifications', 'health_audit_logs', 'documents', 'transfer_requests', 'transfer_request_audit_logs', 'record_counters'];
const query = async (sql, params = []) => {
  try { return (await db.query(sql, params)).rows; }
  catch (error) { throw Object.assign(new Error(error.message, { cause: error }), { code: error.code }); }
};
const approve = async (requestId, reviewer = people.target) =>
  (await query('select to_jsonb(public.approve_transfer_request($1,$2)) as result', [requestId, reviewer]))[0].result;
const records = async (table) => (await query(`select coalesce(jsonb_agg(to_jsonb(t)
  order by to_jsonb(t)::text),'[]'::jsonb) as rows from public.${table} t`))[0].rows;
const snapshot = async () => Object.fromEntries(await Promise.all(preservedTables.map(async (table) => [table, await records(table)])));
const withoutScope = (row) => Object.fromEntries(Object.entries(row)
  .filter(([key]) => !['barangay_id', 'barangay', 'municipality_id', 'updated_at'].includes(key)));
const asClient = async (role, actorId, run, claimRole = role) => {
  await query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [actorId || '', claimRole]);
  await db.exec(`set role ${role}`);
  try { return await run(); }
  finally {
    await db.exec('reset role');
    await db.exec("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false)");
  }
};
const account = async (role, barangay = null, municipality = ids.municipality, status = 'active', facility = null, stations = []) => {
  const id = randomUUID();
  await query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',
    [id, `${id}@example.test`, JSON.stringify({ full_name: `Private ${role}` })]);
  await query(`update public.profiles set role=$2,status=$3,barangay_id=$4,municipality_id=$5,
    facility_id=$6,rhu_stations=$7 where id=$1`, [id, role, status, barangay, municipality, facility, stations]);
  return id;
};
let scenarioNumber = 0;
const scenario = async ({ residentId = `TRANSFER-CASE-${++scenarioNumber}`, owner = null, status = 'pending',
  source = ids.source, target = ids.target, proof = true, ownerRole = 'resident', ownerStatus = 'active' } = {}) => {
  owner ||= await account(ownerRole, source, ids.municipality, ownerStatus);
  await query(`insert into public.residents(id,health_record_no,first_name,last_name,birth_date,barangay_id,
    auth_user_id,verification_status) values($1,$2,'Private Patient','Transfer','1990-05-20',$3,$4,'approved')`,
  [residentId, `HR-${residentId}`, source, owner]);
  const requestId = randomUUID();
  await query(`insert into public.transfer_requests(id,auth_user_id,resident_id,from_barangay_id,to_barangay_id,
    status,submitted_at,reason) values($1,$2,$3,$4,$5,$6,now(),'Current residency change')`,
  [requestId, owner, residentId, source, target, status]);
  let proofId;
  if (proof) {
    proofId = randomUUID();
    await query(`insert into public.documents(id,transfer_request_id,document_type,purpose,file_name,storage_path,
      mime_type,size_bytes,verification_status,uploaded_by)
      values($1,$2,'transfer_proof_of_address','transfer_proof_of_address','proof.pdf',$3,'application/pdf',100,'pending',$4)`,
    [proofId, requestId, `transfer-documents/${requestId}/${proofId}.pdf`, owner]);
  }
  return { residentId, owner, requestId, proofId };
};
const rejectWithoutWrites = async (run, code) => {
  const saved = await snapshot();
  await assert.rejects(run, (error) => error.code === code);
  assert.deepEqual(await snapshot(), saved);
};
let main;
let inactiveRequest;
let migrationSql;
let migrationBefore;
let migrationAfter;
let baselineBlocker;
let appliedFiles;

const seedLegacyDuplicates = async () => {
  await query('insert into public.municipalities(id,name) values($1,$2)', [ids.duplicateMunicipality, 'Retained Duplicate Ownership Municipality']);
  await query(`insert into public.barangays(id,municipality_id,name)
    values($1,$2,'San Isidro'),($3,$2,'San Antonio')`, [ids.duplicateSource, ids.duplicateMunicipality, ids.duplicateTarget]);
  await query('insert into auth.users(id,email) values($1,$2)', [ids.duplicateOwner, `${ids.duplicateOwner}@example.test`]);
  await query(`insert into public.residents(id,health_record_no,first_name,last_name,barangay_id,auth_user_id)
    values('TRANSFER-LEGACY-OWNER-A','HR-TRANSFER-LEGACY-OWNER-A','Legacy One','Transfer',$1,$2),
      ('TRANSFER-LEGACY-OWNER-B','HR-TRANSFER-LEGACY-OWNER-B','Legacy Two','Transfer',$1,$2)`, [ids.duplicateSource, ids.duplicateOwner]);
};

const seedHistorical = async () => {
  await query('insert into public.municipalities(id,name) values($1,$2),($3,$4)',
    [ids.municipality, 'Transfer Test Municipality', ids.foreignMunicipality, 'Foreign Transfer Municipality']);
  await query(`insert into public.barangays(id,municipality_id,name) values
    ($1,$2,'San Isidro'),($3,$2,'San Antonio'),($4,$2,'Old San Roque'),
    ($5,$6,'San Antonio'),($7,$2,'Historical Transfer Barangay')`,
  [ids.source, ids.municipality, ids.target, ids.third, ids.foreign, ids.foreignMunicipality, ids.legacy]);
  await query(`insert into public.facilities(id,municipality_id,barangay_id,name,type) values
    ($1,$2,$3,'Source BHS','barangay_health_station'),($4,$2,$5,'Target BHS','barangay_health_station'),
    ($6,$2,null,'Transfer RHU','rhu')`, [ids.sourceBhs, ids.municipality, ids.source, ids.targetBhs, ids.target, ids.rhu]);
  people.source = await account('health_supervisor', ids.source);
  people.target = await account('health_supervisor', ids.target);
  people.targetPeer = await account('health_supervisor', ids.target);
  people.third = await account('health_supervisor', ids.third);
  people.phn = await account('phn');
  people.mho = await account('mho');
  people.admin = await account('admin', null, null);
  people.foreignPhn = await account('phn', null, ids.foreignMunicipality);
  people.foreignSupervisor = await account('health_supervisor', ids.foreign, ids.foreignMunicipality);
  people.bhw = await account('bhw', ids.source);
  people.triage = await account('rhu_personnel', null, ids.municipality, 'active', ids.rhu, ['triage']);
  for (const role of ['health_supervisor', 'phn', 'mho', 'admin']) {
    await query(`insert into public.role_permissions(role,permission_id,granted)
      values($1,'residents.transfer.approve',true) on conflict(role,permission_id) do update set granted=true`, [role]);
  }
  main = await scenario({ residentId: 'TRANSFER-MAIN' });
  inactiveRequest = await scenario({ residentId: 'TRANSFER-INACTIVE', target: ids.legacy });
  await query(`insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,recorded_by_name,
    responsible_personnel_id,responsible_personnel_name,facility_id,status,visit_date,completed_at,
    chief_complaint,clinical_history,findings,treatment_given,bp)
    values('TRANSFER-SOURCE-VISIT',$1,$2::uuid::text,'health_supervisor','Original recorder',$2,'Original responsible worker',
      $3,'completed','2026-10-01T08:00:00Z','2026-10-01T09:00:00Z','Original complaint',
      'Original clinical history','Original findings','Original treatment','145/95')`,
  [main.residentId, people.source, ids.sourceBhs]);
  await query(`insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,status,facility_id)
    values('TRANSFER-OTHER-VISIT','TRANSFER-INACTIVE',$1,'phn','in_review',$2)`, [people.phn, ids.rhu]);
  for (const [id, visit, status] of [['TRANSFER-LEGACY', 'TRANSFER-SOURCE-VISIT', 'completed'],
    ['TRANSFER-LEGACY-MISMATCH', 'TRANSFER-OTHER-VISIT', 'referred']]) {
    await query(`insert into public.referrals(id,resident_id,visit_id,status,created_by_id,
      referring_facility,receiving_facility,patient_snapshot,visit_snapshot,status_history,printed_at)
      values($1,$2,$3,$4,$5,'Original source facility','Original destination facility',$6,$7,$8,'2026-10-01T10:00:00Z')`,
    [id, main.residentId, visit, status, people.source,
      JSON.stringify({ firstName: 'Frozen identity', barangay: 'San Isidro', residentId: main.residentId }),
      JSON.stringify({ id: visit, findings: 'Frozen clinical findings', facilityId: ids.sourceBhs }),
      JSON.stringify([{ status, at: '2026-10-01T09:00:00Z', notes: 'Original referral history' }])]);
  }
};

const seedOperational = async () => {
  await query(`insert into public.households(id,municipality_id,barangay_id,barangay,head_name,verification_status)
    values('TRANSFER-SOURCE-HH',$1,$2,'San Isidro','Original census household','Verified'),
      ('TRANSFER-TARGET-HH',$1,$3,'San Antonio','Existing target household','Verified')`,
  [ids.municipality, ids.source, ids.target]);
  await query(`insert into public.household_members(household_id,resident_id,name,birthday,classification)
    values('TRANSFER-SOURCE-HH',$1,'Original census member','1990-05-20','Original census classification'),
      ('TRANSFER-TARGET-HH',$1,'Existing target member','1990-05-20','Existing target classification')`, [main.residentId]);
  await query(`insert into public.household_member_health_profiles(household_member_id,height_cm,weight_kg,bmi,
    bmi_measured_at,date_of_death,cause_of_death,trans_out,remarks)
    select id,160,60,23.44,'2026-10-01',null,'Retained historic field',true,'Original health history'
    from public.household_members where household_id='TRANSFER-SOURCE-HH'`);
  await query(`insert into public.follow_ups(resident_id,consultation_id,purpose,scheduled_date,assigned_provider,
    notes,status,requires_resident_response,resident_decision,resident_decision_at,resident_decision_reason,created_by)
    values($1,'TRANSFER-SOURCE-VISIT','Original plan','2026-12-01','Original provider','Original follow-up notes',
      'Scheduled',true,'approved','2026-10-01T12:00:00Z','Original confirmation',$2),
      ($1,'TRANSFER-SOURCE-VISIT','Pending plan','2026-12-02','Original provider','Pending plan notes',
      'Pending',true,'pending',null,'',$2)`, [main.residentId, people.source]);
  await query(`insert into public.tcl_entries(resident_id,program,assigned_bhw_id,notes,created_by)
    values($1,'TB',$2,'Original program history',$3)`, [main.residentId, people.bhw, people.source]);
  const maternalId = (await query(`insert into public.maternal_records(resident_id,status,provider,notes,created_by)
    values($1,'Active','Original maternal provider','Original pregnancy history',$2) returning id`, [main.residentId, people.source]))[0].id;
  await query(`insert into public.maternal_visits(resident_id,maternal_case_id,visit_date,provider,notes,created_by)
    values($1,$2,'2026-10-01','Original visit provider','Original prenatal findings',$3)`, [main.residentId, maternalId, people.source]);
  await query(`insert into public.immunizations(resident_id,vaccine,administered_date,provider,status,notes,created_by)
    values($1,'Recorded vaccine','2026-10-01','Original immunization provider','Completed','Original dose history',$2)`, [main.residentId, people.source]);
  await query(`insert into public.health_services(id,name,municipality_id,barangay_id,facility_id,created_by)
    values($1,'Source-specific service',$2,$3,$4,$5),($6,'Municipal service',$2,null,$7,$8)`,
  [ids.sourceService, ids.municipality, ids.source, ids.sourceBhs, people.source, ids.rhuService, ids.rhu, people.phn]);
  await query(`insert into public.visit_plans(resident_id,barangay_id,service_id,facility_type,planned_date,note)
    values($1,$2,$3,'BHC','2026-12-01','Original source intent'),($1,$2,$4,'RHU','2026-12-02','Original RHU intent')`,
  [main.residentId, ids.source, ids.sourceService, ids.rhuService]);
  await query(`insert into public.health_service_attendance(service_id,resident_id,scheduled_date,attendance_status,
    recorded_by,recorded_by_name,notes) values($1,$2,'2026-10-01','attended',$3,'Original attendance worker','Original attendance history')`,
  [ids.sourceService, main.residentId, people.source]);
  await query(`insert into public.notifications(recipient_id,title,message,related_type,related_id)
    values($1,'Original source notice','Original notification','transfer_request',$3),
      ($2,'Original resident notice','Original notification','transfer_request',$3)`, [people.source, main.owner, main.requestId]);
  await query(`insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,recorded_by_name,status,
    facility_id,visit_date,client_operation_key,client_operation_payload_hash,recorded_at,consultation_details,
    consultation_effects_completed_at) values('TRANSFER-KEYED-VISIT',$1,$2,'health_supervisor','Original recorder',
    'completed',$3,'2026-10-02T08:00:00Z',$4,$5,'2026-10-02T07:30:00Z',$6,'2026-10-02T09:00:00Z')`,
  [main.residentId, people.source, ids.sourceBhs, randomUUID(), 'a'.repeat(64),
    JSON.stringify({ consultationDate: '2026-10-02', findings: 'Non-lossy findings', nextVisitDate: '2026-12-01' })]);
};

before(async () => {
  // Supabase platform stubs match the existing aggregate/claim chain tests.
  await db.exec(`create schema auth; create schema storage;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as
      $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
    create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb not null default '{}',
      raw_app_meta_data jsonb not null default '{}',email_confirmed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    create policy objects_owner on storage.objects for all to authenticated using(owner=auth.uid()) with check(owner=auth.uid());
    select set_config('request.jwt.claim.role','service_role',false);`);
  appliedFiles = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of appliedFiles) {
    if (file === '20260927140000_resident_auth_user_unique.sql') await seedLegacyDuplicates();
    if (file === '20261031000000_restrict_barangays_to_approved_list.sql') await seedHistorical();
    if (file === candidate) {
      await seedOperational();
      migrationBefore = await snapshot();
      try { await approve(main.requestId); }
      catch (error) { baselineBlocker = error; }
      assert.equal(baselineBlocker?.code, 'P0001');
      assert.match(baselineBlocker.message, /approved active barangay/i);
      assert.deepEqual(await snapshot(), migrationBefore, 'old approval rolls back without partial writes');
      migrationSql = await readFile(new URL(file, directory), 'utf8');
    }
    try { await db.exec(await readFile(new URL(file, directory), 'utf8')); }
    catch (error) { throw new Error(`Migration ${file}: ${error.message}`, { cause: error }); }
    if (file === candidate) migrationAfter = await snapshot();
  }
}, { timeout: 120000 });
after(async () => { await db.close(); });

test('complete current chain reproduces the old trigger-order defect; forward migration writes no existing data', async (t) => {
  assert.ok(appliedFiles.includes(candidate));
  assert.equal(appliedFiles.filter((file) => file.startsWith('20261106')).length, 7);
  assert.equal(await readFile(new URL('20261101000000_align_approved_barangay_name.sql', directory), 'utf8'), '');
  assert.deepEqual(migrationAfter, migrationBefore);
  const triggers = await query(`select tgname,tgenabled from pg_trigger
    where tgrelid='public.residents'::regclass and not tgisinternal order by tgname`);
  const names = triggers.map((trigger) => trigger.tgname);
  assert.ok(names.indexOf('approved_barangay_assignment_guard') < names.indexOf('residents_sync_scope_trigger'));
  assert.ok(triggers.every((trigger) => ['O', 'A'].includes(trigger.tgenabled)));
  const constraints = await query(`select conname,convalidated,pg_get_constraintdef(oid) as definition
    from pg_constraint where conrelid='public.transfer_requests'::regclass`);
  const status = constraints.find((constraint) => constraint.conname === 'transfer_requests_status_check');
  assert.equal(status.convalidated, true);
  for (const value of ['draft', 'pending', 'under_review', 'resubmission_required', 'approved', 'rejected', 'cancelled']) {
    assert.match(status.definition, new RegExp(`'${value}'`));
  }
  const indexes = await query(`select indisunique,indisvalid,pg_get_expr(indpred,indrelid) as predicate
    from pg_index where indexrelid='public.transfer_requests_one_open_per_user'::regclass`);
  assert.equal(indexes[0].indisunique, true);
  assert.equal(indexes[0].indisvalid, true);
  assert.match(indexes[0].predicate, /pending.*under_review/);
  t.diagnostic(`Executed all ${appliedFiles.length} current migrations in order, including all seven November 6 files and the empty applied-version placeholder.`);
});

test('legacy referral rows remain read-only even for the function owner, and service-role direct updates remain revoked', async () => {
  await rejectWithoutWrites(() => query("update public.referrals set updated_at=updated_at where id='TRANSFER-LEGACY'"), '55000');
  await asClient('service_role', null, async () => {
    await assert.rejects(() => query("update public.referrals set updated_at=updated_at where id='TRANSFER-LEGACY'"), (error) => error.code === '42501');
  });
});

test('normal same-municipality approval atomically moves canonical resident/profile and current references without changing clinical provenance', async () => {
  const saved = await snapshot();
  const result = await asClient('service_role', people.target, () => approve(main.requestId));
  assert.equal(result.id, main.requestId);
  assert.equal(result.status, 'approved');
  assert.equal(result.from_barangay_id, ids.source);
  assert.equal(result.to_barangay_id, ids.target);
  assert.equal(result.reviewed_by, people.target);
  assert.ok(result.reviewed_at);
  const after = await snapshot();
  const resident = after.residents.find((row) => row.id === main.residentId);
  const originalResident = saved.residents.find((row) => row.id === main.residentId);
  assert.deepEqual(withoutScope({ ...resident, revision: originalResident.revision }), withoutScope(originalResident));
  assert.equal(resident.barangay_id, ids.target);
  assert.equal(resident.barangay, 'San Antonio');
  assert.equal(resident.municipality_id, ids.municipality);
  assert.equal(resident.revision, originalResident.revision + 1);
  const profile = after.profiles.find((row) => row.id === main.owner);
  assert.deepEqual(withoutScope(profile), withoutScope(saved.profiles.find((row) => row.id === main.owner)));
  assert.equal(profile.barangay_id, ids.target);
  assert.equal(profile.municipality_id, ids.municipality);
  for (const table of scopeTables) {
    assert.equal(after[table].length, saved[table].length, `${table}: no duplicates`);
    for (const row of after[table].filter((record) => record.resident_id === main.residentId)) {
      assert.deepEqual(withoutScope(row), withoutScope(saved[table].find((original) => original.id === row.id)), `${table}: retained original fields`);
      assert.equal(row.barangay_id, ids.target, table);
      assert.equal(row.municipality_id, ids.municipality, table);
    }
  }
  for (const table of ['referrals', 'health_referral_legacy_map', 'health_referral_history', 'households',
    'household_member_health_profiles', 'health_service_attendance', 'health_services', 'health_service_assignments',
    'notifications', 'appointments', 'record_counters']) {
    assert.deepEqual(after[table], saved[table], `${table}: unchanged history`);
  }
  const sourceMember = after.household_members.find((row) => row.household_id === 'TRANSFER-SOURCE-HH');
  const originalMember = saved.household_members.find((row) => row.id === sourceMember.id);
  assert.deepEqual(withoutScope({ ...sourceMember, resident_id: originalMember.resident_id }), withoutScope(originalMember));
  assert.equal(sourceMember.resident_id, null);
  assert.deepEqual(after.household_members.find((row) => row.household_id === 'TRANSFER-TARGET-HH'),
    saved.household_members.find((row) => row.household_id === 'TRANSFER-TARGET-HH'));
  const sourcePlan = after.visit_plans.find((row) => row.service_id === ids.sourceService);
  assert.deepEqual(sourcePlan, saved.visit_plans.find((row) => row.id === sourcePlan.id));
  const rhuPlan = after.visit_plans.find((row) => row.service_id === ids.rhuService);
  assert.equal(rhuPlan.barangay_id, ids.target);
  assert.deepEqual(withoutScope(rhuPlan), withoutScope(saved.visit_plans.find((row) => row.id === rhuPlan.id)));
  const events = after.transfer_request_audit_logs.filter((row) => row.transfer_request_id === main.requestId);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'transfer_scope_repaired');
  assert.equal(events[0].actor_id, people.target);
  assert.equal(events[0].metadata.from_barangay_id, ids.source);
  assert.equal(events[0].metadata.to_barangay_id, ids.target);
  assert.deepEqual(events[0].metadata.household_links_before,
    [{ id: sourceMember.id, household_id: sourceMember.household_id, resident_id: main.residentId }]);
  for (const entry of events[0].metadata.record_scopes_before) {
    const original = saved[entry.table].find((row) => row.id === entry.id);
    assert.equal(entry.barangay_id, original.barangay_id);
    assert.equal(entry.municipality_id, original.municipality_id);
  }
  assert.equal(events[0].metadata.record_scopes_before.length,
    scopeTables.reduce((count, table) => count + saved[table].filter((row) => row.resident_id === main.residentId).length, 0));
  assert.doesNotMatch(JSON.stringify(events[0].metadata), /Original clinical|Frozen clinical|Private Patient|Original health history/);
});

test('source loses moved resident/profile/visit/referral access, target gains scope, and inconsistent legacy history stays quarantined', async () => {
  const maps = await records('health_referral_legacy_map');
  const valid = maps.find((row) => row.legacy_referral_id === 'TRANSFER-LEGACY');
  const invalid = maps.find((row) => row.legacy_referral_id === 'TRANSFER-LEGACY-MISMATCH');
  assert.equal(valid.source_visit_matches_resident, true);
  assert.equal(invalid.source_visit_matches_resident, false);
  for (const actor of [people.source, people.bhw, people.third, people.foreignPhn, people.foreignSupervisor]) {
    await asClient('authenticated', actor, async () => {
      assert.equal((await query('select id from public.residents where id=$1', [main.residentId])).length, 0);
      assert.equal((await query('select id from public.profiles where id=$1', [main.owner])).length, 0);
      assert.equal((await query('select id from public.visits where resident_id=$1', [main.residentId])).length, 0);
      assert.equal((await query('select id from public.referrals where resident_id=$1', [main.residentId])).length, 0);
      assert.equal((await query('select id from public.visit_plans where resident_id=$1', [main.residentId])).length, 0);
    });
  }
  for (const actor of [people.target, people.targetPeer, people.phn, people.mho, main.owner]) {
    await asClient('authenticated', actor, async () => {
      assert.equal((await query('select id from public.residents where id=$1', [main.residentId])).length, 1);
      assert.equal((await query('select id from public.profiles where id=$1', [main.owner])).length, 1);
      assert.equal((await query('select id from public.visits where resident_id=$1', [main.residentId])).length, 2);
      assert.equal((await query('select id from public.health_referrals where id=$1', [valid.health_referral_id])).length, 1);
      assert.equal((await query('select id from public.referrals where id=$1', ['TRANSFER-LEGACY'])).length, 1);
      assert.equal((await query('select id from public.health_referrals where id=$1', [invalid.health_referral_id])).length, 0);
      for (const table of scopeTables.filter((table) => !['visits', 'health_referrals'].includes(table))) {
        assert.ok((await query(`select id from public.${table} where resident_id=$1`, [main.residentId])).length > 0, table);
      }
    });
  }
  await asClient('authenticated', people.admin, async () => {
    assert.equal((await query('select id from public.health_referrals where id=$1', [invalid.health_referral_id])).length, 1);
  });
  await asClient('authenticated', people.source, async () => {
    assert.equal((await query("update public.visits set findings='Unauthorized change' where resident_id=$1 returning id", [main.residentId])).length, 0);
    assert.equal((await query('select id from public.household_members where resident_id=$1', [main.residentId])).length, 0);
  });
});

test('retries and competing receiving reviewers produce one decision and no additional resident/profile/clinical/household writes', async (t) => {
  const saved = await snapshot();
  assert.equal(await approve(main.requestId), null);
  assert.equal(await approve(main.requestId, people.targetPeer), null);
  assert.deepEqual(await snapshot(), saved);
  const race = await scenario();
  const results = await Promise.all([approve(race.requestId, people.target), approve(race.requestId, people.targetPeer)]);
  assert.equal(results.filter(Boolean).length, 1);
  const decided = results.find(Boolean);
  assert.equal(decided.reviewed_by, people.target);
  assert.equal((await query('select count(*)::integer as n from public.transfer_request_audit_logs where transfer_request_id=$1', [race.requestId]))[0].n, 1);
  const afterRace = await snapshot();
  assert.equal(await approve(race.requestId, people.targetPeer), null);
  assert.deepEqual(await snapshot(), afterRace);
  t.diagnostic('PGlite serializes one local connection: real row locks, statements and uniqueness are tested, not multi-connection MVCC scheduling.');
});

test('stale/wrong source, cross-municipality destination and wrong request account fail without any writes', async () => {
  const stale = await scenario();
  await query('update public.residents set barangay_id=$2,barangay=$3 where id=$1', [stale.residentId, ids.third, 'Old San Roque']);
  await rejectWithoutWrites(() => approve(stale.requestId), '40001');
  const wrongSource = await scenario({ source: ids.target, target: ids.third });
  await query('update public.transfer_requests set from_barangay_id=$2 where id=$1', [wrongSource.requestId, ids.source]);
  await rejectWithoutWrites(() => approve(wrongSource.requestId, people.third), '40001');
  const foreign = await scenario({ target: ids.foreign });
  await rejectWithoutWrites(() => approve(foreign.requestId, people.foreignSupervisor), '23514');
  const wrongOwner = await scenario();
  const impostor = await account('resident', ids.source);
  await query('update public.transfer_requests set auth_user_id=$2 where id=$1', [wrongOwner.requestId, impostor]);
  await rejectWithoutWrites(() => approve(wrongOwner.requestId), '23514');
  await rejectWithoutWrites(() => approve(inactiveRequest.requestId), '23514');
});

test('reviewer authority comes from active profile, target UUID, municipality, permission and authenticated actor, never supplied role claims', async () => {
  const pending = await scenario();
  for (const actor of [people.source, people.third, people.bhw, people.triage, people.foreignPhn, randomUUID()]) {
    await rejectWithoutWrites(() => approve(pending.requestId, actor), '42501');
  }
  const disabled = await account('health_supervisor', ids.target, ids.municipality, 'disabled');
  await rejectWithoutWrites(() => approve(pending.requestId, disabled), '42501');
  for (const [approval, setup, suspended] of [['pending', false, null], ['approved', true, null], ['approved', false, '2026-11-01T00:00:00Z']]) {
    const actor = await account('health_supervisor', ids.target);
    await query('insert into public.personnel_accounts(account_id,approval_status,setup_required,suspended_at) values($1,$2,$3,$4)',
      [actor, approval, setup, suspended]);
    await rejectWithoutWrites(() => approve(pending.requestId, actor), '42501');
  }
  await query("update public.role_permissions set granted=false where role='health_supervisor' and permission_id='residents.transfer.approve'");
  try { await rejectWithoutWrites(() => approve(pending.requestId), '42501'); }
  finally { await query("update public.role_permissions set granted=true where role='health_supervisor' and permission_id='residents.transfer.approve'"); }
  const saved = await snapshot();
  await asClient('service_role', people.source, async () => {
    await assert.rejects(() => approve(pending.requestId, people.target), (error) => error.code === '42501');
  });
  assert.deepEqual(await snapshot(), saved);
  for (const [role, claimedRole] of [['anon', 'anon'], ['authenticated', 'authenticated'], ['authenticated', 'service_role']]) {
    await asClient(role, people.target, async () => {
      await assert.rejects(() => approve(pending.requestId), (error) => error.code === '42501');
    }, claimedRole);
  }
  assert.deepEqual(await snapshot(), saved);
});

test('retained duplicate account links and a staff-owned patient never trigger arbitrary profile or residency reassignment', async () => {
  assert.equal((await query("select to_regclass('public.residents_auth_user_id_unique') as name"))[0].name, null);
  const requestId = randomUUID();
  await query(`insert into public.transfer_requests(id,auth_user_id,resident_id,from_barangay_id,to_barangay_id,status)
    values($1,$2,'TRANSFER-LEGACY-OWNER-A',$3,$4,'pending')`, [requestId, ids.duplicateOwner, ids.duplicateSource, ids.duplicateTarget]);
  await rejectWithoutWrites(() => approve(requestId, people.admin), '23514');
  for (const residentId of ['TRANSFER-LEGACY-OWNER-A', 'TRANSFER-LEGACY-OWNER-B']) {
    const current = (await query('select to_jsonb(r) as row from public.residents r where id=$1', [residentId]))[0].row;
    assert.deepEqual(current, migrationBefore.residents.find((row) => row.id === residentId));
  }
  const staffOwned = await scenario({ ownerRole: 'phn' });
  await rejectWithoutWrites(() => approve(staffOwned.requestId), '23514');
});

test('draft/rejected/resubmission/cancelled status and missing/rejected proof never move the resident; resubmit retains request identity', async () => {
  for (const status of ['draft', 'rejected', 'resubmission_required', 'cancelled']) {
    const request = await scenario({ status });
    const saved = await snapshot();
    assert.equal(await approve(request.requestId), null);
    assert.deepEqual(await snapshot(), saved);
  }
  const missing = await scenario({ proof: false });
  const beforeMissing = await snapshot();
  assert.equal(await approve(missing.requestId), null);
  assert.deepEqual(await snapshot(), beforeMissing);
  const proof = await scenario();
  await query("update public.documents set verification_status='rejected' where id=$1", [proof.proofId]);
  const beforeRejectedProof = await snapshot();
  assert.equal(await approve(proof.requestId), null);
  assert.deepEqual(await snapshot(), beforeRejectedProof);
  const resubmit = await scenario({ status: 'resubmission_required', ownerRole: 'resident-limited', ownerStatus: 'pending_verification' });
  await query("update public.transfer_requests set resubmission_instructions='Retained correction instructions',reviewed_by=$2 where id=$1", [resubmit.requestId, people.target]);
  const documents = await records('documents');
  await query("update public.transfer_requests set status='pending',resubmission_instructions='',submitted_at=now() where id=$1", [resubmit.requestId]);
  const result = await approve(resubmit.requestId);
  assert.equal(result.id, resubmit.requestId);
  assert.equal(result.status, 'approved');
  assert.deepEqual(await records('documents'), documents);
  const profile = (await query('select role,status,barangay_id from public.profiles where id=$1', [resubmit.owner]))[0];
  assert.deepEqual(profile, { role: 'resident-limited', status: 'pending_verification', barangay_id: ids.target });
  for (const actor of [people.phn, people.mho, people.admin]) {
    const municipal = await scenario({ status: 'under_review' });
    assert.equal((await approve(municipal.requestId, actor)).reviewed_by, actor);
  }
});

test('explicit canonical referral recipient/facility/one-recipient decisions survive transfer; obsolete community routing is not silently reassigned', async () => {
  const moving = await scenario();
  for (const permission of ['referrals.create', 'referrals.approve', 'referrals.status.update', 'referrals.assign']) {
    await query(`insert into public.role_permissions(role,permission_id,granted) values('health_supervisor',$1,true)
      on conflict(role,permission_id) do update set granted=true`, [permission]);
  }
  const createReferral = async (recipient, facility, role, station) => (await query(
    'select public.canonical_referral_write($1,null,$2,null,$3) as result', [people.source, 'create', JSON.stringify({
      resident_id: moving.residentId, recipient_personnel_id: recipient, recipient_facility_id: facility,
      recipient_role: role, recipient_station: station, reason: 'Explicit original referral reason',
    })]))[0].result;
  const rhu = await createReferral(people.triage, ids.rhu, 'rhu_personnel', 'triage');
  const community = await createReferral(people.source, ids.sourceBhs, 'health_supervisor', null).catch(async (error) => {
    assert.equal(error.code, '22023', 'sender cannot appoint themselves as the recipient');
    const recipient = await account('health_supervisor', ids.source);
    return createReferral(recipient, ids.sourceBhs, 'health_supervisor', null);
  });
  const stationRecipient = await account('health_supervisor', ids.third, ids.municipality, 'active', ids.rhu, ['consultation']);
  const station = await createReferral(stationRecipient, ids.rhu, 'health_supervisor', 'consultation');
  await query('select public.canonical_referral_write($1,$2,$3,$4,$5)',
    [stationRecipient, station.id, 'status', station.version, JSON.stringify({ status: 'Accepted' })]);
  await query(`insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,status,facility_id,referral_id)
    values('TRANSFER-EXPLICIT-RECEIVER',$1,$2,'health_supervisor','draft',$3,$4)`, [moving.residentId, stationRecipient, ids.rhu, station.id]);
  const stationBefore = (await query('select to_jsonb(h) as row from public.health_referrals h where id=$1', [station.id]))[0].row;
  await approve(moving.requestId);
  for (const original of [rhu, community, stationBefore]) {
    const current = (await query('select to_jsonb(h) as row from public.health_referrals h where id=$1', [original.id]))[0].row;
    assert.deepEqual(withoutScope(current), withoutScope(original));
  }
  assert.equal((await query('select public.canonical_referral_route_valid($1,$2,$3,$4,$5) as allowed',
    [moving.residentId, rhu.recipient_personnel_id, rhu.recipient_facility_id, rhu.recipient_role, rhu.recipient_station]))[0].allowed, true);
  assert.equal((await query('select public.canonical_referral_route_valid($1,$2,$3,$4,$5) as allowed',
    [moving.residentId, community.recipient_personnel_id, community.recipient_facility_id, community.recipient_role, community.recipient_station]))[0].allowed, false);
  for (const [referral, actor] of [[rhu, people.target], [community, community.recipient_personnel_id]]) {
    await rejectWithoutWrites(() => query('select public.canonical_referral_write($1,$2,$3,$4,$5)',
      [actor, referral.id, 'status', referral.version, JSON.stringify({ status: 'Accepted' })]), '42501');
  }
  const accepted = (await query('select public.canonical_referral_write($1,$2,$3,$4,$5) as row',
    [people.triage, rhu.id, 'status', rhu.version, JSON.stringify({ status: 'Accepted' })]))[0].row;
  assert.equal(accepted.recipient_personnel_id, people.triage);
  assert.equal(accepted.status, 'Accepted');
  await asClient('authenticated', stationRecipient, async () => {
    assert.equal((await query("select id from public.visits where id='TRANSFER-EXPLICIT-RECEIVER'")).length, 1,
      'the restrictive gate preserves the actual explicitly authorized RHU recipient');
    assert.equal((await query("select id from public.visits where id='TRANSFER-SOURCE-VISIT'")).length, 0,
      'an explicit referral is not a grant to unrelated encounters');
  });
});

test('migration replay preserves every row and privilege; new child writes derive current target despite supplied source scope', async () => {
  const saved = await snapshot();
  await db.exec(migrationSql);
  assert.deepEqual(await snapshot(), saved);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await query("select has_function_privilege($1,'public.approve_transfer_request(uuid,uuid)','EXECUTE') as allowed", [role]))[0].allowed, false);
  }
  assert.equal((await query("select has_function_privilege('service_role','public.approve_transfer_request(uuid,uuid)','EXECUTE') as allowed"))[0].allowed, true);
  const policies = await query(`select policyname,permissive from pg_policies where schemaname='public'
    and policyname in ('visits_current_resident_scope','visit_plans_current_resident_scope') order by policyname`);
  assert.equal(policies.length, 2);
  assert.ok(policies.every((policy) => policy.permissive === 'RESTRICTIVE'));
  for (const fn of ['visits_sync_scope', 'sync_operational_scope']) {
    const definition = (await query('select pg_get_functiondef($1::regprocedure) as definition', [`public.${fn}()`]))[0].definition;
    assert.match(definition, /for key share/i);
  }
  await query(`insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,status,municipality_id,barangay_id)
    values('TRANSFER-AFTER',$1,$2,'health_supervisor','completed',$3,$4)`, [main.residentId, people.target, ids.municipality, ids.source]);
  await query(`insert into public.follow_ups(resident_id,scheduled_date,purpose,municipality_id,barangay_id)
    values($1,'2026-12-03','Post-transfer plan',$2,$3)`, [main.residentId, ids.municipality, ids.source]);
  assert.equal((await query("select barangay_id from public.visits where id='TRANSFER-AFTER'"))[0].barangay_id, ids.target);
  assert.equal((await query("select barangay_id from public.follow_ups where purpose='Post-transfer plan'"))[0].barangay_id, ids.target);
});

test('a failure after resident/profile/clinical/household updates rolls the entire approval and audit back', async () => {
  const failing = await scenario();
  await query(`insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,status)
    values('TRANSFER-ROLLBACK-VISIT',$1,$2,'health_supervisor','completed')`, [failing.residentId, people.source]);
  await query(`insert into public.household_members(household_id,resident_id,name)
    values('TRANSFER-SOURCE-HH',$1,'Rollback census member')`, [failing.residentId]);
  await db.exec(`create function public.transfer_scope_test_reject_audit() returns trigger language plpgsql as $$
    begin raise exception using errcode='P0001',message='Injected local audit failure'; end; $$;
    create trigger transfer_scope_test_reject_audit before insert on public.transfer_request_audit_logs
    for each row when (new.transfer_request_id='${failing.requestId}'::uuid)
    execute function public.transfer_scope_test_reject_audit();`);
  await rejectWithoutWrites(() => approve(failing.requestId), 'P0001');
});

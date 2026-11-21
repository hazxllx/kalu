import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { getRecentActivities } from '../src/services/recentActivities.service.js';

const db = new PGlite({ extensions: { pgcrypto } });
const migrations = new URL('../../supabase/migrations/', import.meta.url);
const ids = Object.fromEntries(['municipality', 'foreignMunicipality', 'primary', 'secondary', 'foreign'].map((key) => [key, randomUUID()]));
const actors = {};
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const rejects = async (run, expected) => {
  await db.exec('savepoint expected_error');
  try { await assert.rejects(run, expected); }
  finally { await db.exec('rollback to savepoint expected_error'); }
};
const feed = async (actor = actors.supervisor, barangay = null) =>
  (await query('select public.scoped_recent_monitoring_activities($1,$2) as result', [actor, barangay]))[0].result.activities;
const time = (hour) => `2026-11-20T${String(hour).padStart(2, '0')}:00:00Z`;
const audit = async (action, entityType, entityId, at, barangay = ids.primary, municipality = ids.municipality) => {
  await query(`insert into public.health_audit_logs(action,entity_type,entity_id,created_at,municipality_id,barangay_id,metadata)
    values($1,$2,$3,$4,$5,$6,'{"notes":"PRIVATE NOTE","name":"PRIVATE PERSON"}')`,
  [action, entityType, entityId, at, municipality, barangay]);
};
const visit = async (id, resident = 'PRIVATE-primary', at = time(1), details = {}) => {
  await query(`insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,created_at,updated_at,visit_date,
    consultation_details,municipality_id,barangay_id,chief_complaint,phn_notes)
    values($1,$2,$3,'phn',$4,'2026-12-01','2026-12-02',$5,$6,$7,'PRIVATE COMPLAINT','PRIVATE NOTES')`,
  [id, resident, actors.phn, at, JSON.stringify(details), ids.municipality, ids.primary]);
};
const followup = async (resident = 'PRIVATE-primary', at = time(2), completed = null) => (await query(`
  insert into public.follow_ups(resident_id,scheduled_date,created_at,completed_at,status,notes,municipality_id,barangay_id)
  values($1,'2026-11-20',$2,$3,$4,'PRIVATE NOTES',$5,$6) returning id`,
[resident, at, completed, completed ? 'Completed' : 'Scheduled', ids.municipality, ids.primary]))[0].id;
const referral = async (resident = 'PRIVATE-primary') => (await query(`insert into public.health_referrals
  (resident_id,municipality_id,barangay_id,created_at,reason) values($1,$2,$3,'2026-01-01','PRIVATE REASON') returning id`,
[resident, ids.municipality, ids.primary]))[0].id;
const history = async (id, version, action, status, at, previous = null) => query(`insert into public.health_referral_history
  (referral_id,version,action,new_status,previous_status,created_at,actor_name,explanation,metadata)
  values($1,$2,$3,$4,$5,$6,'PRIVATE ACTOR','PRIVATE EXPLANATION','{"patient":"PRIVATE"}')`,
[id, version, action, status, previous, at]);
const householdVisit = async (household = 'PRIVATE-HH-primary', at = time(1), recorder = actors.supervisor, reason = 'Monitoring') =>
  (await query(`insert into public.household_visits(household_id,visit_number,visit_date,recorded_by,request_id,created_at,visit_reason,profile_snapshot)
    values($1,(select coalesce(max(visit_number),0)+1 from public.household_visits where household_id=$1),
      '2026-11-01',$2,$3,$4,$5,'{"name":"PRIVATE SNAPSHOT"}') returning id`,
  [household, recorder, randomUUID(), at, reason]))[0].id;
const PROGRAMS = [
  ['NCD-RISK', 'ncd_risk_assessments'], ['NCD-CERVICAL', 'ncd_cervical_breast'],
  ['NCD-VISUAL', 'ncd_visual_ppv'], ['ORAL-HEALTH', 'oral_health_records'], ['ENVIRONMENTAL', 'environmental_masterlist'],
];
const form = async (table, name = 'primary') => (await query(`insert into public.${table}
  (${table === 'environmental_masterlist' ? 'household_id' : 'resident_id'},created_at,updated_at,data,municipality_id,barangay_id)
  values($1,$2,$3,'{"notes":"PRIVATE FORM","name":"PRIVATE NAME"}',$4,$5) returning id`,
[`PRIVATE-${table === 'environmental_masterlist' ? 'HH-' : ''}${name}`, time(1), time(23), ids.municipality, ids.primary]))[0].id;

before(async () => {
  // Platform stubs only; all application objects come from real migrations.
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
  // Keep unrelated in-progress personnel migrations out of this source fixture.
  // Apply the established chain plus the actual append-only history dependency.
  const files = (await readdir(migrations)).filter((name) => name.endsWith('.sql') && (
    name <= '20261120130000_health_trends_visit_date_source_fix.sql'
    || name === '20261120190000_clinical_assessment_protocols.sql'
    || name === '20261121110000_recent_monitoring_activities.sql'
  )).sort();
  for (const file of files) {
    try { await db.exec(await readFile(new URL(file, migrations), 'utf8')); }
    catch (error) { throw new Error(`Migration ${file}: ${error.message}`); }
  }
  await query(`insert into public.municipalities(id,name) values($1,'Monitoring Municipality'),($2,'Foreign Municipality')`,
    [ids.municipality, ids.foreignMunicipality]);
  await query(`insert into public.barangays(id,municipality_id,name) values
    ($1,$2,'San Antonio'),($3,$2,'San Isidro'),($4,$5,'San Antonio')`,
  [ids.primary, ids.municipality, ids.secondary, ids.foreign, ids.foreignMunicipality]);
  for (const [name, role, barangay, municipality] of [
    ['supervisor', 'health_supervisor', ids.primary, ids.municipality],
    ['secondary', 'health_supervisor', ids.secondary, ids.municipality],
    ['foreign', 'health_supervisor', ids.foreign, ids.foreignMunicipality],
    ['mho', 'mho', null, ids.municipality], ['phn', 'phn', null, ids.municipality], ['bhw', 'bhw', ids.primary, ids.municipality],
  ]) {
    const id = randomUUID();
    await query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.test`]);
    await query('update public.profiles set role=$2,status=\'active\',municipality_id=$3,barangay_id=$4 where id=$1', [id, role, municipality, barangay]);
    actors[name] = id;
  }
  await db.exec(`insert into public.role_permissions(role,permission_id,granted) values
    ('mho','reports.analytics.view',true),('phn','reports.analytics.view',true),('health_supervisor','reports.analytics.view',true)
    on conflict(role,permission_id) do update set granted=excluded.granted;`);
  await db.exec('begin; set local session_replication_role=replica;');
  for (const [name, barangay, municipality] of [['primary', ids.primary, ids.municipality],
    ['secondary', ids.secondary, ids.municipality], ['foreign', ids.foreign, ids.foreignMunicipality]]) {
    await query(`insert into public.residents(id,health_record_no,first_name,last_name,cellphone_no,municipality_id,barangay_id,created_at)
      values($1,$2,'PRIVATE FIRST','PRIVATE LAST','09171234567',$3,$4,'2026-01-01')`,
    [`PRIVATE-${name}`, `PRIVATE-HR-${name}`, municipality, barangay]);
    await query(`insert into public.households(id,head_name,municipality_id,barangay_id) values($1,'PRIVATE HEAD',$2,$3)`,
      [`PRIVATE-HH-${name}`, municipality, barangay]);
  }
  await db.exec('commit;');
}, { timeout: 120000 });
beforeEach(async () => { await db.exec('begin; set local session_replication_role=replica;'); });
afterEach(async () => { await db.exec('rollback;'); await db.exec('reset role;'); });
after(async () => { await db.close(); });

test('every linked source follows current resident scope even with stale in-scope snapshots; audit also requires its own scope', async () => {
  for (const name of ['secondary', 'foreign']) {
    const resident = `PRIVATE-${name}`;
    await visit(`PRIVATE-VISIT-${name}`, resident, time(10), {
      clinicalAssessmentHistory: [{ assessedAt: time(11), status: 'assessed', inputs: { name: 'PRIVATE' } }],
    });
    await followup(resident, time(12), time(13));
    const ref = await referral(resident);
    await history(ref, 1, 'Created', 'Pending', time(14));
    const tcl = (await query(`insert into public.tcl_entries(resident_id,program) values($1,'PRIVATE PROGRAM') returning id`, [resident]))[0].id;
    const immunization = (await query(`insert into public.immunizations(resident_id,vaccine) values($1,'PRIVATE VACCINE') returning id`, [resident]))[0].id;
    await audit('TCL_CREATED', 'tcl_entries', tcl, time(15));
    await audit('IMMUNIZATIONS_CREATED', 'immunizations', immunization, time(16));
    await audit('HOUSEHOLD_MEMBER_HEALTH_UPDATED', 'households', `PRIVATE-HH-${name}`, time(17));
    await householdVisit(`PRIVATE-HH-${name}`, time(18));
  }
  await audit('HOUSEHOLD_MEMBER_HEALTH_UPDATED', 'households', 'PRIVATE-HH-primary', time(18), ids.secondary);
  await audit('HOUSEHOLD_MEMBER_HEALTH_UPDATED', 'households', 'PRIVATE-HH-primary', time(19), ids.primary, ids.foreignMunicipality);
  assert.deepEqual((await feed()).map((event) => event.kind), ['resident_created']);
  assert.ok((await feed(actors.secondary)).some((event) => event.kind === 'follow_up_completed'));
  assert.ok((await feed(actors.foreign)).some((event) => event.kind === 'referral_created'));
  assert.equal((await feed(actors.mho)).filter((event) => event.kind === 'household_visit_created').length, 1);
  // Moving a resident immediately removes their prior events from the old scope.
  await visit('PRIVATE-MOVED');
  await query('update public.residents set barangay_id=$1 where id=$2', [ids.secondary, 'PRIVATE-primary']);
  assert.deepEqual(await feed(), []);
});

test('administrative household review and invented update actions are excluded; exact health record update audits are included', async () => {
  for (const action of ['HOUSEHOLD_CREATED', 'HOUSEHOLD_SUBMITTED', 'HOUSEHOLD_RESUBMITTED', 'HOUSEHOLD_VERIFIED', 'HOUSEHOLD_RETURNED']) {
    await audit(action, 'households', 'PRIVATE-HH-primary', time(23));
  }
  await audit('HOUSEHOLD_MEMBER_HEALTH_UPDATED', 'households', 'PRIVATE-HH-primary', time(1));
  for (const action of ['MATERNAL_UPDATED', 'ACCOUNT_CREATED', 'RESIDENT_UPDATED', 'CONSULTATION_UPDATED', 'HOUSEHOLD_VERIFIED_EXTRA', 'VISIT_CREATED', 'FOLLOWUPS_UPDATED', 'REFERRAL_STATUS']) {
    await audit(action, 'households', 'PRIVATE-HH-primary', time(22));
  }
  await audit('HOUSEHOLD_MEMBER_HEALTH_UPDATED', 'residents', 'PRIVATE-primary', time(22));
  await audit('HOUSEHOLD_MEMBER_HEALTH_UPDATED', 'households', 'PRIVATE-MISSING', time(22));
  const events = await feed();
  assert.deepEqual(events.map((event) => event.kind), ['record_updated', 'resident_created']);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|metadata|entity|actor|notes|href/);
});

test('real TCL and immunization creation and update audit actions use their current linked residents', async () => {
  const tcl = (await query(`insert into public.tcl_entries(resident_id,program) values('PRIVATE-primary','PRIVATE') returning id`))[0].id;
  const immunization = (await query(`insert into public.immunizations(resident_id,vaccine) values('PRIVATE-primary','PRIVATE') returning id`))[0].id;
  await audit('TCL_CREATED', 'tcl_entries', tcl, time(1));
  await audit('IMMUNIZATIONS_CREATED', 'immunizations', immunization, time(2));
  await audit('TCL_UPDATED', 'tcl_entries', tcl, time(3));
  await audit('IMMUNIZATIONS_UPDATED', 'immunizations', immunization, time(4));
  assert.deepEqual((await feed()).map((event) => event.kind), ['record_updated', 'record_updated', 'immunization_created', 'tcl_created', 'resident_created']);
});

test('household visits use actual recorded creation, exclude imported dates/review visits, and preserve scoped deterministic deduplication', async () => {
  const first = await householdVisit();
  await householdVisit('PRIVATE-HH-primary', time(2), actors.supervisor, 'Follow-up');
  await householdVisit('PRIVATE-HH-primary', time(23), null);
  await householdVisit('PRIVATE-HH-primary', time(23), actors.supervisor, 'Verification');
  await audit('HOUSEHOLD_VISIT_CREATED', 'household_visits', first, time(23));
  const events = await feed();
  assert.deepEqual(events.map((event) => event.kind), ['household_visit_created', 'household_visit_created', 'resident_created']);
  assert.deepEqual(events.slice(0, 2).map((event) => new Date(event.occurredAt).getUTCHours()), [2, 1]);
  assert.deepEqual(await feed(), events);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|profile_snapshot|recorded_by/);
  await query("update public.households set barangay_id=$1,head_name='PRIVATE MOVED HEAD' where id=$2", [ids.secondary, 'PRIVATE-HH-primary']);
  assert.deepEqual((await feed()).map((event) => event.kind), ['resident_created']);
});

test('program form creation and updates use exact existing hyphenated action/entity pairs and their audit timestamps only', async () => {
  for (const [action, table] of PROGRAMS) {
    await db.exec('savepoint program');
    const id = await form(table);
    assert.deepEqual((await feed()).map((event) => event.kind), ['resident_created'], `${table} row timestamps are not events`);
    await audit(`${action}_CREATED`, table, id, time(2));
    await audit(`${action}_UPDATED`, table, id, time(3));
    await audit(`${action}_DELETED`, table, id, time(23));
    await audit(`${action.replaceAll('-', '_')}_UPDATED_EXTRA`, table, id, time(23));
    await audit(`${action}_UPDATED`, 'residents', 'PRIVATE-primary', time(23));
    const events = await feed();
    assert.deepEqual(events.map((event) => event.kind), ['assessment_form_updated', 'assessment_form_created', 'resident_created'], table);
    assert.deepEqual(events.slice(0, 2).map((event) => new Date(event.occurredAt).getUTCHours()), [3, 2]);
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE|metadata|data|notes|href|target/);
    await db.exec('rollback to savepoint program');
  }
});

test('all program form audit sources honor current linked resident/household scope and the audit snapshot scope', async () => {
  for (const [action, table] of PROGRAMS) {
    for (const name of ['secondary', 'foreign']) {
      const id = await form(table, name);
      await audit(`${action}_CREATED`, table, id, time(2));
      await audit(`${action}_UPDATED`, table, id, time(3));
    }
    const id = await form(table);
    await audit(`${action}_CREATED`, table, id, time(23), ids.secondary);
    await audit(`${action}_UPDATED`, table, id, time(23), ids.primary, ids.foreignMunicipality);
  }
  assert.deepEqual((await feed()).map((event) => event.kind), ['resident_created']);
  // Correctly scoped audit snapshots permit real events in the second barangay.
  const id = await form('ncd_risk_assessments', 'secondary');
  await audit('NCD-RISK_UPDATED', 'ncd_risk_assessments', id, time(4), ids.secondary);
  assert.equal((await feed(actors.secondary))[0].kind, 'assessment_form_updated');
  await query('update public.residents set barangay_id=$1 where id=$2', [ids.primary, 'PRIVATE-secondary']);
  assert.equal((await feed(actors.secondary)).some((event) => event.kind === 'assessment_form_updated'), false);
});

test('latest five are globally ordered with deterministic ties and retain distinct same-time records', async () => {
  await visit('PRIVATE-A', 'PRIVATE-primary', time(1));
  await visit('PRIVATE-B', 'PRIVATE-primary', time(1));
  const ref = await referral();
  await history(ref, 1, 'Created', 'Pending', time(2));
  await history(ref, 2, 'Status', 'Accepted', time(3), 'Pending');
  await history(ref, 3, 'Encounter', 'Completed', time(4), 'In Progress');
  await followup('PRIVATE-primary', time(4), time(5));
  const events = await feed();
  assert.equal(events.length, 5);
  assert.deepEqual(events.map((event) => event.kind), ['follow_up_completed', 'follow_up_created', 'referral_status_changed', 'referral_status_changed', 'referral_created']);
  assert.deepEqual(await feed(), events);
  assert.deepEqual(events.map((event) => new Date(event.occurredAt).getUTCHours()), [5, 4, 4, 3, 2]);
  await query('delete from public.health_referral_history');
  await query('delete from public.follow_ups');
  assert.equal((await feed()).filter((event) => event.kind === 'visit_created').length, 2);
});

test('ordering preserves PostgreSQL microseconds and opaque event identities are unique and stable', async () => {
  await visit('PRIVATE-A', 'PRIVATE-primary', '2026-11-20T01:00:00.000001Z');
  await visit('PRIVATE-Z', 'PRIVATE-primary', '2026-11-20T01:00:00.000002Z');
  const events = await feed();
  assert.match(events[0].occurredAt, /\.000002/);
  assert.match(events[1].occurredAt, /\.000001/);
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
  assert.ok(events.every((event) => /^[a-f0-9]{32}$/.test(event.id)));
  assert.deepEqual(await feed(), events);
});

test('canonical referral history wins over audits/legacy/current timestamps, skips inferred imports, no-op status and invalid legacy links', async () => {
  const ref = await referral();
  await history(ref, 1, 'Created', 'Pending', time(1));
  await audit('REFERRAL_CREATED', 'health_referrals', ref, time(1));
  await history(ref, 2, 'Imported', 'Completed', time(23));
  await history(ref, 3, 'Status', 'Pending', time(23), 'Pending');
  await history(ref, 4, 'Snapshots', 'Pending', time(23));
  await query(`update public.health_referrals set updated_at=$1,completed_at=$1 where id=$2`, [time(23), ref]);
  assert.deepEqual((await feed()).map((event) => event.kind), ['referral_created', 'resident_created']);
  await query(`insert into public.health_referral_legacy_map(legacy_referral_id,health_referral_id,legacy_snapshot,source_visit_matches_resident)
    values('PRIVATE-LEGACY',$1,'{}',false)`, [ref]);
  assert.deepEqual((await feed()).map((event) => event.kind), ['resident_created']);
});

test('visit creation and append-only assessment timestamps are canonical, duplicated history is not duplicated, malformed JSON is safe', async () => {
  const assessment = { assessedAt: time(3), assessedBy: actors.phn, status: 'assessed', notes: 'PRIVATE' };
  await visit('PRIVATE-ASSESSMENT', 'PRIVATE-primary', time(2), {
    clinicalAssessment: { ...assessment, assessedAt: time(23) },
    clinicalAssessmentHistory: [assessment, assessment, { assessedAt: '2026-02-30T00:00:00Z', status: 'assessed' },
      { assessedAt: '2026-11-21T00:00:00+99:99', status: 'assessed' }, { assessedAt: 'infinity', status: 'assessed' },
      { assessedAt: time(23), status: 'PRIVATE' }, { status: 'assessed' }, null],
  });
  await visit('PRIVATE-MALFORMED', 'PRIVATE-primary', time(1), { clinicalAssessmentHistory: {} });
  const events = await feed();
  assert.deepEqual(events.map((event) => event.kind), ['assessment_recorded', 'visit_created', 'visit_created', 'resident_created']);
  assert.equal(new Date(events[0].occurredAt).getUTCHours(), 3);
  assert.equal(new Date(events[1].occurredAt).getUTCHours(), 2);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|assessedBy|notes|inputs/);
});

test('follow-up creation and completed_at produce one event each without audit duplication or inferred updated_at completion', async () => {
  const id = await followup('PRIVATE-primary', time(1), time(2));
  await audit('FOLLOWUPS_CREATED', 'follow_ups', id, time(1));
  await audit('FOLLOWUPS_UPDATED', 'follow_ups', id, time(2));
  await followup('PRIVATE-primary', time(3));
  await query(`update public.follow_ups set status='Completed',updated_at=$1 where completed_at is null`, [time(23)]);
  assert.deepEqual((await feed()).map((event) => event.kind), ['follow_up_created', 'follow_up_completed', 'follow_up_created', 'resident_created']);
});

test('follow-up scheduled events require a finite actual schedule and exclude unconfirmed requests and cancelled records', async () => {
  for (const patch of ["scheduled_date='infinity'", "status='Pending'", "status='Cancelled'",
    "requires_resident_response=true,resident_decision='pending'", "requires_resident_response=true,resident_decision=null"]) {
    const id = await followup();
    await query(`update public.follow_ups set ${patch} where id=$1`, [id]);
  }
  // Legacy nullable data is exercised without relaxing the real application schema.
  await db.exec('alter table public.follow_ups alter column scheduled_date drop not null;');
  const missing = await followup();
  await query('update public.follow_ups set scheduled_date=null where id=$1', [missing]);
  assert.deepEqual((await feed()).map((event) => event.kind), ['resident_created']);
  const approved = await followup();
  await query("update public.follow_ups set requires_resident_response=true,resident_decision='approved' where id=$1", [approved]);
  assert.deepEqual((await feed()).map((event) => event.kind), ['follow_up_created', 'resident_created']);
});

test('safe existing UI targets require both current scope and the dedicated record-read permission', async () => {
  await householdVisit();
  const followUpId = await followup('PRIVATE-primary', time(2));
  const referralId = await referral();
  await history(referralId, 1, 'Created', 'Pending', time(3));
  assert.equal((await feed()).some((event) => 'target' in event), false);
  for (const permission of ['households.view', 'followups.view', 'referrals.history.view']) {
    await query(`insert into public.role_permissions(role,permission_id,granted) values('health_supervisor',$1,true)
      on conflict(role,permission_id) do update set granted=true`, [permission]);
  }
  const events = await feed();
  assert.deepEqual(events.filter((event) => event.target).map((event) => event.target), [
    { type: 'referral', id: referralId }, { type: 'follow_up', id: followUpId }, { type: 'household', id: 'PRIVATE-HH-primary' },
  ]);
  // Municipality analytics readers do not receive supervisor-specific UI targets.
  assert.equal((await feed(actors.mho)).some((event) => 'target' in event), false);
  await db.exec("update public.role_permissions set granted=false where role='health_supervisor' and permission_id='followups.view'");
  assert.equal((await feed()).find((event) => event.kind === 'follow_up_created').target, undefined);
  await query('update public.residents set barangay_id=$1 where id=$2', [ids.secondary, 'PRIVATE-primary']);
  assert.equal((await feed()).some((event) => event.target?.type === 'referral' || event.target?.type === 'follow_up'), false);
});

test('service and real migration together expose only fixed, privacy-safe API fields', async () => {
  await visit('PRIVATE-SERVICE');
  const result = await getRecentActivities({ actorId: actors.supervisor, municipalityId: ids.foreignMunicipality }, {
    repo: { driver: 'supabase' }, rpc: async (name, params) => {
      assert.equal(name, 'scoped_recent_monitoring_activities');
      return { data: { activities: await feed(params.p_actor_id, params.p_barangay) } };
    },
  });
  assert.equal(result.activities[0].title, 'Visit recorded');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|residentId|recordReference|href|metadata|notes/);
  for (const event of result.activities) assert.deepEqual(Object.keys(event).sort(), ['description', 'id', 'kind', 'occurredAt', 'title']);
});

test('database independently derives assignment and rejects cross-barangay filters and unauthorized actors', async () => {
  await rejects(() => feed(actors.supervisor, 'San Isidro'), { code: '42501' });
  await rejects(() => feed(actors.supervisor, ids.secondary), { code: '42501' });
  assert.deepEqual(await feed(actors.supervisor, ids.primary), await feed());
  assert.deepEqual(await feed(actors.mho, 'San Isidro'), await feed(actors.secondary));
  await rejects(() => feed(actors.bhw), { code: '42501' });
  await rejects(() => feed(randomUUID()), { code: '42501' });
  await rejects(() => feed(null), { code: '42501' });
  await rejects(() => feed(actors.mho, 'Unknown'), { code: '22023' });
  await query(`update public.profiles set status='disabled' where id=$1`, [actors.supervisor]);
  await rejects(() => feed(), { code: '42501' });
});

test('managed personnel approval, setup, suspension and analytics permission are enforced again in SQL', async () => {
  await query(`insert into public.personnel_accounts(account_id,approval_status,setup_required) values($1,'approved',false)
    on conflict(account_id) do update set approval_status='approved',setup_required=false,suspended_at=null`, [actors.supervisor]);
  assert.equal((await feed()).length, 1);
  for (const patch of ["approval_status='pending'", "approval_status='rejected'", 'setup_required=true', 'suspended_at=now()']) {
    await query(`update public.personnel_accounts set ${patch} where account_id=$1`, [actors.supervisor]);
    await rejects(() => feed(), { code: '42501' });
    await query(`update public.personnel_accounts set approval_status='approved',setup_required=false,suspended_at=null where account_id=$1`, [actors.supervisor]);
  }
  await db.exec(`update public.role_permissions set granted=false where role='health_supervisor' and permission_id='reports.analytics.view'`);
  await rejects(() => feed(), { code: '42501' });
});

test('inactive, missing, unapproved or cross-municipality assignments fail closed; empty authorized scope returns an empty array', async () => {
  for (const sql of [
    `update public.profiles set barangay_id=null where id='${actors.supervisor}'`,
    `update public.profiles set barangay_id='${ids.foreign}' where id='${actors.supervisor}'`,
    `update public.barangays set status='Inactive' where id='${ids.primary}'`,
    `update public.barangays set name='Unapproved' where id='${ids.primary}'`,
    `update public.municipalities set is_active=false where id='${ids.municipality}'`,
  ]) {
    await db.exec('savepoint assignment');
    await db.exec(sql);
    await rejects(() => feed(), { code: '42501' });
    await db.exec('rollback to savepoint assignment');
  }
  await query('delete from public.residents where id=$1', ['PRIVATE-primary']);
  assert.deepEqual(await feed(), []);
});

test('migration grants only service_role execution and runtime guard rejects a forged trusted actor under other JWT roles', async () => {
  for (const role of ['anon', 'authenticated']) {
    const privileges = (await query(`select has_function_privilege($1,'public.scoped_recent_monitoring_activities(uuid,text)','execute') as rpc,
      has_function_privilege($1,'public.monitoring_activity_timestamp(text)','execute') as helper`, [role]))[0];
    assert.deepEqual(privileges, { rpc: false, helper: false });
    await db.exec(`set role ${role}`);
    await rejects(() => feed(), { code: '42501' });
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.equal((await feed()).length, 1);
  await db.exec('reset role');
  for (const role of ['anon', 'authenticated', '']) {
    await query("select set_config('request.jwt.claim.role',$1,true)", [role]);
    await rejects(() => feed(), { code: '42501' });
  }
});

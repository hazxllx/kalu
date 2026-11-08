import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Real migrations/RPCs/RLS, isolated in local PostgreSQL. No project credentials,
// remote database, production migration, email or network requests are used.
const db = new PGlite({ extensions: { pgcrypto } });
const migrations = new URL('../../supabase/migrations/', import.meta.url);
const candidate = '20261106010000_canonical_referral_recipients.sql';
const ids = Object.fromEntries(['municipality', 'otherMunicipality', 'barangay', 'otherBarangay', 'outsideBarangay', 'legacyBarangay', 'rhu', 'otherRhu', 'outsideRhu', 'bhs', 'otherBhs', 'existingReferral'].map((key) => [key, randomUUID()]));
const people = {};
let migrationSql;
let originalLegacy;
let originalVisits;
let originalCanonical;
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const rpc = async (name, params) => (await query(`select public.${name}(${params.map((_, i) => `$${i + 1}`).join(',')}) as result`, params))[0].result;
const write = (actor, id, action, version, record) => rpc('canonical_referral_write', [actor, id, action, version, JSON.stringify(record)]);
const row = async (id) => (await query('select to_jsonb(h) as record from public.health_referrals h where id = $1', [id]))[0]?.record;
const history = (id) => query('select * from public.health_referral_history where referral_id = $1 order by version', [id]);
const notifications = (id) => query('select * from public.notifications where related_type = $1 and related_id = $2 order by created_at,id', ['health_referrals', id]);
const route = (recipient = people.triage, facility = ids.rhu, role = 'rhu_personnel', station = 'triage') => ({
  resident_id: 'RES-CANONICAL', recipient_personnel_id: recipient, recipient_facility_id: facility,
  recipient_role: role, recipient_station: station, reason: 'Private clinical reason', chief_complaints: 'Private clinical complaint',
});
const create = (patch = {}) => write(people.sender, null, 'create', null, { ...route(), ...patch });
const change = (referral, status, actor = people.triage, notes = '') => write(actor, referral.id, 'status', referral.version, { status, resolution_notes: notes });
const asClient = async (id, role, run) => {
  await query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [id || '', role]);
  await db.exec(`set role ${role}`);
  try { return await run(); }
  finally {
    await db.exec('reset role');
    await query("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'service_role', false)");
  }
};
const account = async (name, role, { municipality = ids.municipality, barangay = null, facility = null, stations = [], status = 'active' } = {}) => {
  const id = randomUUID();
  await query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)', [id, `${id}@example.test`, JSON.stringify({ full_name: name })]);
  await query('update public.profiles set role=$2,status=$3,municipality_id=$4,barangay_id=$5,facility_id=$6,rhu_stations=$7 where id=$1', [id, role, status, municipality, barangay, facility, stations]);
  people[name] = id;
  return id;
};

const seed = async () => {
  await query('insert into public.municipalities(id,name) values ($1,$2),($3,$4)', [ids.municipality, 'Pili', ids.otherMunicipality, 'Outside Municipality']);
  await query('insert into public.barangays(id,municipality_id,name) values ($1,$2,$3),($4,$2,$5),($6,$7,$3),($8,$2,$9)', [ids.barangay, ids.municipality, 'San Antonio', ids.otherBarangay, 'San Isidro', ids.outsideBarangay, ids.otherMunicipality, ids.legacyBarangay, 'Historical Barangay']);
  for (const [id, municipality, barangay, name, type] of [
    [ids.rhu, ids.municipality, null, 'Pili RHU', 'rhu'],
    [ids.otherRhu, ids.municipality, null, 'Other Pili RHU', 'rhu'],
    [ids.outsideRhu, ids.otherMunicipality, null, 'Outside RHU', 'rhu'],
    [ids.bhs, ids.municipality, ids.barangay, 'San Antonio BHS', 'barangay_health_station'],
    [ids.otherBhs, ids.municipality, ids.otherBarangay, 'San Isidro BHS', 'barangay_health_station'],
  ]) await query('insert into public.facilities(id,municipality_id,barangay_id,name,type) values ($1,$2,$3,$4,$5)', [id, municipality, barangay, name, type]);
  await account('sender', 'health_supervisor', { barangay: ids.barangay, facility: ids.bhs });
  await account('phn', 'phn', { facility: ids.rhu });
  await account('mho', 'mho');
  await account('admin', 'admin');
  await account('triage', 'rhu_personnel', { facility: ids.rhu, stations: ['triage'] });
  await account('peerTriage', 'rhu_personnel', { facility: ids.rhu, stations: ['triage'] });
  await account('consultation', 'rhu_personnel', { facility: ids.rhu, stations: ['consultation'] });
  await account('otherFacility', 'rhu_personnel', { facility: ids.otherRhu, stations: ['triage'] });
  await account('outside', 'rhu_personnel', { municipality: ids.otherMunicipality, facility: ids.outsideRhu, stations: ['triage'] });
  await account('stationMidwife', 'health_supervisor', { barangay: ids.otherBarangay, facility: ids.rhu, stations: ['consultation'] });
  await account('communityMidwife', 'health_supervisor', { barangay: ids.barangay, facility: ids.bhs });
  await account('otherMidwife', 'health_supervisor', { barangay: ids.otherBarangay, facility: ids.otherBhs });
  await account('bhw', 'bhw', { barangay: ids.barangay });
  await account('disabled', 'rhu_personnel', { facility: ids.rhu, stations: ['triage'], status: 'disabled' });
  await account('pending', 'rhu_personnel', { facility: ids.rhu, stations: ['triage'], status: 'pending_verification' });
  await account('resident', 'resident', { barangay: ids.barangay, status: 'pending_verification' });
  await query("insert into public.residents(id,health_record_no,first_name,last_name,barangay_id,auth_user_id) values ('RES-CANONICAL','HR-CANONICAL','Private','Resident',$1,$2),('RES-OTHER','HR-OTHER','Other','Resident',$3,null),('RES-HISTORY','HR-HISTORY','Historic','Resident',$4,null)", [ids.barangay, people.resident, ids.otherBarangay, ids.legacyBarangay]);
  for (const [id, resident] of [['SOURCE-LEGACY', 'RES-CANONICAL'], ['SOURCE-EXISTING', 'RES-CANONICAL'], ['SOURCE-MISSING-ACTOR', 'RES-CANONICAL'], ['SOURCE-HISTORY', 'RES-HISTORY'], ['SOURCE-OTHER', 'RES-OTHER'], ['SOURCE-NEW', 'RES-CANONICAL']]) {
    await query("insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,status,facility_id,chief_complaint,findings,treatment_given) values ($1,$2,$3,'phn','in_review',$4,'Frozen complaint','Frozen findings','Frozen treatment')", [id, resident, people.phn, ids.rhu]);
  }
  await query("insert into public.health_referrals(id,resident_id,treatment_visit_id,created_by,reason,destination_facility,chief_complaints) values ($1,'RES-CANONICAL','SOURCE-EXISTING',$2,'Existing canonical edits','Existing facility','Keep canonical clinical data')", [ids.existingReferral, people.phn]);
  for (const [id, source, resident, creator] of [
    ['REF-HISTORICAL-1', 'SOURCE-LEGACY', 'RES-CANONICAL', people.phn],
    ['REF-HISTORICAL-2', 'SOURCE-EXISTING', 'RES-CANONICAL', people.phn],
    ['REF-HISTORICAL-3', 'SOURCE-MISSING-ACTOR', 'RES-CANONICAL', 'old-deleted-identity'],
    ['REF-HISTORICAL-4', 'SOURCE-HISTORY', 'RES-HISTORY', people.phn],
    ['REF-HISTORICAL-5', 'SOURCE-OTHER', 'RES-CANONICAL', people.phn],
  ]) {
    await query("insert into public.referrals(id,resident_id,visit_id,created_by_id,referring_facility,receiving_facility,receiving_personnel,reason_for_referral,patient_snapshot,visit_snapshot,status_history,created_at,referral_date) values ($1,$2,$3,$4,'Original referring facility','Original receiving facility','Historical free-text person','Original reason',$5,$6,$7,'2025-07-01T00:00:00Z','2025-07-01T00:00:00Z')", [id, resident, source, creator, JSON.stringify({ firstName: 'Frozen name', privateValue: id }), JSON.stringify({ id: source, findings: 'Frozen findings' }), JSON.stringify([{ status: 'referred', at: '2025-07-01T00:00:00Z', notes: 'Original history' }])]);
  }
  await db.exec('create table public.referral_archive_fk(id text primary key, referral_id text references public.referrals(id) on delete restrict)');
  await query('insert into public.referral_archive_fk(id,referral_id) values ($1,$2)', ['archive-1', 'REF-HISTORICAL-1']);
  await query("insert into public.role_permissions(role,permission_id,granted) values ('rhu_personnel','referrals.view',true),('rhu_personnel','referrals.approve',false)");
};

before(async () => {
  await db.exec(`
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
    if (file === '20261031000000_restrict_barangays_to_approved_list.sql') await seed();
    try { await db.exec(await readFile(new URL(file, migrations), 'utf8')); }
    catch (error) { throw new Error(`Baseline ${file}: ${error.message}`, { cause: error }); }
  }
  // Baseline resident/account migrations configure only some HS permissions.
  // Model an administrator-authorized referral sender without changing rollout
  // behavior or silently granting missing permissions in production.
  for (const permission of ['referrals.view', 'referrals.create', 'referrals.assign', 'referrals.approve', 'referrals.reject', 'referrals.status.update', 'referrals.history.view']) {
    await query("insert into public.role_permissions(role,permission_id,granted) values ('health_supervisor',$1,true) on conflict (role,permission_id) do nothing", [permission]);
  }
  originalLegacy = await query('select to_jsonb(r) as record from public.referrals r order by id');
  originalVisits = await query('select to_jsonb(v) as record from public.visits v order by id');
  originalCanonical = await row(ids.existingReferral);
  migrationSql = await readFile(new URL(candidate, migrations), 'utf8');
  await db.exec(migrationSql);
}, { timeout: 120000 });
after(async () => { await db.close(); });

test('additive historical mapping preserves original IDs, snapshots, history, FKs and source/encounter semantics without duplicates', async () => {
  assert.deepEqual(await query('select to_jsonb(r) as record from public.referrals r order by id'), originalLegacy);
  assert.deepEqual(await query('select to_jsonb(v) as record from public.visits v order by id'), originalVisits);
  const mapping = await query('select * from public.health_referral_legacy_map order by legacy_referral_id');
  assert.equal(mapping.length, 5);
  assert.equal((await query('select count(*)::int count from public.health_referrals'))[0].count, 5);
  assert.equal(mapping[1].health_referral_id, ids.existingReferral);
  for (const entry of mapping) assert.deepEqual(entry.legacy_snapshot, originalLegacy.find(({ record }) => record.id === entry.legacy_referral_id).record);
  const preserved = await row(ids.existingReferral);
  for (const [key, value] of Object.entries(originalCanonical)) assert.deepEqual(preserved[key], value);
  assert.equal((await query("select status from public.barangays where id=$1", [ids.legacyBarangay]))[0].status, 'Inactive');
  assert.equal((await query("select referral_id from public.referral_archive_fk where id='archive-1'"))[0].referral_id, 'REF-HISTORICAL-1');
  assert.equal((await query('select count(*)::int count from public.notifications'))[0].count, 0);
  const beforeHistory = await query('select * from public.health_referral_history order by referral_id,version');
  await db.exec(migrationSql);
  assert.deepEqual(await query('select * from public.health_referral_legacy_map order by legacy_referral_id'), mapping);
  assert.deepEqual(await query('select * from public.health_referral_history order by referral_id,version'), beforeHistory);
  assert.equal((await query('select count(*)::int count from public.health_referrals'))[0].count, 5);
});

test('inconsistent historical resident/source identity is preserved for admin review, never exposed or assigned as clinical care', async () => {
  const link = (await query("select * from public.health_referral_legacy_map where legacy_referral_id='REF-HISTORICAL-5'"))[0];
  assert.equal(link.source_visit_matches_resident, false);
  const referral = await row(link.health_referral_id);
  assert.equal(referral.treatment_visit_id, null);
  assert.equal(link.legacy_snapshot.visit_id, 'SOURCE-OTHER');
  for (const actor of [people.resident, people.sender, people.phn, people.triage, people.mho]) {
    await asClient(actor, 'authenticated', async () => {
      assert.equal((await query('select id from public.health_referrals where id=$1', [referral.id])).length, 0);
      assert.equal((await query('select * from public.health_referral_legacy_map where health_referral_id=$1', [referral.id])).length, 0);
    });
  }
  await asClient(people.admin, 'authenticated', async () => assert.equal((await query('select id from public.health_referrals where id=$1', [referral.id])).length, 1));
  await assert.rejects(() => write(people.phn, referral.id, 'update', referral.version, {
    recipient_personnel_id: people.triage, recipient_facility_id: ids.rhu, recipient_role: 'rhu_personnel', recipient_station: 'triage',
  }), (error) => error.code === '42501');
});

test('permission rollout adds missing RHU decisions only to configured matrices and preserves explicit denial/bootstrap', async () => {
  const grants = await query("select permission_id,granted from public.role_permissions where role='rhu_personnel' order by permission_id");
  assert.equal(grants.find((r) => r.permission_id === 'referrals.approve').granted, false);
  for (const id of ['referrals.reject', 'referrals.status.update', 'referrals.history.view']) assert.equal(grants.find((r) => r.permission_id === id).granted, true);
  assert(!grants.some((r) => ['referrals.assign', 'referrals.create'].includes(r.permission_id)));
  assert.equal((await query("select count(*)::int count from public.role_permissions where role='phn'"))[0].count, 0);
  const referral = await create();
  await assert.rejects(() => change(referral, 'Accepted'), (error) => error.code === '42501');
  await query("update public.role_permissions set granted=true where role='rhu_personnel' and permission_id='referrals.approve'");
});

test('recipient, municipality, facility, station, role, resident and sender validations reject writes with no effects', async () => {
  const before = (await query('select count(*)::int count from public.health_referrals'))[0].count;
  for (const patch of [
    { recipient_personnel_id: people.outside, recipient_facility_id: ids.outsideRhu },
    { recipient_personnel_id: people.otherFacility },
    { recipient_facility_id: ids.otherRhu },
    { recipient_station: 'consultation' },
    { recipient_role: 'phn' },
    { recipient_personnel_id: people.bhw, recipient_role: 'bhw' },
    { recipient_personnel_id: people.disabled },
    { recipient_personnel_id: people.pending },
    { recipient_personnel_id: people.sender, recipient_facility_id: ids.bhs, recipient_role: 'health_supervisor', recipient_station: null },
    { recipient_personnel_id: null },
  ]) await assert.rejects(() => create(patch), (error) => error.code === '22023');
  await assert.rejects(() => create({ resident_id: 'RES-OTHER' }), (error) => error.code === '42501');
  await assert.rejects(() => create({ treatment_visit_id: 'SOURCE-OTHER' }), (error) => error.code === 'P0002');
  await assert.rejects(() => write(people.bhw, null, 'create', null, route()), (error) => error.code === '42501');
  await assert.rejects(() => create({ status: 'Completed' }), (error) => error.code === '22023');
  await assert.rejects(() => create({ patient_snapshot: { spoofed: true } }), (error) => error.code === '22023');
  assert.equal((await query('select count(*)::int count from public.health_referrals'))[0].count, before);
});

test('only the actual recipient receives/acts; sender sees the same durable accepted, progress and completed row', async () => {
  let referral = await create();
  const id = referral.id;
  const createdNotifications = await notifications(id);
  assert.deepEqual(new Set(createdNotifications.map((n) => n.recipient_id)), new Set([people.triage, people.resident]));
  assert.doesNotMatch(JSON.stringify(createdNotifications), /Private clinical|Frozen complaint|Private Resident/);
  for (const actor of [people.peerTriage, people.phn, people.sender, people.mho, people.bhw]) {
    await assert.rejects(() => change(referral, 'Accepted', actor), (error) => error.code === '42501');
  }
  await assert.rejects(() => change(referral, 'Completed'), (error) => error.code === '23514');
  referral = await change(referral, 'Accepted');
  assert(referral.accepted_at);
  await assert.rejects(() => write(people.triage, id, 'status', 1, { status: 'In Progress' }), (error) => error.code === '40001');
  const acceptedHistory = await history(id);
  const retry = await change(referral, 'Accepted');
  assert.equal(retry.version, referral.version);
  assert.deepEqual(await history(id), acceptedHistory);
  referral = await change(referral, 'In Progress');
  referral = await change(referral, 'Completed', people.triage, 'Receiving care completed.');
  assert.equal(referral.id, id);
  assert(referral.completed_at);
  assert.deepEqual((await history(id)).map((h) => h.new_status), ['Pending', 'Accepted', 'In Progress', 'Completed']);
  await asClient(people.sender, 'authenticated', async () => {
    assert.equal((await query('select id,status from public.health_referrals where id=$1', [id]))[0].status, 'Completed');
    assert.equal((await query('select count(*)::int count from public.health_referral_history where referral_id=$1', [id]))[0].count, 4);
  });
  await assert.rejects(() => write(people.sender, id, 'update', referral.version, { reason: 'Overwrite closed data' }), (error) => error.code === '23514');
  await assert.rejects(() => change(referral, 'Accepted'), (error) => error.code === '23514');
});

test('rejection is a reasoned terminal decision; cancellation retains history and never deletes a row', async () => {
  let referral = await create();
  await assert.rejects(() => change(referral, 'Rejected'), (error) => error.code === '22023');
  referral = await change(referral, 'Rejected', people.triage, 'The requested service is unavailable.');
  assert(referral.rejected_at);
  assert.equal((await history(referral.id))[1].explanation, 'The requested service is unavailable.');
  await assert.rejects(() => change(referral, 'Accepted'), (error) => error.code === '23514');
  await assert.rejects(() => write(people.sender, referral.id, 'sync', referral.version, {}), (error) => error.code === '23514');
  let cancelled = await create();
  await assert.rejects(() => change(cancelled, 'Cancelled', people.triage, 'Recipient must reject instead.'), (error) => error.code === '42501');
  cancelled = await change(cancelled, 'Cancelled', people.sender, 'Sender cancelled the request.');
  assert.equal((await row(cancelled.id)).status, 'Cancelled');
  assert.equal((await history(cancelled.id)).length, 2);
});

test('same-facility reassignment changes only the recipient, requires fresh acceptance and notifies concrete new/old accounts', async () => {
  let referral = await change(await create(), 'Accepted');
  referral = await write(people.sender, referral.id, 'update', referral.version, {
    recipient_personnel_id: people.consultation, recipient_facility_id: ids.rhu, recipient_role: 'rhu_personnel', recipient_station: 'consultation',
  });
  assert.equal(referral.status, 'Pending');
  assert.equal(referral.accepted_at, null);
  await asClient(people.triage, 'authenticated', async () => assert.equal((await query('select id from public.health_referrals where id=$1', [referral.id])).length, 0));
  await asClient(people.consultation, 'authenticated', async () => assert.equal((await query('select id from public.health_referrals where id=$1', [referral.id])).length, 1));
  await assert.rejects(() => change(referral, 'Accepted'), (error) => error.code === '42501');
  const senderView = await row(referral.id);
  assert.equal(senderView.recipient_personnel_id, people.consultation);
  assert.equal((await history(referral.id)).at(-1).action, 'Reassigned');
  assert((await notifications(referral.id)).some((n) => n.recipient_id === people.consultation));
  assert(!(await notifications(referral.id)).some((n) => n.recipient_id === people.peerTriage || n.recipient_id === people.mho));
  referral = await change(referral, 'Accepted', people.consultation);
  assert.equal(referral.status, 'Accepted');
});

test('assigned RHU station midwife sees only that cross-barangay referral; community midwife stays within own barangay/BHS', async () => {
  const assigned = await create({ recipient_personnel_id: people.stationMidwife, recipient_role: 'health_supervisor', recipient_station: 'consultation' });
  const other = await create();
  await asClient(people.stationMidwife, 'authenticated', async () => {
    assert.equal((await query('select id from public.health_referrals where id=$1', [assigned.id])).length, 1);
    assert.equal((await query('select id from public.health_referrals where id=$1', [other.id])).length, 0);
  });
  const community = await create({ recipient_personnel_id: people.communityMidwife, recipient_facility_id: ids.bhs, recipient_role: 'health_supervisor', recipient_station: null });
  assert.equal((await change(community, 'Accepted', people.communityMidwife)).status, 'Accepted');
  await assert.rejects(() => create({ recipient_personnel_id: people.otherMidwife, recipient_facility_id: ids.otherBhs, recipient_role: 'health_supervisor', recipient_station: null }), (error) => error.code === '22023');
});

test('current role, station, facility and resident geography revoke stale assignments rather than trusting stored scope', async () => {
  const referral = await create();
  for (const [sql, value, restore] of [
    ['facility_id=$2', ids.otherRhu, ids.rhu], ['role=$2', 'bhw', 'rhu_personnel'], ['rhu_stations=$2', ['consultation'], ['triage']],
  ]) {
    await query(`update public.profiles set ${sql} where id=$1`, [people.triage, value]);
    await asClient(people.triage, 'authenticated', async () => assert.equal((await query('select id from public.health_referrals where id=$1', [referral.id])).length, 0));
    await assert.rejects(() => change(referral, 'Accepted'), (error) => error.code === '42501');
    await query(`update public.profiles set ${sql} where id=$1`, [people.triage, restore]);
  }
  await query("update public.residents set barangay_id=$1,barangay='San Antonio' where id='RES-CANONICAL'", [ids.outsideBarangay]);
  assert.equal((await row(referral.id)).municipality_id, ids.municipality);
  for (const actor of [people.sender, people.phn, people.triage]) {
    await asClient(actor, 'authenticated', async () => assert.equal((await query('select id from public.health_referrals where id=$1', [referral.id])).length, 0));
    await assert.rejects(() => change(referral, 'Accepted', actor), (error) => error.code === 'P0002');
  }
  await query("update public.residents set barangay_id=$1,barangay='San Antonio' where id='RES-CANONICAL'", [ids.barangay]);
});

test('PHN source status/snapshots are atomic and one source never creates a second canonical referral', async () => {
  const referral = await write(people.phn, null, 'create_phn', null, { ...route(), treatment_visit_id: 'SOURCE-NEW' });
  assert.equal((await query("select status from public.visits where id='SOURCE-NEW'"))[0].status, 'referred');
  assert.equal(referral.visit_snapshot.id, 'SOURCE-NEW');
  assert.equal(referral.patient_snapshot.id, 'RES-CANONICAL');
  await assert.rejects(() => write(people.phn, null, 'create_phn', null, { ...route(), treatment_visit_id: 'SOURCE-NEW' }), (error) => error.code === '23505');
  await assert.rejects(() => write(people.phn, null, 'create_phn', null, { ...route(), treatment_visit_id: 'SOURCE-LEGACY' }), (error) => error.code === '23505');
  await query("update public.visits set status='completed',completed_at=now() where id='SOURCE-NEW'");
  assert.equal((await rpc('canonical_referral_complete_from_visit', [referral.id])).status, 'Pending');
});

test('receiving encounter linkage rejects wrong actors/residents/facilities and only a real completed receiving visit completes the workflow', async () => {
  let referral = await change(await create(), 'Accepted');
  const insert = (id, actor = people.triage, resident = 'RES-CANONICAL', facility = ids.rhu) => query("insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,status,facility_id,referral_id) values ($1,$2,$3,'rhu_personnel','draft',$4,$5)", [id, resident, actor, facility, referral.id]);
  await assert.rejects(() => insert('ENCOUNTER-WRONG-ACTOR', people.peerTriage), (error) => error.code === '42501');
  await assert.rejects(() => insert('ENCOUNTER-WRONG-RESIDENT', people.triage, 'RES-OTHER'), (error) => error.code === '42501');
  await assert.rejects(() => insert('ENCOUNTER-WRONG-FACILITY', people.triage, 'RES-CANONICAL', ids.otherRhu), (error) => error.code === '42501');
  await insert('ENCOUNTER-REAL');
  referral = await row(referral.id);
  assert.equal(referral.status, 'In Progress');
  await assert.rejects(() => query("update public.visits set referral_id=null where id='ENCOUNTER-REAL'"), (error) => error.code === '23514');
  await assert.rejects(() => write(people.sender, referral.id, 'update', referral.version, {
    recipient_personnel_id: people.otherFacility, recipient_facility_id: ids.otherRhu, recipient_role: 'rhu_personnel', recipient_station: 'triage',
  }), (error) => error.code === '23514');
  await query("update public.visits set status='completed',completed_at=now() where id='ENCOUNTER-REAL'");
  referral = await row(referral.id);
  assert.equal(referral.status, 'Completed');
  const savedHistory = await history(referral.id);
  await rpc('canonical_referral_complete_from_visit', [referral.id]);
  assert.deepEqual(await history(referral.id), savedHistory);
  assert.deepEqual(savedHistory.map((h) => h.new_status), ['Pending', 'Accepted', 'In Progress', 'Completed']);
});

test('history/private notification failure rolls back the canonical row and PHN source status before a safe retry', async () => {
  await query("insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,status,facility_id) values ('SOURCE-ATOMIC','RES-CANONICAL',$1,'phn','in_review',$2)", [people.phn, ids.rhu]);
  const count = (await query('select count(*)::int count from public.health_referrals'))[0].count;
  await db.exec("create function public.canonical_test_fail_notification() returns trigger language plpgsql as $$ begin raise exception 'Injected notification failure'; end; $$; create trigger canonical_test_fail_notification before insert on public.notifications for each row execute function public.canonical_test_fail_notification()");
  try {
    await assert.rejects(() => write(people.phn, null, 'create_phn', null, { ...route(), treatment_visit_id: 'SOURCE-ATOMIC' }), /Injected notification failure/);
    assert.equal((await query('select count(*)::int count from public.health_referrals'))[0].count, count);
    assert.equal((await query("select status from public.visits where id='SOURCE-ATOMIC'"))[0].status, 'in_review');
  } finally { await db.exec('drop trigger canonical_test_fail_notification on public.notifications; drop function public.canonical_test_fail_notification()'); }
  const referral = await write(people.phn, null, 'create_phn', null, { ...route(), treatment_visit_id: 'SOURCE-ATOMIC' });
  assert.equal((await history(referral.id)).length, 1);
  assert.equal((await query("select status from public.visits where id='SOURCE-ATOMIC'"))[0].status, 'referred');
  await assert.rejects(() => query("update public.visits set resident_id='RES-OTHER' where id='SOURCE-ATOMIC'"), (error) => error.code === '23514');
});

test('RPC writes are service-role-only; direct client/legacy writes cannot bypass status or recipient validation', async () => {
  const referral = await create();
  for (const [actor, role] of [[null, 'anon'], [people.resident, 'authenticated'], [people.sender, 'authenticated'], [people.triage, 'authenticated'], [people.bhw, 'authenticated']]) {
    await asClient(actor, role, async () => {
      await assert.rejects(() => write(people.sender, null, 'create', null, route()), (error) => error.code === '42501');
      await assert.rejects(() => rpc('canonical_referral_complete_from_visit', [referral.id]), (error) => error.code === '42501');
      await assert.rejects(() => query("update public.health_referrals set status='Completed' where id=$1", [referral.id]), (error) => error.code === '42501');
      await assert.rejects(() => query("update public.referrals set receiving_personnel='Changed' where id='REF-HISTORICAL-1'"), (error) => error.code === '42501');
    });
  }
  await asClient(people.bhw, 'authenticated', async () => {
    assert.equal((await query('select id from public.health_referrals where id=$1', [referral.id])).length, 0);
    assert.equal((await query('select * from public.health_referral_history where referral_id=$1', [referral.id])).length, 0);
  });
  await asClient(people.resident, 'authenticated', async () => {
    assert.equal((await query('select id from public.health_referrals where id=$1', [referral.id])).length, 1);
    assert((await query('select * from public.notifications where related_id=$1', [referral.id])).every((n) => n.recipient_id === people.resident));
  });
  await asClient(null, 'service_role', async () => {
    await assert.rejects(() => query("delete from public.referrals where id='REF-HISTORICAL-1'"), (error) => error.code === '42501');
    await assert.rejects(() => query('delete from public.health_referrals where id=$1', [referral.id]), (error) => error.code === '42501');
  });
  assert.deepEqual(await query('select to_jsonb(r) as record from public.referrals r order by id'), originalLegacy);
  const mappings = await query('select * from public.health_referral_legacy_map order by legacy_referral_id');
  const allHistory = await query('select * from public.health_referral_history order by referral_id,version');
  const count = (await query('select count(*)::int count from public.health_referrals'))[0].count;
  await db.exec(migrationSql);
  assert.equal((await query('select count(*)::int count from public.health_referrals'))[0].count, count);
  assert.deepEqual(await query('select * from public.health_referral_history order by referral_id,version'), allHistory);
  assert.deepEqual(await query('select * from public.health_referral_legacy_map order by legacy_referral_id'), mappings);
});

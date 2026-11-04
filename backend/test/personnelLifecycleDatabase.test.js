import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Execute the real migrations in isolated PostgreSQL. These platform tables
// model Supabase's Auth/Storage schemas only; no live project or mail is used.
const db = new PGlite({ extensions: { pgcrypto } });
const migrations = new URL('../../supabase/migrations/', import.meta.url);
const candidate = '20261101010000_health_personnel_account_management.sql';
const ids = Object.fromEntries(['municipality', 'otherMunicipality', 'barangay', 'otherBarangay', 'legacyBarangay', 'facility']
  .map((name) => [name, randomUUID()]));
const existing = {};
let preservedProfiles;

const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const rpc = async (name, params) => {
  const placeholders = params.map((_, index) => `$${index + 1}`).join(',');
  return (await query(`select public.${name}(${placeholders}) as result`, params))[0].result;
};
const profile = async (id) => rpc('personnel_profile_json', [id]);
const transition = (id, action, options = {}) => rpc('admin_transition_personnel_account', [
  id, options.actorId || existing.admin, action, options.reason || '', options.activate ?? true,
  options.operationId || randomUUID(),
]);
const asClient = async (id, role, run) => {
  await query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [id || '', role]);
  await db.exec(`set role ${role}`);
  try { return await run(); }
  finally {
    await db.exec('reset role');
    await query("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'service_role', false)");
  }
};
const createAuthIdentity = async (id, email, managed = false, confirmed = false, metadata = {}) => {
  await query(`insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
    values ($1, $2, $3, $4, case when $5 then now() else null end)`, [
    id, email, JSON.stringify({ full_name: 'Test Personnel', ...metadata }),
    JSON.stringify(managed ? { personnel_managed: true } : {}), confirmed,
  ]);
};
const existingAccount = async (role, status = 'active', assignment = {}) => {
  const id = randomUUID();
  await createAuthIdentity(id, `${id}@example.test`, false, true);
  await query(`update public.profiles set role = $2, status = $3, municipality_id = $4,
    barangay_id = $5, facility_id = $6, rhu_stations = $7 where id = $1`, [
    id, role, status, assignment.municipalityId === undefined ? ids.municipality : assignment.municipalityId, assignment.barangayId ?? null,
    assignment.facilityId ?? null, assignment.stations ?? [],
  ]);
  return id;
};
const legacyRequest = async (id, role, assignment = {}) => (await query(`
  insert into public.staff_account_requests(auth_user_id, full_name, email, role, municipality_id, barangay_id, facility_id, rhu_stations)
  select id, full_name, email, $2, $3, $4, $5, $6 from public.profiles where id = $1 returning id`, [
  id, role, assignment.municipalityId === undefined ? ids.municipality : assignment.municipalityId, assignment.barangayId ?? null,
  assignment.facilityId ?? null, assignment.stations ?? [],
]))[0].id;

const seedExistingRecords = async () => {
  await query('insert into public.municipalities(id,name) values ($1,$2),($3,$4)', [ids.municipality, 'Pili', ids.otherMunicipality, 'Other Municipality']);
  await query('insert into public.barangays(id,municipality_id,name) values ($1,$2,$3),($4,$2,$5),($6,$2,$7)', [
    ids.barangay, ids.municipality, 'San Antonio', ids.otherBarangay, 'San Isidro', ids.legacyBarangay, 'Legacy Barangay',
  ]);
  await query('insert into public.facilities(id,municipality_id,name,type) values ($1,$2,$3,$4)', [ids.facility, ids.municipality, 'Pili RHU', 'rhu']);
  existing.admin = await existingAccount('admin', 'active', { municipalityId: null });
  existing.phn = await existingAccount('phn');
  existing.supervisor = await existingAccount('health_supervisor', 'active', { barangayId: ids.barangay });
  existing.legacySupervisor = await existingAccount('health_supervisor', 'active', { barangayId: ids.legacyBarangay, stations: ['consultation'] });
  existing.pendingLegacySupervisor = await existingAccount('health_supervisor', 'pending_verification', { barangayId: ids.legacyBarangay });
  existing.legacySupervisorRequest = await legacyRequest(existing.pendingLegacySupervisor, 'health_supervisor', { barangayId: ids.legacyBarangay });
  existing.disabled = await existingAccount('phn', 'disabled');
  existing.pendingBhw = await existingAccount('bhw', 'pending_verification', { barangayId: ids.barangay });
  existing.bhwRequest = await legacyRequest(existing.pendingBhw, 'bhw', { barangayId: ids.barangay });
  existing.pendingRhu = await existingAccount('rhu_personnel', 'pending_verification', { facilityId: ids.facility, stations: ['triage'] });
  existing.rhuRequest = await legacyRequest(existing.pendingRhu, 'rhu_personnel', { facilityId: ids.facility, stations: ['triage'] });
  existing.resident = await existingAccount('resident', 'pending_verification', { barangayId: ids.barangay });
  await query(`insert into public.residents(id,health_record_no,first_name,last_name,barangay_id,auth_user_id)
    values ('RES-000001','HR-000001','Test','Resident',$1,$2)`, [ids.barangay, existing.resident]);
  await query(`insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role)
    values ('SUB-000001','RES-000001',$1,'phn')`, [existing.phn]);
  await query(`insert into storage.objects(bucket_id,name,owner) values ('documents','clinical-test.pdf',$1)`, [existing.phn]);
};

const seedLegacyPhone = async () => {
  const municipalityId = randomUUID();
  const barangayId = randomUUID();
  await query('insert into public.municipalities(id,name) values ($1,$2)', [municipalityId, 'Legacy Phone Municipality']);
  await query('insert into public.barangays(id,municipality_id,name) values ($1,$2,$3)', [barangayId, municipalityId, 'San Antonio']);
  existing.legacyPhone = await existingAccount('bhw', 'pending_verification', { municipalityId, barangayId });
  existing.legacyPhoneRequest = await legacyRequest(existing.legacyPhone, 'bhw', { municipalityId, barangayId });
  await query('update public.staff_account_requests set phone = $2 where id = $1', [existing.legacyPhoneRequest, '+639171234567']);
  await query('update public.profiles set contact = $2 where id = $1', [existing.legacyPhone, '+639171234567']);
};

const managedAccount = async (overrides = {}) => {
  const input = {
    email: `${randomUUID()}@example.test`, full_name: 'Invited Personnel', role: 'rhu_personnel',
    municipality_id: ids.municipality, barangay_id: null, facility_id: ids.facility,
    position: '', license_no: '', contact: '', rhu_stations: ['triage'],
    approval_status: 'approved', activation_requested: true, ...overrides,
  };
  const operationId = randomUUID();
  const reservation = await rpc('admin_reserve_personnel_account', [existing.admin, operationId, JSON.stringify(input)]);
  await createAuthIdentity(reservation.target_id, input.email, true);
  const account = await rpc('admin_create_personnel_account', [existing.admin, operationId, JSON.stringify(input)]);
  return { id: account.id, account, input, operationId };
};
const notifications = (id) => query('select * from public.personnel_notification_outbox where account_id = $1 order by created_at, id', [id]);
const claim = (id) => query('select * from public.claim_personnel_notifications(10, $1)', [id]);
const confirmEmail = (id) => query('update auth.users set email_confirmed_at = now() where id = $1', [id]);
const audit = (id, action) => query('select * from public.health_audit_logs where entity_id = $1 and action = $2', [id, action]);
const profileInput = (value, patch = {}) => ({
  full_name: value.full_name, role: value.role, status: value.status,
  municipality_id: value.municipality_id, barangay_id: value.barangay_id, facility_id: value.facility_id,
  position: value.position, license_no: value.license_no, contact: value.contact, rhu_stations: value.rhu_stations, ...patch,
});
const edit = (id, input) => rpc('admin_update_personnel_account', [id, existing.admin, JSON.stringify(input), randomUUID()]);

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
    grant select, insert, update, delete on storage.objects to authenticated;
    create policy objects_owner on storage.objects for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
    select set_config('request.jwt.claim.role', 'service_role', false);
  `);
  const files = (await readdir(migrations)).filter((name) => name.endsWith('.sql') && name < candidate).sort();
  for (const file of files) {
    if (file === '20261020000000_personnel_registration_fixes.sql') await seedLegacyPhone();
    if (file === '20261031000000_restrict_barangays_to_approved_list.sql') await seedExistingRecords();
    try { await db.exec(await readFile(new URL(file, migrations), 'utf8')); }
    catch (error) { throw new Error(`Baseline migration ${file}: ${error.message}`, { cause: error }); }
  }
  preservedProfiles = await query('select * from public.profiles order by id');
  await db.exec(await readFile(new URL(candidate, migrations), 'utf8'));
}, { timeout: 120000 });
after(async () => { await db.close(); });

test('migration preserves existing Auth identities, profiles, assignments, and clinical records without retrospective mail', async () => {
  assert.deepEqual(await query('select * from public.profiles order by id'), preservedProfiles);
  assert.equal((await query('select count(*)::integer as count from auth.users'))[0].count, preservedProfiles.length);
  assert.equal((await query('select count(*)::integer as count from public.residents'))[0].count, 1);
  assert.equal((await query('select count(*)::integer as count from public.visits'))[0].count, 1);
  assert.equal((await notifications(existing.phn)).length, 0);
  assert.equal((await profile(existing.phn)).personnel_account.approval_status, 'approved');
  assert.equal((await profile(existing.pendingBhw)).personnel_account.approval_status, 'pending');
  assert.equal((await profile(existing.disabled)).status, 'disabled');
  assert.equal((await profile(existing.legacySupervisor)).barangay_id, ids.legacyBarangay);
});

test('public Auth metadata cannot assign a staff role and both public intake tables reject client inserts', async () => {
  const id = randomUUID();
  await createAuthIdentity(id, `${id}@example.test`, false, false, { role: 'admin', status: 'active' });
  assert.equal((await profile(id)).role, 'resident');
  await asClient(null, 'anon', async () => {
    await assert.rejects(() => query('insert into public.account_applications default values'), (error) => error.code === '42501');
    await assert.rejects(() => query('insert into public.staff_account_requests default values'), (error) => error.code === '42501');
  });
  await asClient(id, 'authenticated', async () => {
    await assert.rejects(() => query("update public.profiles set role = 'admin' where id = $1", [id]), (error) => error.code === '42501' || /administrator/.test(error.message));
  });
});

test('all client roles are denied administrative RPC execution and outbox reads even with a forged actor UUID', async () => {
  for (const [id, role] of [[null, 'anon'], [existing.resident, 'authenticated'], [existing.admin, 'authenticated']]) {
    await asClient(id, role, async () => {
      await assert.rejects(() => rpc('admin_transition_personnel_account', [existing.pendingBhw, existing.admin, 'approve', '', true, randomUUID()]), (error) => error.code === '42501');
      await assert.rejects(() => profile(existing.phn), (error) => error.code === '42501');
      await assert.rejects(() => query('select * from public.personnel_notification_outbox'), (error) => error.code === '42501');
    });
  }
});

test('an administrator cannot directly edit their own privileged role or approve their own account', async () => {
  await asClient(existing.admin, 'authenticated', async () => {
    await assert.rejects(() => query("update public.profiles set role = 'phn' where id = $1", [existing.admin]), (error) => error.code === '42501');
  });
  await assert.rejects(() => transition(existing.admin, 'approve'), (error) => error.code === '23514');
});

test('create and approve is one committed workflow, with setup deferred and one durable email', async () => {
  const created = await managedAccount();
  assert.equal(created.account.status, 'disabled');
  assert.equal(created.account.personnel_account.approval_status, 'approved');
  assert.equal(created.account.personnel_account.setup_required, true);
  assert.equal(created.account.personnel_account.activation_requested, true);
  assert.deepEqual(created.account.rhu_stations, ['triage']);
  assert.equal((await audit(created.id, 'ACCOUNT_CREATED')).length, 1);
  const approvals = await audit(created.id, 'ACCOUNT_APPROVED');
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].actor_id, existing.admin);
  const jobs = await notifications(created.id);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, 'pending');
  assert.equal(jobs[0].operation_id, created.operationId);
  assert.doesNotMatch(JSON.stringify(jobs), /action_link|hashed_token|password|service_role_key/);
});

test('creation reservation/replay preserves the same identity and cannot adopt or duplicate an existing email', async () => {
  const created = await managedAccount();
  const replay = await rpc('admin_create_personnel_account', [existing.admin, created.operationId, JSON.stringify(created.input)]);
  assert.equal(replay.id, created.id);
  assert.equal((await notifications(created.id)).length, 1);
  assert.equal((await audit(created.id, 'ACCOUNT_CREATED')).length, 1);
  await assert.rejects(() => rpc('admin_reserve_personnel_account', [existing.admin, created.operationId,
    JSON.stringify({ ...created.input, full_name: 'Different Input' })]), (error) => error.code === '23505');
  await assert.rejects(() => rpc('admin_reserve_personnel_account', [existing.admin, randomUUID(), JSON.stringify(created.input)]), (error) => error.code === '23505');
});

test('a provisioning retry cannot overwrite a resident identity linked while an Auth reservation was incomplete', async () => {
  const input = {
    email: `${randomUUID()}@example.test`, full_name: 'Reserved Personnel', role: 'bhw',
    municipality_id: ids.municipality, barangay_id: ids.barangay, facility_id: null,
    rhu_stations: [], approval_status: 'approved', activation_requested: true,
  };
  const operationId = randomUUID();
  const reservation = await rpc('admin_reserve_personnel_account', [existing.admin, operationId, JSON.stringify(input)]);
  await createAuthIdentity(reservation.target_id, input.email, true, true);
  await query(`insert into public.residents(id,health_record_no,first_name,last_name,barangay_id,auth_user_id)
    values ('RES-000002','HR-000002','Reserved','Resident',$1,$2)`, [ids.barangay, reservation.target_id]);
  await assert.rejects(() => rpc('admin_create_personnel_account', [existing.admin, operationId, JSON.stringify(input)]), (error) => error.code === '23514');
  assert.equal((await profile(reservation.target_id)).role, 'resident');
  assert.equal((await query("select auth_user_id from public.residents where id = 'RES-000002'"))[0].auth_user_id, reservation.target_id);
  assert.equal((await notifications(reservation.target_id)).length, 0);
});

test('pending creation sends no email and repeated approval does not produce redundant decisions or notifications', async () => {
  const created = await managedAccount({ approval_status: 'pending' });
  assert.equal(created.account.status, 'pending_verification');
  assert.equal((await notifications(created.id)).length, 0);
  const approved = await transition(created.id, 'approve');
  assert.equal(approved.status, 'disabled');
  assert.equal(approved.personnel_account.approval_status, 'approved');
  await transition(created.id, 'approve');
  assert.equal((await notifications(created.id)).length, 1);
  assert.equal((await audit(created.id, 'ACCOUNT_APPROVED')).length, 1);
});

test('password setup requires a confirmed invitation and approved unsuspended account', async () => {
  const pending = await managedAccount({ approval_status: 'pending' });
  await confirmEmail(pending.id);
  await assert.rejects(() => rpc('complete_personnel_account_setup', [pending.id]), (error) => error.code === '42501');
  const approved = await managedAccount();
  await assert.rejects(() => rpc('complete_personnel_account_setup', [approved.id]), (error) => error.code === '42501');
  await confirmEmail(approved.id);
  const complete = await rpc('complete_personnel_account_setup', [approved.id]);
  assert.equal(complete.status, 'active');
  assert.equal(complete.personnel_account.setup_required, false);
  assert.ok(complete.personnel_account.setup_completed_at);
  const activated = await audit(approved.id, 'ACCOUNT_ACTIVATED');
  assert.equal(activated[0].actor_id, existing.admin);
  assert.equal(activated[0].metadata.setup_completed_by, approved.id);
  await rpc('complete_personnel_account_setup', [approved.id]);
  assert.equal((await audit(approved.id, 'ACCOUNT_ACTIVATED')).length, 1);
});

test('approval may withhold activation after verified setup, then reactivate without changing credentials', async () => {
  const created = await managedAccount({ activation_requested: false });
  await confirmEmail(created.id);
  const complete = await rpc('complete_personnel_account_setup', [created.id]);
  assert.equal(complete.status, 'disabled');
  assert.equal(complete.personnel_account.approval_status, 'approved');
  assert.equal(complete.personnel_account.setup_required, false);
  const reactivated = await transition(created.id, 'reactivate');
  assert.equal(reactivated.status, 'active');
  assert.equal(reactivated.id, created.id);
});

test('suspension revokes owner/creator and storage RLS access while preserving records and resident self-service', async () => {
  await asClient(existing.phn, 'authenticated', async () => {
    assert.equal((await query("select id from public.visits where id = 'SUB-000001'")).length, 1);
    assert.equal((await query("select id from storage.objects where name = 'clinical-test.pdf'")).length, 1);
  });
  const suspended = await transition(existing.phn, 'suspend', { reason: 'Access review' });
  assert.equal(suspended.status, 'disabled');
  assert.ok(suspended.personnel_account.suspended_at);
  await asClient(existing.phn, 'authenticated', async () => {
    assert.equal((await query("select id from public.visits where id = 'SUB-000001'")).length, 0);
    assert.equal((await query("select id from storage.objects where name = 'clinical-test.pdf'")).length, 0);
    assert.equal((await query('select id from public.profiles where id = $1', [existing.phn])).length, 1);
    assert.equal((await query('select account_id from public.personnel_accounts where account_id = $1', [existing.phn])).length, 1);
  });
  await asClient(existing.resident, 'authenticated', async () => {
    assert.equal((await query("select id from public.residents where id = 'RES-000001'")).length, 1);
  });
  assert.equal((await query("select id from public.visits where id = 'SUB-000001'")).length, 1);
  assert.equal((await query('select id from auth.users where id = $1', [existing.phn])).length, 1);
  await transition(existing.phn, 'reactivate');
});

test('pending personnel can be edited without silently approving or activating them', async () => {
  const created = await managedAccount({ approval_status: 'pending' });
  const updated = await edit(created.id, profileInput(created.account, { contact: '09171234567' }));
  assert.equal(updated.id, created.id);
  assert.equal(updated.contact, '09171234567');
  assert.equal(updated.status, 'pending_verification');
  assert.equal(updated.personnel_account.approval_status, 'pending');
  assert.equal((await notifications(created.id)).length, 0);
});

test('unrelated edits preserve unchanged legacy assignments, stations, and their audit attribution', async () => {
  const previous = await profile(existing.legacySupervisor);
  const updated = await edit(existing.legacySupervisor, profileInput(previous, { contact: '09171234567' }));
  assert.equal(updated.barangay_id, ids.legacyBarangay);
  assert.deepEqual(updated.rhu_stations, ['consultation']);
  assert.equal(updated.role, 'health_supervisor');
  const changes = await audit(existing.legacySupervisor, 'ACCOUNT_UPDATED');
  assert.equal(changes.at(-1).actor_id, existing.admin);
  assert.equal(changes.at(-1).barangay_id, ids.legacyBarangay);
});

test('authorized role, barangay/facility, and station changes keep one identity and audit each changed assignment', async () => {
  const previous = await profile(existing.legacySupervisor);
  const updated = await edit(existing.legacySupervisor, profileInput(previous, {
    role: 'rhu_personnel', barangay_id: null, facility_id: ids.facility, rhu_stations: ['triage', 'consultation'],
  }));
  assert.equal(updated.id, previous.id);
  assert.equal(updated.role, 'rhu_personnel');
  assert.deepEqual(updated.rhu_stations, ['triage', 'consultation']);
  for (const action of ['ACCOUNT_ROLE_CHANGED', 'ACCOUNT_ASSIGNMENT_CHANGED', 'ACCOUNT_STATIONS_CHANGED']) {
    const changes = await audit(previous.id, action);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].actor_id, existing.admin);
    assert.ok(changes[0].created_at);
  }
});

test('legacy approvals enforce scoped roles, preserve request identity, and commit decision/access/email together', async () => {
  await assert.rejects(() => rpc('review_personnel_account_request', [existing.bhwRequest, existing.phn, 'approved', '']), (error) => error.code === '42501');
  const result = await rpc('review_personnel_account_request', [existing.bhwRequest, existing.supervisor, 'approved', '']);
  assert.equal(result.id, existing.bhwRequest);
  assert.equal(result.status, 'approved');
  assert.equal(result.profileStatus, 'active');
  assert.equal(result.decided_by, existing.supervisor);
  assert.equal((await profile(existing.pendingBhw)).id, existing.pendingBhw);
  assert.equal((await notifications(existing.pendingBhw)).length, 1);
  await rpc('review_personnel_account_request', [existing.bhwRequest, existing.supervisor, 'approved', '']);
  assert.equal((await notifications(existing.pendingBhw)).length, 1);
  await transition(existing.pendingBhw, 'suspend', { reason: 'Access review' });
  const replay = await rpc('review_personnel_account_request', [existing.bhwRequest, existing.supervisor, 'approved', '']);
  assert.equal(replay.profileStatus, 'disabled');
  assert.equal((await profile(existing.pendingBhw)).status, 'disabled');
});

test('admin assignment changes synchronize legacy requests so a historical queue cannot restore a previous role', async () => {
  const previous = await profile(existing.pendingRhu);
  const updated = await edit(existing.pendingRhu, profileInput(previous, {
    role: 'bhw', barangay_id: ids.otherBarangay, facility_id: null, rhu_stations: [],
  }));
  assert.equal(updated.role, 'bhw');
  const request = (await query('select * from public.staff_account_requests where id = $1', [existing.rhuRequest]))[0];
  assert.equal(request.role, 'bhw');
  assert.equal(request.barangay_id, ids.otherBarangay);
  await assert.rejects(() => rpc('review_personnel_account_request', [existing.rhuRequest, existing.phn, 'approved', '']), (error) => error.code === '42501');
  const approved = await transition(existing.pendingRhu, 'approve');
  assert.equal(approved.role, 'bhw');
  assert.equal(approved.status, 'active');
  assert.equal((await query('select status from public.staff_account_requests where id = $1', [existing.rhuRequest]))[0].status, 'approved');
});

test('approval/activation failure rolls back the decision, audit and outbox instead of reporting partial approval', async () => {
  const id = existing.pendingLegacySupervisor;
  const requestId = existing.legacySupervisorRequest;
  await assert.rejects(() => rpc('review_personnel_account_request', [requestId, existing.phn, 'approved', '']), (error) => error.code === '22023');
  assert.equal((await query('select status from public.staff_account_requests where id = $1', [requestId]))[0].status, 'pending');
  assert.equal((await profile(id)).status, 'pending_verification');
  assert.equal((await profile(id)).personnel_account.approval_status, 'pending');
  assert.equal((await notifications(id)).length, 0);
  assert.equal((await audit(id, 'ACCOUNT_APPROVED')).length, 0);
});

test('legacy review rejects null scope matches and direct decision-actor forgery', async () => {
  const id = await existingAccount('rhu_personnel', 'pending_verification', { municipalityId: null });
  const requestId = await legacyRequest(id, 'rhu_personnel', { municipalityId: null });
  await query("insert into public.personnel_accounts(account_id,approval_status) values ($1,'pending')", [id]);
  await assert.rejects(() => rpc('review_personnel_account_request', [requestId, existing.phn, 'approved', '']), (error) => error.code === '42501');
  await asClient(existing.supervisor, 'authenticated', async () => {
    await assert.rejects(() => query("update public.staff_account_requests set status = 'approved', decided_by = $2 where id = $1", [requestId, existing.admin]), (error) => error.code === '42501');
  });
});

test('notification claims and compare-and-swap outcomes prevent concurrent or already-accepted sends', async () => {
  const created = await managedAccount();
  const jobs = await claim(created.id);
  assert.equal(jobs.length, 1);
  assert.equal((await claim(created.id)).length, 0);
  const job = jobs[0];
  assert.equal(await rpc('begin_personnel_notification_send', [job.id, randomUUID()]), false);
  assert.equal(await rpc('finish_personnel_notification', [job.id, job.claim_token, 'sent', null, 'test-message-id']), false);
  assert.equal(await rpc('begin_personnel_notification_send', [job.id, job.claim_token]), true);
  assert.equal(await rpc('finish_personnel_notification', [job.id, job.claim_token, 'sent', null, 'test-message-id']), true);
  assert.equal(await rpc('finish_personnel_notification', [job.id, job.claim_token, 'sent', null, 'test-message-id']), false);
  assert.equal((await claim(created.id)).length, 0);
  assert.equal((await notifications(created.id))[0].status, 'sent');
  await transition(created.id, 'retry_email');
  assert.equal((await claim(created.id)).length, 0);
});

test('definitively unsent failures back off and can retry, but an uncertain SMTP result never automatically resends', async () => {
  const created = await managedAccount();
  let job = (await claim(created.id))[0];
  await rpc('finish_personnel_notification', [job.id, job.claim_token, 'failed', 'SMTP_CONFIG_MISSING', null]);
  assert.equal((await claim(created.id)).length, 0);
  const failed = (await notifications(created.id))[0];
  assert.ok(new Date(failed.next_attempt_at).getTime() > Date.now());
  await transition(created.id, 'retry_email');
  job = (await claim(created.id))[0];
  await rpc('begin_personnel_notification_send', [job.id, job.claim_token]);
  await rpc('finish_personnel_notification', [job.id, job.claim_token, 'delivery_unknown', 'SMTP_ACCEPTANCE_UNKNOWN', null]);
  await query("update public.personnel_notification_outbox set next_attempt_at = now() - interval '1 hour' where id = $1", [job.id]);
  assert.equal((await claim(created.id)).length, 0);
  await assert.rejects(() => transition(created.id, 'retry_email'), (error) => error.code === '23514');
  await assert.rejects(() => transition(created.id, 'invite'), (error) => error.code === '23514');
});

test('email failure diagnostics remain audited after a safe retry succeeds and clears the current outbox error', async () => {
  const created = await managedAccount();
  let job = (await claim(created.id))[0];
  await rpc('finish_personnel_notification', [job.id, job.claim_token, 'failed', 'SMTP_CONFIG_MISSING', null]);
  await transition(created.id, 'retry_email');
  job = (await claim(created.id))[0];
  await rpc('begin_personnel_notification_send', [job.id, job.claim_token]);
  await rpc('finish_personnel_notification', [job.id, job.claim_token, 'sent', null, 'test-message-id']);
  assert.equal((await notifications(created.id))[0].last_error_code, null);
  const failures = await audit(created.id, 'ACCOUNT_EMAIL_FAILED');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].actor_id, null);
  assert.equal(failures[0].metadata.new.reason, 'SMTP_CONFIG_MISSING');
  assert.equal(failures[0].metadata.notification_id, job.id);
  assert.equal(failures[0].metadata.requested_by, existing.admin);
  assert.equal((await audit(created.id, 'ACCOUNT_EMAIL_ACCEPTED')).length, 1);
  assert.doesNotMatch(JSON.stringify(failures), /claim_token|action_link|password/);
});

test('expired processing leases are safe to reclaim whereas expired sending leases are parked for review', async () => {
  const processing = await managedAccount();
  const sending = await managedAccount();
  const before = (await claim(processing.id))[0];
  const uncertain = (await claim(sending.id))[0];
  await rpc('begin_personnel_notification_send', [uncertain.id, uncertain.claim_token]);
  await query("update public.personnel_notification_outbox set claimed_at = now() - interval '6 minutes' where id in ($1,$2)", [before.id, uncertain.id]);
  const recovered = (await claim(processing.id))[0];
  assert.notEqual(recovered.claim_token, before.claim_token);
  assert.equal(recovered.attempts, 2);
  assert.equal((await claim(sending.id)).length, 0);
  assert.equal((await notifications(sending.id))[0].status, 'delivery_unknown');
});

test('suspension cancels a claimed stale invitation before SMTP and pending rejection never grants access', async () => {
  const approved = await managedAccount();
  const claimed = (await claim(approved.id))[0];
  await transition(approved.id, 'suspend', { reason: 'Await identity review' });
  assert.equal(await rpc('begin_personnel_notification_send', [claimed.id, claimed.claim_token]), false);
  assert.equal((await notifications(approved.id)).find((job) => job.id === claimed.id).status, 'cancelled');
  const pending = await managedAccount({ approval_status: 'pending' });
  const rejected = await transition(pending.id, 'reject', { reason: 'Assignment not authorized' });
  assert.equal(rejected.status, 'disabled');
  assert.equal(rejected.personnel_account.approval_status, 'rejected');
  assert.equal((await notifications(pending.id))[0].event_type, 'rejected');
  await assert.rejects(() => transition(pending.id, 'reactivate'), (error) => error.code === '23514');
});

test('the database honors a configured permission denial rather than trusting frontend admin controls', async () => {
  await query("insert into public.role_permissions(role,permission_id,granted) values ('admin','accounts.create',true),('admin','accounts.roles.manage',true),('admin','accounts.deactivate',true),('admin','accounts.personnel.approve',false)");
  try {
    await assert.rejects(() => managedAccount(), (error) => error.code === '42501');
    const pending = await managedAccount({ approval_status: 'pending' });
    await assert.rejects(() => transition(pending.id, 'approve'), (error) => error.code === '42501');
    assert.equal((await profile(pending.id)).personnel_account.approval_status, 'pending');
  } finally { await query("delete from public.role_permissions where role = 'admin'"); }
});

test('approval permission alone cannot bypass an explicitly denied activation permission', async () => {
  await query("insert into public.role_permissions(role,permission_id,granted) values ('admin','accounts.create',true),('admin','accounts.roles.manage',true),('admin','accounts.personnel.approve',true),('admin','accounts.deactivate',false)");
  try {
    await assert.rejects(() => managedAccount(), (error) => error.code === '42501');
    const pending = await managedAccount({ approval_status: 'pending', activation_requested: false });
    await assert.rejects(() => transition(pending.id, 'approve'), (error) => error.code === '42501');
    const approved = await transition(pending.id, 'approve', { activate: false });
    assert.equal(approved.personnel_account.approval_status, 'approved');
    assert.equal(approved.personnel_account.activation_requested, false);
    await confirmEmail(pending.id);
    assert.equal((await rpc('complete_personnel_account_setup', [pending.id])).status, 'disabled');
  } finally { await query("delete from public.role_permissions where role = 'admin'"); }
});

test('status-only account changes retain the existing activation permission split without granting profile-edit authority', async () => {
  const created = await managedAccount();
  await confirmEmail(created.id);
  const active = await rpc('complete_personnel_account_setup', [created.id]);
  await query("insert into public.role_permissions(role,permission_id,granted) values ('admin','accounts.deactivate',true),('admin','accounts.edit',false)");
  try {
    const suspended = await edit(created.id, profileInput(active, { status: 'disabled' }));
    assert.equal(suspended.status, 'disabled');
    await assert.rejects(() => edit(created.id, profileInput(suspended, { full_name: 'Unauthorized Edit' })), (error) => error.code === '42501');
    assert.equal((await profile(created.id)).full_name, active.full_name);
    assert.equal((await edit(created.id, profileInput(suspended, { status: 'active' }))).status, 'active');
  } finally { await query("delete from public.role_permissions where role = 'admin'"); }
});

test('assignment edits also require the configured role/assignment-management permission', async () => {
  const created = await managedAccount({ role: 'bhw', barangay_id: ids.barangay, facility_id: null, rhu_stations: [] });
  await query("insert into public.role_permissions(role,permission_id,granted) values ('admin','accounts.edit',true),('admin','accounts.roles.manage',false)");
  try {
    await assert.rejects(() => edit(created.id, profileInput(created.account, { barangay_id: ids.otherBarangay })), (error) => error.code === '42501');
    const contact = await edit(created.id, profileInput(created.account, { contact: '09171234567' }));
    assert.equal(contact.barangay_id, ids.barangay);
    assert.equal(contact.contact, '09171234567');
  } finally { await query("delete from public.role_permissions where role = 'admin'"); }
});

test('unchanged legacy phone values do not force re-registration or block an atomic account decision', async () => {
  const before = await profile(existing.legacyPhone);
  const approved = await transition(existing.legacyPhone, 'approve');
  assert.equal(approved.id, before.id);
  assert.equal(approved.status, 'active');
  assert.equal(approved.contact, '+639171234567');
  const request = (await query('select * from public.staff_account_requests where id = $1', [existing.legacyPhoneRequest]))[0];
  assert.equal(request.phone, '+639171234567');
  assert.equal(request.status, 'approved');
  assert.equal((await notifications(existing.legacyPhone)).length, 1);
});

test('new or explicitly changed personnel-request phone values still enforce the supported format', async () => {
  await assert.rejects(() => query('update public.staff_account_requests set phone = $2 where id = $1',
    [existing.bhwRequest, '+639181234567']), (error) => error.code === '22023');
  await assert.rejects(() => query(`insert into public.staff_account_requests(auth_user_id,full_name,email,role,phone)
    select id,full_name,email,role,'invalid' from public.profiles where id = $1`, [existing.disabled]), (error) => error.code === '22023');
});

test('an approved active administrator may retry their own definitively failed notification without approving their own access', async () => {
  const created = await managedAccount({ role: 'admin', municipality_id: null, facility_id: null, rhu_stations: [] });
  await confirmEmail(created.id);
  await rpc('complete_personnel_account_setup', [created.id]);
  const job = (await claim(created.id))[0];
  await rpc('finish_personnel_notification', [job.id, job.claim_token, 'failed', 'SMTP_CONFIG_MISSING', null]);
  const retried = await transition(created.id, 'retry_email', { actorId: created.id });
  assert.equal(retried.status, 'active');
  assert.equal(retried.personnel_account.approved_by, existing.admin);
  assert.equal((await notifications(created.id))[0].status, 'pending');
  await assert.rejects(() => transition(created.id, 'approve', { actorId: created.id }), (error) => error.code === '23514');
});

test('schema relationship contracts use direct profile FKs for personnel data but Auth for health-audit actors', async () => {
  const referencedTable = async (table, column) => (await query(`select c.confrelid::regclass::text as target
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = $1::regclass and c.contype = 'f' and a.attname = $2`, [table, column]))[0].target;
  assert.equal(await referencedTable('public.health_audit_logs', 'actor_id'), 'auth.users');
  assert.equal(await referencedTable('public.personnel_accounts', 'account_id'), 'profiles');
  assert.equal(await referencedTable('public.personnel_notification_outbox', 'account_id'), 'profiles');
});

test('deletion guard preserves personnel history even after promotion to an administrative role', async () => {
  await assert.rejects(() => rpc('admin_assert_account_deletable', [existing.phn, existing.admin]), (error) => error.code === '23514');
  const previous = await profile(existing.pendingRhu);
  const promoted = await edit(existing.pendingRhu, profileInput(previous, {
    role: 'admin', municipality_id: null, barangay_id: null, facility_id: null, rhu_stations: [],
  }));
  assert.equal(promoted.role, 'admin');
  await assert.rejects(() => rpc('admin_assert_account_deletable', [promoted.id, existing.admin]), (error) => error.code === '23514');
  assert.equal((await query('select id from public.staff_account_requests where auth_user_id = $1', [promoted.id])).length, 1);
  assert.equal((await rpc('admin_assert_account_deletable', [existing.resident, existing.admin])).id, existing.resident);
});

test('new attributed audits retain the acting administrator snapshot even if that administrator is subsequently deleted', async () => {
  const created = await managedAccount();
  for (const action of ['ACCOUNT_CREATED', 'ACCOUNT_APPROVED']) {
    assert.equal((await audit(created.id, action))[0].metadata.actor.id, existing.admin);
  }
  await query('delete from auth.users where id = $1', [existing.admin]);
  const approval = (await audit(created.id, 'ACCOUNT_APPROVED'))[0];
  assert.equal(approval.actor_id, null);
  assert.equal(approval.metadata.actor.id, existing.admin);
  assert.equal(approval.metadata.actor.role, 'admin');
  assert.ok(approval.created_at);
});

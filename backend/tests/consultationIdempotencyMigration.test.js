import assert from 'node:assert/strict';
import test, { before, beforeEach, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// PostgreSQL-compatible, in-memory migration verification. No remote database.
const ACTOR = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const RECIPIENT = '33333333-3333-4333-8333-333333333333';
const KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HASH = 'a'.repeat(64);
let database;
const schema = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  grant usage on schema auth to authenticated, service_role;
  create function auth.role() returns text language sql as $$ select current_user::text $$;
  create function auth.uid() returns uuid language sql as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create table auth.users(id uuid primary key);
  create table public.profiles(id uuid primary key references auth.users(id));
  create table public.residents (
    id text primary key, municipality_id uuid, barangay_id uuid,
    auth_user_id uuid references auth.users(id)
  );
  create table public.visits (
    id text primary key, resident_id text not null references public.residents(id),
    recorded_by_id text not null, recorded_by_role text not null,
    recorded_by_name text not null default '', status text default 'completed',
    visit_date timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table public.follow_ups (
    id uuid primary key default gen_random_uuid(), resident_id text references public.residents(id),
    consultation_id text references public.visits(id), created_by uuid references public.profiles(id),
    client_operation_key text, municipality_id uuid, barangay_id uuid,
    purpose text, scheduled_date date not null, notes text, assigned_provider text, status text,
    requires_resident_response boolean, resident_decision text,
    resident_decision_at timestamptz, resident_decision_reason text
  );
  create table public.notifications (
    id uuid primary key default gen_random_uuid(), recipient_id uuid not null references auth.users(id),
    category text, title text, message text, related_type text, related_id text
  );
  create table public.health_audit_logs (
    id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id),
    action text, entity_type text, entity_id text, municipality_id uuid, barangay_id uuid
  );
  create function public.sync_operational_scope() returns trigger language plpgsql as $$
  declare r public.residents%rowtype;
  begin
    select * into strict r from public.residents where id = new.resident_id;
    new.municipality_id := r.municipality_id; new.barangay_id := r.barangay_id;
    return new;
  end; $$;
  create trigger follow_ups_scope before insert or update on public.follow_ups
    for each row execute function public.sync_operational_scope();
  insert into auth.users(id) values ('${ACTOR}'), ('${OTHER}'), ('${RECIPIENT}');
  insert into public.profiles(id) values ('${ACTOR}'), ('${OTHER}');
  insert into public.residents(id, municipality_id, barangay_id, auth_user_id) values
    ('RES-TEST', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '${RECIPIENT}'),
    ('RES-OTHER', null, null, null);
  insert into public.visits(id, resident_id, recorded_by_id, recorded_by_role, visit_date, created_at, updated_at)
    values ('LEGACY', 'RES-TEST', '${ACTOR}', 'phn', '2026-10-01T23:30:00Z', '2026-10-01T01:00:00Z', '2026-10-02T02:00:00Z');
`;
const details = { consultationDate: '2026-11-05', consultationTime: '09:42', chiefComplaint: 'Test complaint',
  diagnosis: 'Sensitive test assessment', adviceGiven: 'Sensitive test advice', nextVisitDate: '2026-11-12' };

before(async () => {
  database = new PGlite();
  await database.exec(schema);
  const migration = await readFile(new URL('../../supabase/migrations/20261106020000_consultation_operation_idempotency.sql', import.meta.url), 'utf8');
  await database.exec(migration);
});
beforeEach(async () => {
  await database.exec('reset role; truncate public.follow_ups, public.notifications, public.health_audit_logs; delete from public.visits where id <> \'LEGACY\';');
});
after(async () => { if (database) await database.close(); });

const insertVisit = (key = KEY, id = 'SUB-TEST') => database.query(`
  insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,recorded_by_name,
    client_operation_key,client_operation_payload_hash,recorded_at,consultation_details)
  values ($1,'RES-TEST',$2,'phn','Test Clinician',$3::uuid,$4,'2026-11-05T01:43:12Z',$5::jsonb)
`, [id, ACTOR, key, HASH, JSON.stringify(details)]);
const complete = (creator = ACTOR) => database.query('select public.complete_consultation_operation($1,$2::uuid) as result', ['SUB-TEST', creator]);
const counts = async () => (await database.query(`select
  (select count(*)::integer from public.follow_ups) as followups,
  (select count(*)::integer from public.notifications) as notifications,
  (select count(*)::integer from public.health_audit_logs) as audits
`)).rows[0];

test('migration is additive and only service_role can execute clinical operation completion', async () => {
  const legacy = (await database.query('select * from public.visits where id = \'LEGACY\'')).rows[0];
  assert.equal(new Date(legacy.created_at).toISOString(), '2026-10-01T01:00:00.000Z');
  assert.equal(new Date(legacy.updated_at).toISOString(), '2026-10-02T02:00:00.000Z');
  assert.equal(legacy.recorded_at, null);
  const privileges = (await database.query(`select
    has_function_privilege('authenticated','public.complete_consultation_operation(text,uuid)','EXECUTE') as browser,
    has_function_privilege('anon','public.complete_consultation_operation(text,uuid)','EXECUTE') as anonymous,
    has_function_privilege('service_role','public.complete_consultation_operation(text,uuid)','EXECUTE') as backend
  `)).rows[0];
  assert.deepEqual(privileges, { browser: false, anonymous: false, backend: true });
  await database.exec('set role authenticated');
  await assert.rejects(complete(), { code: '42501' });
  await database.exec('reset role');
});

test('unique UUID and immutable creator/resident/recording timestamp survive SQL retries and edits', async () => {
  await insertVisit();
  await assert.rejects(insertVisit(KEY, 'SUB-DUPLICATE'), { code: '23505' });
  for (const [column, value] of [ ['recorded_by_id', OTHER], ['resident_id', 'RES-OTHER'],
    ['recorded_at', '2026-11-06T01:43:12Z'], ['client_operation_key', OTHER], ['client_operation_payload_hash', 'b'.repeat(64)] ]) {
    await assert.rejects(database.query(`update public.visits set ${column} = $1 where id = 'SUB-TEST'`, [value]), { code: '23514' });
  }
  await assert.rejects(complete(OTHER), { code: '42501' });
  assert.deepEqual(await counts(), { followups: 0, notifications: 0, audits: 0 });
  await database.exec('grant insert on public.visits to authenticated; set role authenticated');
  await database.query('select set_config(\'request.jwt.claim.sub\', $1, false)', [OTHER]);
  await assert.rejects(insertVisit(OTHER, 'SUB-FORGED-CREATOR'), { code: '42501' });
  await database.exec('reset role');
});

test('follow-up, audit, notifications and completion marker roll back together then resume once', async () => {
  await insertVisit();
  await database.exec(`create function public.reject_test_notification() returns trigger language plpgsql as $$
    begin raise exception 'Temporary notification outage'; end; $$;
    create trigger reject_test_notification before insert on public.notifications
      for each row execute function public.reject_test_notification();`);
  await assert.rejects(complete(), /Temporary notification outage/);
  assert.deepEqual(await counts(), { followups: 0, notifications: 0, audits: 0 });
  assert.equal((await database.query('select consultation_effects_completed_at from public.visits where id = \'SUB-TEST\'')).rows[0].consultation_effects_completed_at, null);
  await database.exec('drop trigger reject_test_notification on public.notifications; drop function public.reject_test_notification();');
  await complete();
  await Promise.all(Array.from({ length: 8 }, () => complete()));
  assert.deepEqual(await counts(), { followups: 1, notifications: 2, audits: 2 });
  const followup = (await database.query('select * from public.follow_ups')).rows[0];
  assert.equal(followup.consultation_id, 'SUB-TEST');
  assert.equal(followup.resident_id, 'RES-TEST');
  assert.equal(followup.created_by, ACTOR);
  assert.equal(followup.status, 'Pending');
  assert.equal(followup.resident_decision, 'pending');
  assert.equal(followup.requires_resident_response, true);
  assert.equal(followup.municipality_id, '44444444-4444-4444-8444-444444444444');
  const notifications = (await database.query('select * from public.notifications')).rows;
  assert.ok(notifications.every((row) => row.recipient_id === RECIPIENT));
  assert.ok(notifications.every((row) => !row.message.includes(details.diagnosis) && !row.message.includes(details.adviceGiven)));
  await database.exec("update public.follow_ups set status = 'Scheduled', resident_decision = 'approved';");
  await complete();
  assert.equal((await database.query('select resident_decision from public.follow_ups')).rows[0].resident_decision, 'approved');
  assert.deepEqual(await counts(), { followups: 1, notifications: 2, audits: 2 });
});

test('a conflicting follow-up operation never overwrites another creator/resident or marks completion', async () => {
  await insertVisit();
  await database.query(`insert into public.follow_ups(resident_id,created_by,client_operation_key,scheduled_date)
    values ('RES-OTHER',$1::uuid,'consultation-followup:SUB-TEST:2026-11-12','2026-11-12')`, [OTHER]);
  await assert.rejects(complete(), { code: '23505' });
  assert.deepEqual(await counts(), { followups: 1, notifications: 0, audits: 0 });
  const row = (await database.query('select resident_id,created_by,consultation_id from public.follow_ups')).rows[0];
  assert.deepEqual(row, { resident_id: 'RES-OTHER', created_by: OTHER, consultation_id: null });
  assert.equal((await database.query('select consultation_effects_completed_at from public.visits where id = \'SUB-TEST\'')).rows[0].consultation_effects_completed_at, null);
});

test('date filters preserve legacy calendar days and new local dates at UTC boundaries', async () => {
  await insertVisit();
  await database.query("update public.visits set visit_date='2026-11-04T16:15:00Z' where id='SUB-TEST'");
  const dates = (await database.query('select id,consultation_date::text as date from public.visits order by id')).rows;
  assert.deepEqual(dates, [{ id: 'LEGACY', date: '2026-10-01' }, { id: 'SUB-TEST', date: '2026-11-05' }]);
  assert.equal((await database.query("select id from public.visits where consultation_date between '2026-10-01' and '2026-10-01'")).rows[0].id, 'LEGACY');
  assert.equal((await database.query("select id from public.visits where consultation_date between '2026-11-05' and '2026-11-05'")).rows[0].id, 'SUB-TEST');
});

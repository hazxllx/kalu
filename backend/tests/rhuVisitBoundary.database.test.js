import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../../supabase/migrations/20261119030000_rhu_visit_api_boundary.sql', import.meta.url), 'utf8');

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function public.profile_role() returns text language sql stable as $$
      select current_setting('test.role',true) $$;
    create function public.is_staff_active() returns boolean language sql stable as $$ select true $$;
    create function public.profile_facility_id() returns uuid language sql stable as $$
      select nullif(current_setting('test.facility',true),'')::uuid $$;
    create function public.profile_rhu_stations() returns text[] language sql stable as $$
      select string_to_array(current_setting('test.stations',true),',') $$;
    create table public.visits(id text primary key, resident_id text, recorded_by_id text, facility_id uuid, status text);
    alter table public.visits enable row level security;
    grant all on public.visits to authenticated, service_role;
    grant select on public.visits to anon;
    create policy visits_existing_read on public.visits for select to authenticated using (true);
    create policy visits_existing_write on public.visits for all to authenticated using (true) with check (true);
    insert into public.visits values
      ('own-draft','patient-a','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','draft'),
      ('other-draft','patient-b','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','draft'),
      ('own-submitted','patient-a','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','submitted'),
      ('other-submitted','patient-b','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','submitted'),
      ('outside-facility','patient-c','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','submitted');
  `);
  await db.exec(migration);
  return db;
}

async function asRhu(db, stations) {
  await db.query("select set_config('test.uid',$1,false),set_config('test.facility',$2,false),set_config('test.role','rhu_personnel',false),set_config('test.stations',$3,false)", [
    '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', stations,
  ]);
  await db.exec('set role authenticated');
}

test('triage station direct reads see only own encounters in the assigned facility', async () => {
  const db = await setup();
  try {
    await asRhu(db, 'triage');
    assert.deepEqual((await db.query('select id from public.visits order by id')).rows.map((r) => r.id), ['own-draft', 'own-submitted']);
  } finally { await db.close(); }
});

test('consultation station direct reads exclude every draft and other facilities', async () => {
  const db = await setup();
  try {
    await asRhu(db, 'consultation');
    assert.deepEqual((await db.query('select id from public.visits order by id')).rows.map((r) => r.id), ['other-submitted', 'own-submitted']);
  } finally { await db.close(); }
});

test('RHU personnel with no assigned station cannot directly read visits', async () => {
  const db = await setup();
  try {
    await asRhu(db, '');
    assert.deepEqual((await db.query('select id from public.visits')).rows, []);
  } finally { await db.close(); }
});

test('authenticated direct clinical writes are denied despite older permissive RLS policies', async () => {
  const db = await setup();
  try {
    await asRhu(db, 'triage,consultation');
    await assert.rejects(() => db.exec("update public.visits set status='completed' where id='own-draft'"), /permission denied/i);
    await assert.rejects(() => db.exec("insert into public.visits(id) values ('bypass')"), /permission denied/i);
    await assert.rejects(() => db.exec("delete from public.visits where id='own-draft'"), /permission denied/i);
  } finally { await db.close(); }
});

test('trusted service-role writes remain available and the migration is repeatable', async () => {
  const db = await setup();
  try {
    await db.exec(migration);
    await db.exec('set role service_role');
    await db.exec("update public.visits set status='in_review' where id='own-submitted'");
    assert.equal((await db.query("select status from public.visits where id='own-submitted'")).rows[0].status, 'in_review');
  } finally { await db.close(); }
});

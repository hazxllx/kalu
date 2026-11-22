import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const USER = '11111111-1111-4111-8111-111111111111';
const NOTICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let database;

before(async () => {
  database = new PGlite();
  await database.exec(`
    create schema auth;
    create table auth.users(id uuid primary key);
    create table public.notifications(
      id uuid primary key default gen_random_uuid(),
      recipient_id uuid not null references auth.users(id),
      category text not null default 'information',
      title text not null,
      message text not null default '',
      related_type text not null default '',
      related_id text,
      created_at timestamptz not null default now()
    );
    create table public.residents(birth_date date);
    insert into auth.users(id) values ('${USER}');
    insert into public.notifications(id, recipient_id, title)
      values ('${NOTICE}', '${USER}', 'Existing notification');
  `);
  const migration = await readFile(
    new URL('../../supabase/migrations/20261122213000_resident_birthdate_and_notification_event_keys.sql', import.meta.url),
    'utf8',
  );
  await database.exec(migration);
});

after(async () => { if (database) await database.close(); });

test('migration preserves existing notification history and enforces unique event keys per recipient', async () => {
  const existing = (await database.query('select event_key from public.notifications where id = $1', [NOTICE])).rows[0];
  assert.equal(existing.event_key, `legacy:${NOTICE}`);

  await database.query(
    'insert into public.notifications(recipient_id, title, event_key) values ($1, $2, $3)',
    [USER, 'New event', 'resident-created:res-1'],
  );
  await assert.rejects(
    () => database.query(
      'insert into public.notifications(recipient_id, title, event_key) values ($1, $2, $3)',
      [USER, 'Duplicate event', 'resident-created:res-1'],
    ),
    (error) => error.code === '23505',
  );
});

test('database rejects future and out-of-range resident birth dates', async () => {
  await database.query("insert into public.residents(birth_date) values ('2000-02-29')");
  await assert.rejects(
    () => database.query("insert into public.residents(birth_date) values ('2999-01-01')"),
    (error) => error.code === '23514',
  );
  await assert.rejects(
    () => database.query("insert into public.residents(birth_date) values ('1800-01-01')"),
    (error) => error.code === '23514',
  );
  await assert.rejects(
    () => database.query("insert into public.residents(birth_date) values ('2000-02-30')"),
    (error) => error.code === '22008' || error.code === '22007',
  );
});

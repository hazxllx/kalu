import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { notificationFor } from '../src/services/operational.service.js';

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations/20261124090000_tb_followup_resident_notifications.sql',
);

test('TB record creation does not send an immediate generic resident notification', () => {
  assert.equal(notificationFor('tcl', 'created', { program: 'TB Patients' }), null);
  assert.deepEqual(notificationFor('tcl', 'created', { program: 'Diabetes' }), {
    category: 'information',
    title: 'Health program update',
    message: 'You were added to a health monitoring program.',
  });
});

test('TB follow-up notifications are resident-owned, date-based, cancellable, and idempotent', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
      create table public.residents (
        id text primary key,
        auth_user_id uuid,
        municipality_id uuid
      );
      create table public.tcl_entries (
        id uuid primary key,
        resident_id text not null,
        program text not null,
        next_visit date
      );
      create table public.notifications (
        id uuid primary key default gen_random_uuid(),
        recipient_id uuid not null,
        event_key text not null,
        category text not null,
        title text not null,
        message text not null,
        related_type text not null,
        related_id text,
        unique (recipient_id, event_key)
      );
      create function public.notification_account_can_receive(uuid, uuid)
      returns boolean language sql stable as $$ select $1 is not null $$;
      create function public.deliver_health_supervisor_general_notifications(timestamptz)
      returns jsonb language sql as $$ select '{"inserted":0}'::jsonb $$;
      create function public.deliver_calendar_activity_reminders(timestamptz)
      returns jsonb language sql as $$ select '{"inserted":0,"failed":0,"failures":[]}'::jsonb $$;
    `);
    await db.exec(await fs.readFile(migrationPath, 'utf8'));

    await db.exec(`
      insert into public.residents values
        ('resident-one', '11111111-1111-4111-8111-111111111111', null),
        ('resident-two', '22222222-2222-4222-8222-222222222222', null),
        ('resident-cancel', '33333333-3333-4333-8333-333333333333', null),
        ('resident-no-account', null, null);
      insert into public.tcl_entries values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'resident-one', 'TB Patients', '2026-07-15'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'resident-two', 'TB Monitoring', '2026-07-14'),
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'resident-two', 'Diabetes', '2026-07-14'),
        ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'resident-cancel', 'TB Patients', '2026-07-16'),
        ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'resident-no-account', 'TB Prevention (TPT)', '2026-07-14');
    `);

    const runWorker = async (now) => {
      const { rows } = await db.query(
        'select public.deliver_health_supervisor_reminders_at($1::timestamptz) as result',
        [now],
      );
      return rows[0].result;
    };

    assert.equal((await runWorker('2026-07-14T04:00:00Z')).inserted, 1);
    const firstRun = await db.query(
      'select recipient_id, title, message, related_type, related_id from public.notifications order by related_id',
    );
    assert.deepEqual(firstRun.rows.map((row) => row.recipient_id), ['22222222-2222-4222-8222-222222222222']);
    assert.equal(firstRun.rows[0].title, 'TB Follow-up Reminder');
    assert.match(firstRun.rows[0].message, /July 14, 2026/);
    assert.equal(firstRun.rows[0].related_type, 'tcl_entries');

    assert.equal((await runWorker('2026-07-14T05:00:00Z')).inserted, 0);
    await db.exec(`
      update public.tcl_entries
      set next_visit = '2026-07-16'
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    `);
    assert.equal((await runWorker('2026-07-15T04:00:00Z')).inserted, 0);

    await db.exec(`
      update public.tcl_entries
      set next_visit = null
      where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    `);
    assert.equal((await runWorker('2026-07-16T04:00:00Z')).inserted, 1);
    const updatedSchedule = await db.query(
      'select recipient_id, message from public.notifications where related_id = $1',
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    );
    assert.equal(updatedSchedule.rows[0].recipient_id, '11111111-1111-4111-8111-111111111111');
    assert.match(updatedSchedule.rows[0].message, /July 16, 2026/);
    assert.equal((await runWorker('2026-07-16T05:00:00Z')).inserted, 0);
  } finally {
    await db.close();
  }
});

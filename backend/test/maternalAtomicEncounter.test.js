import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const migrationUrl = new URL(
  '../../supabase/migrations/20261123130000_atomic_maternal_encounter_save.sql',
  import.meta.url,
);

test('maternal encounter and record changes commit or roll back together', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.profiles(id uuid primary key, status text, role text);
      create table public.residents(id text primary key, municipality_id uuid, barangay_id uuid);
      create table public.maternal_records(
        id uuid primary key, resident_id text, prenatal_visits integer not null default 0,
        tt_td_doses jsonb not null default '{}', prenatal_micronutrients jsonb not null default '{}',
        fim_status boolean, iodine_given_date date, deworming_date date,
        syphilis_screen_date date, syphilis_result text, hepb_screen_date date, hepb_result text,
        hiv_screen_date date, gdm_screen_date date, gdm_result text, cbc_screen_date date,
        cbc_result text, cbc_iron_given boolean, bmi numeric, delivery_date date,
        delivery_time text, delivery_outcome text, type_of_delivery text, birth_weight text,
        birth_weight_class text, place_of_delivery text, birth_attendant text,
        pregnancy_outcome text, pregnancy_outcome_date date, newborn_sex text, status text,
        pp_checkup_24h date, pp_checkup_day3 date, pp_checkup_7_14d date, pp_checkup_6wk date,
        iron_folic_completed_date date, vitamin_a_given_date date, updated_at timestamptz default now()
      );
      create table public.maternal_visits(
        id uuid primary key default gen_random_uuid(), resident_id text, maternal_case_id uuid,
        visit_date date not null, visit_type text not null, blood_pressure text,
        weight numeric, height_cm numeric, provider text, notes text, clinical_data jsonb,
        created_by uuid, client_operation_key text unique
      );
      create table public.health_audit_logs(
        id uuid primary key default gen_random_uuid(), actor_id uuid, action text,
        entity_type text, entity_id text, municipality_id uuid, barangay_id uuid
      );
    `);
    await db.exec(await readFile(migrationUrl, 'utf8'));
    await db.exec(`
      insert into public.profiles values ('00000000-0000-0000-0000-000000000001', 'active', 'phn');
      insert into public.residents values ('resident-1', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003');
      insert into public.maternal_records(id, resident_id, prenatal_visits, hepb_screen_date, hepb_result, syphilis_result)
      values ('00000000-0000-0000-0000-000000000004', 'resident-1', 4, '2026-03-01', '-', '-');
    `);

    const saved = await db.query(
      `select (public.save_maternal_encounter($1, $2, $3, $4, $5::jsonb, $6::jsonb)).id as id`,
      [
        '00000000-0000-0000-0000-000000000004',
        'resident-1',
        '00000000-0000-0000-0000-000000000001',
        'encounter-key-1',
        JSON.stringify({ syphilis_screen_date: '2026-04-02', syphilis_result: '+' }),
        JSON.stringify({
          visit_date: '2026-04-02',
          visit_type: 'prenatal',
          clinical_data: { prenatal: { syphilisScreenDate: '2026-04-02', syphilisResult: '+' } },
        }),
      ],
    );
    assert.ok(saved.rows[0].id);

    const record = await db.query(
      'select prenatal_visits, syphilis_result, hepb_screen_date, hepb_result from public.maternal_records where resident_id = $1',
      ['resident-1'],
    );
    assert.equal(record.rows[0].prenatal_visits, 5);
    assert.equal(record.rows[0].syphilis_result, '+');
    assert.equal(record.rows[0].hepb_screen_date.toISOString().slice(0, 10), '2026-03-01');
    assert.equal(record.rows[0].hepb_result, '-');

    const replay = await db.query(
      `select (public.save_maternal_encounter($1, $2, $3, $4, $5::jsonb, $6::jsonb)).id as id`,
      [
        '00000000-0000-0000-0000-000000000004',
        'resident-1',
        '00000000-0000-0000-0000-000000000001',
        'encounter-key-1',
        JSON.stringify({ syphilis_result: '-' }),
        JSON.stringify({ visit_date: '2026-04-03', visit_type: 'prenatal' }),
      ],
    );
    assert.equal(replay.rows[0].id, saved.rows[0].id);

    await db.exec(`
      create function public.reject_maternal_visit() returns trigger language plpgsql as $$
      begin raise exception 'test encounter rejection'; end;
      $$;
      create trigger reject_maternal_visit before insert on public.maternal_visits
      for each row execute function public.reject_maternal_visit();
    `);
    await assert.rejects(db.query(
      `select public.save_maternal_encounter($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        '00000000-0000-0000-0000-000000000004',
        'resident-1',
        '00000000-0000-0000-0000-000000000001',
        'encounter-key-failure',
        JSON.stringify({ syphilis_result: '-' }),
        JSON.stringify({ visit_date: '2026-04-03', visit_type: 'prenatal' }),
      ],
    ));

    const afterFailure = await db.query(
      'select prenatal_visits, syphilis_result from public.maternal_records where resident_id = $1',
      ['resident-1'],
    );
    const visits = await db.query('select count(*)::integer as count from public.maternal_visits');
    assert.deepEqual(afterFailure.rows[0], { prenatal_visits: 5, syphilis_result: '+' });
    assert.equal(visits.rows[0].count, 1);
  } finally {
    await db.close();
  }
});

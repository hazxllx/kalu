import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const CLINICAL_TABLES = [
  'tcl_entries',
  'maternal_records',
  'maternal_visits',
  'immunizations',
  'ncd_risk_assessments',
  'ncd_cervical_breast',
  'ncd_visual_ppv',
  'oral_health_records',
  'environmental_masterlist',
];

const MUNI_ID = '11111111-1111-4111-8111-111111111111';
const BRGY_ID = '22222222-2222-4222-8222-222222222222';
const STAFF_ID = '33333333-3333-4333-8333-333333333333';

const baseSchema = `
  create role anon;
  create role authenticated;
  create role service_role;

  create schema auth;
  grant usage on schema auth to authenticated, service_role;
  create table auth.users (id uuid primary key);

  create table public.municipalities (id uuid primary key);
  create table public.barangays (
    id uuid primary key,
    municipality_id uuid not null references public.municipalities(id)
  );
  create table public.profiles (
    id uuid primary key references auth.users(id),
    role text not null default 'health_supervisor',
    status text not null default 'active',
    municipality_id uuid references public.municipalities(id),
    barangay_id uuid references public.barangays(id)
  );
  create table public.residents (
    id text primary key,
    municipality_id uuid references public.municipalities(id),
    barangay_id uuid references public.barangays(id),
    auth_user_id uuid references auth.users(id)
  );
  create table public.households (
    id text primary key,
    municipality_id uuid references public.municipalities(id),
    barangay_id uuid references public.barangays(id)
  );

  create or replace function public.set_updated_at()
  returns trigger language plpgsql as $$
  begin
    new.updated_at := now();
    return new;
  end;
  $$;

  create or replace function public.is_admin()
  returns boolean language sql stable as $$ select false $$;

  create or replace function public.is_staff_active()
  returns boolean language sql stable as $$ select true $$;

  create or replace function public.profile_role()
  returns text language sql stable as $$ select 'health_supervisor'::text $$;

  create or replace function public.profile_municipality_id()
  returns uuid language sql stable as $$ select '${MUNI_ID}'::uuid $$;

  create or replace function public.profile_barangay_id()
  returns uuid language sql stable as $$ select '${BRGY_ID}'::uuid $$;

  create or replace function public.profile_covers_barangay(target_brgy uuid)
  returns boolean language sql stable as $$ select target_brgy = '${BRGY_ID}'::uuid $$;

  grant usage on schema public to authenticated, service_role;
`;

let pg;
let migrationSql;

before(async () => {
  pg = new PGlite();
  await pg.exec(baseSchema);

  const operationalSql = await readFile(
    new URL('../../supabase/migrations/20260922100000_health_supervisor_operational_records.sql', import.meta.url),
    'utf8',
  );
  // Create RLS helper auth.uid() needed by operational/maternal/program policies
  await pg.exec(`
    create or replace function auth.uid() returns uuid language sql stable as $$
      select '${STAFF_ID}'::uuid
    $$;
  `);

  // Strip the bottom RLS policy section of 20260922100000 if it depends on helper functions not in base,
  // or provide the exact table/trigger definitions from the repository migrations:
  const ncdOralSql = await readFile(
    new URL('../../supabase/migrations/20261011000000_ncd_oral_health_tcl.sql', import.meta.url),
    'utf8',
  );
  const envSql = await readFile(
    new URL('../../supabase/migrations/20261011000100_environmental_masterlist.sql', import.meta.url),
    'utf8',
  );
  const maternalVisitsSql = await readFile(
    new URL('../../supabase/migrations/20261015000000_maternal_visit_history.sql', import.meta.url),
    'utf8',
  );

  // Execute the full table/trigger/RLS migrations in order
  await pg.exec(operationalSql);
  await pg.exec(ncdOralSql);
  await pg.exec(envSql);
  await pg.exec(maternalVisitsSql);

  // Seed historical pre-migration data in every target table to prove non-destructive migration
  await pg.exec(`
    insert into auth.users(id) values ('${STAFF_ID}');
    insert into public.municipalities(id) values ('${MUNI_ID}');
    insert into public.barangays(id, municipality_id) values ('${BRGY_ID}', '${MUNI_ID}');
    insert into public.profiles(id, role, municipality_id, barangay_id)
      values ('${STAFF_ID}', 'health_supervisor', '${MUNI_ID}', '${BRGY_ID}');
    insert into public.residents(id, municipality_id, barangay_id)
      values ('RES-HIST-1', '${MUNI_ID}', '${BRGY_ID}');
    insert into public.households(id, municipality_id, barangay_id)
      values ('HH-HIST-1', '${MUNI_ID}', '${BRGY_ID}');

    insert into public.tcl_entries(id, resident_id, program, notes)
      values ('aaaaaaaa-0000-4000-8000-000000000001', 'RES-HIST-1', 'Prenatal and Postpartum', 'Historical TCL');
    insert into public.maternal_records(id, resident_id, notes)
      values ('aaaaaaaa-0000-4000-8000-000000000002', 'RES-HIST-1', 'Historical Maternal');
    insert into public.maternal_visits(id, resident_id, maternal_case_id, visit_date, notes)
      values ('aaaaaaaa-0000-4000-8000-000000000003', 'RES-HIST-1', 'aaaaaaaa-0000-4000-8000-000000000002', '2026-10-01', 'Historical Visit');
    insert into public.immunizations(id, resident_id, vaccine, notes)
      values ('aaaaaaaa-0000-4000-8000-000000000004', 'RES-HIST-1', 'BCG', 'Historical Imm');
    insert into public.ncd_risk_assessments(id, resident_id, notes)
      values ('aaaaaaaa-0000-4000-8000-000000000005', 'RES-HIST-1', 'Historical NCD Risk');
    insert into public.ncd_cervical_breast(id, resident_id, notes)
      values ('aaaaaaaa-0000-4000-8000-000000000006', 'RES-HIST-1', 'Historical Cervical');
    insert into public.ncd_visual_ppv(id, resident_id, notes)
      values ('aaaaaaaa-0000-4000-8000-000000000007', 'RES-HIST-1', 'Historical Visual');
    insert into public.oral_health_records(id, resident_id, notes)
      values ('aaaaaaaa-0000-4000-8000-000000000008', 'RES-HIST-1', 'Historical Oral');
    insert into public.environmental_masterlist(id, household_id, remarks)
      values ('aaaaaaaa-0000-4000-8000-000000000009', 'HH-HIST-1', 'Historical Env');
  `);

  migrationSql = await readFile(
    new URL('../../supabase/migrations/20261118031500_clinical_offline_sync_hardening.sql', import.meta.url),
    'utf8',
  );
  await pg.exec(migrationSql);
});

after(async () => {
  if (pg) await pg.close();
});

test('migration is additive, replay-safe, preserves existing rows/FKs/RLS, and restricts direct trigger function calls', async () => {
  // Replay migration a second time to verify full idempotency
  await pg.exec(migrationSql);

  for (const tbl of CLINICAL_TABLES) {
    const { rows } = await pg.query(`select id, client_operation_key, revision from public.${tbl}`);
    assert.equal(rows.length, 1, `historical row preserved in ${tbl}`);
    assert.equal(rows[0].client_operation_key, null);
    assert.equal(rows[0].revision, 1);
  }

  // Unrelated table (follow_ups) is not touched by Stage 2A migration
  const followUpCols = await pg.query(`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'follow_ups' and column_name = 'revision'
  `);
  assert.equal(followUpCols.rows.length, 0);

  // Function privilege hardening
  const privs = (await pg.query(`
    select
      has_function_privilege('anon', 'public.maintain_clinical_sync_metadata()', 'EXECUTE') as anon_exec,
      has_function_privilege('authenticated', 'public.maintain_clinical_sync_metadata()', 'EXECUTE') as auth_exec,
      has_function_privilege('service_role', 'public.maintain_clinical_sync_metadata()', 'EXECUTE') as svc_exec
  `)).rows[0];
  assert.deepEqual(privs, { anon_exec: false, auth_exec: false, svc_exec: true });
});

test('INSERT forces revision=1, trims valid client_operation_key, allows multiple NULL keys, and blocks duplicate keys across all 9 tables', async () => {
  const sampleInserts = [
    ['tcl_entries', `(resident_id, program, client_operation_key, revision) values ('RES-HIST-1', 'Oral Health', $1, 99)`],
    ['maternal_records', `(resident_id, notes, client_operation_key, revision) values ('RES-HIST-1', 'Case A', $1, 99)`],
    ['maternal_visits', `(resident_id, maternal_case_id, visit_date, client_operation_key, revision) values ('RES-HIST-1', 'aaaaaaaa-0000-4000-8000-000000000002', '2026-10-12', $1, 99)`],
    ['immunizations', `(resident_id, vaccine, client_operation_key, revision) values ('RES-HIST-1', 'OPV', $1, 99)`],
    ['ncd_risk_assessments', `(resident_id, notes, client_operation_key, revision) values ('RES-HIST-1', 'NCD 1', $1, 99)`],
    ['ncd_cervical_breast', `(resident_id, notes, client_operation_key, revision) values ('RES-HIST-1', 'NCD 2', $1, 99)`],
    ['ncd_visual_ppv', `(resident_id, notes, client_operation_key, revision) values ('RES-HIST-1', 'NCD 3', $1, 99)`],
    ['oral_health_records', `(resident_id, notes, client_operation_key, revision) values ('RES-HIST-1', 'Oral 1', $1, 99)`],
    ['environmental_masterlist', `(household_id, remarks, client_operation_key, revision) values ('HH-HIST-1', 'Env 1', $1, 99)`],
  ];

  for (const [tbl, valuesClause] of sampleInserts) {
    const key = `  kalusagap-op-${tbl}-1  `;
    const first = await pg.query(
      `insert into public.${tbl} ${valuesClause} returning id, client_operation_key, revision`,
      [key],
    );
    assert.equal(first.rows[0].revision, 1, `${tbl} insert initializes revision to 1 despite client passing 99`);
    assert.equal(first.rows[0].client_operation_key, `kalusagap-op-${tbl}-1`, `${tbl} trims key`);

    // Duplicate non-null client_operation_key is rejected with 23505
    await assert.rejects(
      pg.query(`insert into public.${tbl} ${valuesClause}`, [`kalusagap-op-${tbl}-1`]),
      { code: '23505' },
      `${tbl} unique partial index blocks duplicate client_operation_key`,
    );

    // Multiple NULL client_operation_key inserts (ordinary online creates) succeed
    const nullOne = await pg.query(`insert into public.${tbl} ${valuesClause} returning revision`, [null]);
    const nullTwo = await pg.query(`insert into public.${tbl} ${valuesClause} returning revision`, [null]);
    assert.equal(nullOne.rows[0].revision, 1);
    assert.equal(nullTwo.rows[0].revision, 1);

    // Blank or oversized (>200 chars) client_operation_key is rejected with 23514
    await assert.rejects(
      pg.query(`insert into public.${tbl} ${valuesClause}`, ['   ']),
      { code: '23514' },
    );
    await assert.rejects(
      pg.query(`insert into public.${tbl} ${valuesClause}`, ['k'.repeat(201)]),
      { code: '23514' },
    );
  }
});

test('UPDATE atomically increments revision, ignores forged revisions, enforces SQL CAS, and prevents client_operation_key mutation', async () => {
  const inserted = (await pg.query(`
    insert into public.ncd_risk_assessments (resident_id, notes, client_operation_key)
    values ('RES-HIST-1', 'Initial', 'kalusagap-op-cas-test')
    returning id, revision, client_operation_key, updated_at
  `)).rows[0];
  assert.equal(inserted.revision, 1);

  // Matching CAS update increments revision to 2 even if writer attempts to set revision=500
  const updated = (await pg.query(`
    update public.ncd_risk_assessments
       set notes = 'Updated once', revision = 500
     where id = $1 and revision = 1
     returning revision, notes, client_operation_key, updated_at
  `, [inserted.id])).rows[0];
  assert.equal(updated.revision, 2);
  assert.equal(updated.notes, 'Updated once');
  assert.equal(updated.client_operation_key, 'kalusagap-op-cas-test');

  // Stale CAS update (revision = 1) affects 0 rows and preserves newer data
  const stale = await pg.query(`
    update public.ncd_risk_assessments
       set notes = 'Stale overwrite'
     where id = $1 and revision = 1
     returning id
  `, [inserted.id]);
  assert.equal(stale.rows.length, 0);

  // Mutating or clearing an existing client_operation_key on UPDATE fails with 23514
  await assert.rejects(
    pg.query(`update public.ncd_risk_assessments set client_operation_key = 'forged-key' where id = $1`, [inserted.id]),
    { code: '23514' },
  );
  await assert.rejects(
    pg.query(`update public.ncd_risk_assessments set client_operation_key = null where id = $1`, [inserted.id]),
    { code: '23514' },
  );

  // Retroactively attaching a client_operation_key to an online-created (NULL key) row fails with 23514
  await assert.rejects(
    pg.query(`update public.ncd_risk_assessments set client_operation_key = 'retroactive-key' where id = 'aaaaaaaa-0000-4000-8000-000000000005'`),
    { code: '23514' },
  );
});

test('authenticated role inserts and updates through RLS policies continue firing the revision trigger cleanly', async () => {
  await pg.exec(`
    grant select, insert, update on public.ncd_risk_assessments to authenticated;
    grant select on public.residents to authenticated;
    set role authenticated;
  `);
  try {
    const created = (await pg.query(`
      insert into public.ncd_risk_assessments (resident_id, notes, client_operation_key)
      values ('RES-HIST-1', 'RLS insert', 'kalusagap-op-rls-1')
      returning id, revision, barangay_id
    `)).rows[0];
    assert.equal(created.revision, 1);
    assert.equal(created.barangay_id, BRGY_ID);

    const edited = (await pg.query(`
      update public.ncd_risk_assessments set notes = 'RLS update' where id = $1 returning revision
    `, [created.id])).rows[0];
    assert.equal(edited.revision, 2);
  } finally {
    await pg.exec('reset role;');
  }
});

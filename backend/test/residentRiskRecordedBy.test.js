import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('risk summary returns the recorder for the same eligible visit used by clinical screening', async () => {
  const pg = new PGlite();
  const actor = '30000000-0000-4000-8000-000000000001';
  const municipality = '10000000-0000-4000-8000-000000000001';
  const barangay = '20000000-0000-4000-8000-000000000001';

  try {
    await pg.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table profiles(id uuid primary key, status text, role text, municipality_id uuid, barangay_id uuid);
      create table barangays(id uuid primary key, name text, municipality_id uuid, status text);
      create table residents(
        id text primary key, first_name text, middle_name text, last_name text, suffix text,
        birth_date date, sex text, barangay text, barangay_id uuid, municipality_id uuid,
        zone smallint, risk_level text
      );
      create table visits(
        id text primary key, resident_id text, status text, bp text, o2sat numeric, temperature numeric,
        hr numeric, rr numeric, height_cm numeric, weight_kg numeric, visit_date timestamptz,
        created_at timestamptz, updated_at timestamptz, recorded_by_name text
      );
      create table follow_ups(resident_id text, status text);
      create function public.personnel_actor_has_permission(uuid,text) returns boolean language sql stable as $$select true$$;
      create function public.analytics_risk_configuration() returns jsonb language sql stable as $$select '{}'::jsonb$$;
      create function public.analytics_resident_risk(text,jsonb,boolean) returns jsonb language sql stable as
        $$select '{"riskLevel":"Low","riskAssessmentStatus":"assessed","riskScore":1,"riskFactors":[]}'::jsonb$$;
      create function public.analytics_risk_timestamp(text) returns timestamptz language sql immutable as $$select $1::timestamptz$$;
      create function public.analytics_clinical_screening_for_resident(text) returns jsonb
      language sql stable as $$
        select jsonb_build_object(
          'assessmentAt', coalesce(v.visit_date, v.created_at),
          'classifications', jsonb_build_object(
            'heartRate', jsonb_build_object('value', v.hr, 'classification', 'Normal')
          )
        )
        from visits v
        where v.resident_id = $1 and v.status not in ('draft','submitted')
          and (nullif(btrim(v.bp), '') is not null or v.o2sat is not null or v.temperature is not null
            or v.hr is not null or v.rr is not null or v.height_cm is not null or v.weight_kg is not null)
        order by coalesce(v.visit_date, v.created_at) desc, v.updated_at desc, v.created_at desc, v.id desc
        limit 1
      $$;
      insert into profiles values ('${actor}','active','phn','${municipality}',null);
      insert into barangays values ('${barangay}','Sample Barangay','${municipality}','Active');
      insert into residents(id,first_name,last_name,barangay_id,municipality_id)
        values ('resident-1','Sample','Resident','${barangay}','${municipality}');
      insert into visits(id,resident_id,status,hr,visit_date,created_at,updated_at,recorded_by_name) values
        ('eligible-visit','resident-1','completed',72,'2026-04-04T08:00:00Z','2026-04-04T08:00:00Z','2026-04-04T08:00:00Z','Correct Assessor'),
        ('newer-draft','resident-1','draft',88,'2026-04-05T08:00:00Z','2026-04-05T08:00:00Z','2026-04-05T08:00:00Z','Draft Author');
    `);

    const migration = await readFile(new URL('../../supabase/migrations/20261203100000_resident_risk_recorded_by_assessment.sql', import.meta.url), 'utf8');
    await pg.exec(migration);
    const result = await pg.query(
      'select public.resident_risk_summary_records($1,null,null,null,null,null,null,null,null,25,0) as result',
      [actor],
    );

    assert.equal(result.rows[0].result.rows[0].responsiblePersonnel, 'Correct Assessor');
    assert.equal(result.rows[0].result.rows[0].clinicalScreening.assessmentAt, '2026-04-04T08:00:00+00:00');
  } finally {
    await pg.close();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('clinical details return the selected resident’s complete visit history within authorized scope', async () => {
  const pg = new PGlite();
  const actor = '30000000-0000-4000-8000-000000000001';
  const municipality = '10000000-0000-4000-8000-000000000001';
  const barangay = '20000000-0000-4000-8000-000000000001';
  const service = '40000000-0000-4000-8000-000000000001';

  try {
    await pg.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table profiles(id uuid primary key, status text, role text, municipality_id uuid, barangay_id uuid);
      create table barangays(id uuid primary key, name text);
      create table residents(
        id text primary key, municipality_id uuid, barangay_id uuid, birth_date date,
        first_name text, middle_name text, last_name text, suffix text, sex text, barangay text
      );
      create table health_services(id uuid primary key, name text, category text);
      create table risk_criteria(code text primary key, description text);
      create table visits(
        id text primary key, resident_id text, status text, visit_date timestamptz, recorded_at timestamptz,
        created_at timestamptz, updated_at timestamptz, recorded_by_name text, phn_personnel text,
        health_service_id uuid, health_service_name text, bp text, hr numeric, rr numeric, o2sat numeric,
        temperature numeric, height_cm numeric, weight_kg numeric, bmi numeric, bmi_category text, blood_sugar numeric,
        chief_complaint text, clinical_history text, findings text, treatment_given text, recommendation text,
        phn_assessment text, phn_notes text, consultation_details jsonb, triage_snapshot jsonb
      );
      create function public.personnel_actor_has_permission(uuid,text) returns boolean language sql stable as $$select true$$;
      create function public.analytics_risk_configuration() returns jsonb language sql stable as $$select '{}'::jsonb$$;
      create function public.analytics_resident_risk(text,jsonb,boolean) returns jsonb language sql stable as $$
        select case when $1 = 'no-records' then jsonb_build_object(
          'riskLevel',null,'riskAssessmentStatus','unavailable','riskAssessedAt',null,
          'riskScore',null,'riskReason',null,'riskFactors','[]'::jsonb
        ) else jsonb_build_object(
          'riskLevel','High','riskAssessmentStatus','assessed','riskAssessedAt','2026-04-04T08:00:00Z',
          'riskScore',70,'riskReason','Severe blood pressure',
          'riskFactors',jsonb_build_array(jsonb_build_object(
            'code','bp_severe','name','Blood Pressure – Severe','field','systolic','measured',180,'weight',70
          ))
        ) end
      $$;
      insert into profiles values ('${actor}','active','phn','${municipality}',null);
      insert into barangays values ('${barangay}','San Isidro');
      insert into residents(id,municipality_id,barangay_id,birth_date,first_name,middle_name,last_name,suffix,sex,barangay)
        values ('resident-1','${municipality}','${barangay}','1990-01-01','Resident','','One','','Female','San Isidro');
      insert into residents(id,municipality_id,barangay_id,birth_date,first_name,middle_name,last_name,suffix,sex,barangay)
        values ('other-resident','${municipality}','${barangay}','1980-01-01','Other','','Resident','','Male','San Isidro');
      insert into residents(id,municipality_id,barangay_id,birth_date,first_name,middle_name,last_name,suffix,sex,barangay)
        values ('no-records','${municipality}','${barangay}',null,'No','','Records','','','San Isidro');
      insert into health_services values ('${service}','NCD Screening','NCD');
      insert into risk_criteria values ('bp_severe','Severe blood pressure recorded under the configured risk criteria.');
      insert into visits(id,resident_id,status,visit_date,created_at,updated_at,recorded_by_name,phn_personnel,
        health_service_id,health_service_name,bp,hr,rr,o2sat,temperature,height_cm,weight_kg,bmi,bmi_category,
        blood_sugar,chief_complaint,findings,phn_assessment,consultation_details,triage_snapshot) values
        ('visit-new','resident-1','completed','2026-04-04T08:00:00Z','2026-04-04T08:00:00Z','2026-04-04T08:00:00Z',
          'Recorder One','Assessor One','${service}','NCD Screening','120/80',72,16,98,36.8,170,65,22.5,'Normal',
          91,'Routine check','No acute findings','Reviewed',
          '{"clinicalAssessmentHistory":[{"status":"reviewed"}]}','{"vitals":{"bp":"120/80"}}'),
        ('visit-old','resident-1','referred','2025-03-02T07:00:00Z','2025-03-02T07:00:00Z','2025-03-02T07:00:00Z',
          'Recorder Two','Assessor Two',null,'','',null,null,null,null,null,null,null,'',null,'','', '',
          '{"diagnosis":"Historical note"}','{}'),
        ('draft','resident-1','draft','2026-05-01T08:00:00Z','2026-05-01T08:00:00Z','2026-05-01T08:00:00Z',
          'Draft Recorder','',null,'','',null,null,null,null,null,null,null,'',null,'','', '',null,null),
        ('other-visit','other-resident','completed','2026-04-05T08:00:00Z','2026-04-05T08:00:00Z','2026-04-05T08:00:00Z',
          'Other Recorder','',null,'','130/90',null,null,null,null,null,null,null,'',null,'','', '',null,null);
    `);

    const migration = await readFile(new URL('../../supabase/migrations/20261204100000_resident_risk_clinical_details.sql', import.meta.url), 'utf8');
    await pg.exec(migration);
    const { rows } = await pg.query('select public.resident_risk_clinical_details($1,$2) as result', [actor, 'resident-1']);
    const result = rows[0].result;

    assert.equal(result.residentId, 'resident-1');
    assert.deepEqual(result.resident, {
      id: 'resident-1', name: 'Resident One', barangay: 'San Isidro', age: 36, sex: 'Female',
    });
    assert.equal(result.riskLevel, 'High');
    assert.equal(result.riskAssessmentStatus, 'assessed');
    assert.equal(result.riskFactors[0].description, 'Severe blood pressure recorded under the configured risk criteria.');
    assert.deepEqual(result.assessments.map((assessment) => assessment.id), ['visit-new', 'visit-old']);
    assert.equal(result.assessments[0].measurements.bloodSugar, 91);
    assert.equal(result.assessments[0].measurements.bmiCategory, 'Normal');
    assert.equal(result.assessments[0].assessmentCategory, 'NCD');
    assert.equal(result.assessments[0].recordedBy, 'Recorder One');
    assert.equal(result.assessments[0].performedBy, 'Assessor One');
    assert.equal(result.assessments[1].assessmentDetails.consultationDetails.diagnosis, 'Historical note');

    const emptyResult = await pg.query(
      'select public.resident_risk_clinical_details($1,$2) as result', [actor, 'no-records'],
    );
    assert.deepEqual(emptyResult.rows[0].result.assessments, []);
    assert.deepEqual(emptyResult.rows[0].result.riskFactors, []);
    assert.equal(emptyResult.rows[0].result.riskLevel, null);

    await assert.rejects(
      pg.query('select public.resident_risk_clinical_details($1,$2)', [actor, 'outside-scope']),
      (error) => error.code === '42501',
    );
  } finally {
    await pg.close();
  }
});

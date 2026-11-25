import assert from 'node:assert/strict';
import test, { before, beforeEach, after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { assessVisitRisk } from '../src/utils/residentRisk.js';
import { DEFAULT_RISK_CONFIG } from '../src/config/riskConfig.js';

let pg; let municipalityId; let barangayId; let actorId; let otherId;
before(async () => {
  pg = new PGlite({ extensions: { pgcrypto } });
  // Supabase platform shims only. Every application table/function/policy comes from real migrations.
  await pg.exec(`create schema auth; create schema storage;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
    create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb not null default '{}',
      raw_app_meta_data jsonb not null default '{}',email_confirmed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    create policy objects_owner on storage.objects for all to authenticated using(owner=auth.uid()) with check(owner=auth.uid());
    select set_config('request.jwt.claim.role','service_role',false);`);
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) await pg.exec(await readFile(new URL(name, directory), 'utf8'));
  municipalityId = randomUUID(); barangayId = randomUUID(); actorId = randomUUID(); otherId = randomUUID();
  await pg.query('insert into municipalities(id,name) values($1,$2)', [municipalityId, 'Consultation integrity test']);
  await pg.query('insert into barangays(id,municipality_id,name) values($1,$2,$3)', [barangayId, municipalityId, 'San Isidro']);
  for (const id of [actorId, otherId]) await pg.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.test`]);
  await pg.query("update profiles set role='phn',status='active',municipality_id=$2,barangay_id=$3 where id=$1", [actorId, municipalityId, barangayId]);
  await pg.query("update profiles set role='health_supervisor',status='active',municipality_id=$2,barangay_id=$3,rhu_stations='{}' where id=$1", [otherId, municipalityId, barangayId]);
  await pg.exec("insert into role_permissions(role,permission_id,granted) values('phn','reports.analytics.view',true) on conflict(role,permission_id) do update set granted=true");
  await pg.query(`insert into residents(id,health_record_no,first_name,last_name,municipality_id,barangay_id,barangay,birth_date)
    values('CLINICAL-A','CLINICAL-HR-A','Clinical','A',$1,$2,'San Isidro','1990-01-01'),
      ('CLINICAL-B','CLINICAL-HR-B','Clinical','B',$1,$2,'San Isidro','1990-01-01'),
      ('CLINICAL-C','CLINICAL-HR-C','Clinical','C',$1,$2,'San Isidro','2012-01-01')`, [municipalityId, barangayId]);
});
beforeEach(async () => { await pg.exec("reset role; select set_config('request.jwt.claim.role','service_role',false); truncate visits cascade; truncate maternal_records cascade; delete from maternal_pregnancies; delete from clinical_assessment_protocols;"); });
after(async () => { if (pg) await pg.close(); });

const screening = (level = 'Low', extra = {}) => ({ level, computedLevel: level, status: 'assessed', version: 'consultation-screening-v1',
  ruleVersion: 'consultation-screening-v1', decisionSupport: true, reviewStatus: 'professional_review_required', sourceStatus: 'available',
  assessedBy: actorId, assessedByRole: 'phn', assessedAt: new Date().toISOString(), reasons: [{ ruleId: 'screening_test', message: 'Recorded screening evidence.' }],
  missingMeasurements: [], ...extra });
const detail = (risk = null, extra = {}) => ({ consultationDate: '2026-11-22', consultationTime: '09:00', findings: 'Professional findings',
  clinicalIndicators: { dangerSignsReviewed: true }, clinicalIntegrityVersion: 'consultation-clinical-v1',
  ...(risk ? { consultationRiskAssessment: risk, consultationRiskAssessmentHistory: [risk] } : {}), ...extra });
const insert = ({ id = 'CURRENT', residentId = 'CLINICAL-A', details = detail(screening()), overrides = {}, date = '2026-11-22T09:00:00+08:00', medications = [] } = {}) => {
  const values = { bp: '118/76', o2sat: 98, temperature: 36.8, hr: 72, rr: 18, height: 170, weight: 65, bmi: 99, ...overrides };
  return pg.query(`insert into visits(id,resident_id,recorded_by_id,recorded_by_role,status,visit_date,
    bp,o2sat,temperature,hr,rr,height_cm,weight_kg,bmi,findings,consultation_details,medications)
    values($1,$2,$3,'phn','completed',$4,$5,$6,$7,$8,$9,$10,$11,$12,'Professional findings',$13::jsonb,$14::jsonb) returning *`,
  [id, residentId, actorId, date, values.bp, values.o2sat, values.temperature, values.hr, values.rr, values.height, values.weight, values.bmi, JSON.stringify(details), JSON.stringify(medications)]);
};
const stored = async (id = 'CURRENT') => (await pg.query('select * from visits where id=$1', [id])).rows[0];
const saveDetails = (details, id = 'CURRENT') => pg.query('update visits set consultation_details=$1::jsonb where id=$2', [JSON.stringify(details), id]);
const visitDto = (row) => ({ id: row.id, residentId: row.resident_id, consultationDetails: row.consultation_details,
  visitDate: row.visit_date instanceof Date ? row.visit_date.toISOString() : row.visit_date, createdAt: row.created_at, updatedAt: row.updated_at,
  vitals: { bp: row.bp, o2sat: row.o2sat, temperature: row.temperature, hr: row.hr, rr: row.rr, heightCm: row.height_cm, weightKg: row.weight_kg } });
const compareRisk = async (id = 'CURRENT') => {
  const rows = (await pg.query('select * from visits')).rows.map(visitDto);
  const js = assessVisitRisk(rows.find((row) => row.id === id), DEFAULT_RISK_CONFIG, rows);
  const sql = (await pg.query('select analytics_assess_saved_visit($1,$2::jsonb,true) as risk', [id, JSON.stringify(DEFAULT_RISK_CONFIG)])).rows[0].risk;
  assert.deepEqual([sql.riskLevel, sql.riskScore, sql.riskAssessmentStatus, sql.missingMeasurements, sql.riskReason, sql.riskFactors],
    [js.level, js.score, js.status, js.missingMeasurements, js.reason, js.factors]);
  if (js.previousAssessment) assert.deepEqual(sql.previousAssessment, js.previousAssessment);
  return sql;
};

test('new completed records require complete plausible measurements and real Manila date/time; BMI cannot be forged', async () => {
  for (const field of ['o2sat','temperature','hr','rr','height','weight']) await assert.rejects(insert({ overrides: { [field]: null } }), { code: '23514' });
  for (const overrides of [{ bp: '0/0' }, { bp: '120/150' }, { temperature: 0 }, { o2sat: 101 }, { hr: 'NaN' }]) await assert.rejects(insert({ overrides }), { code: '23514' });
  await assert.rejects(insert({ details: detail(screening(), { consultationDate: '2026-02-30' }) }));
  await assert.rejects(insert({ details: detail(screening(), { consultationTime: '24:00' }) }), { code: '23514' });
  await assert.rejects(insert({ date: '2026-11-22T09:00:00Z' }), { code: '23514' });
  const row = (await insert()).rows[0]; assert.equal(Number(row.bmi), 22.5); assert.equal(row.bmi_category, 'Normal');
  assert.equal((await pg.query("select consultation_date::text as date from visits where id='CURRENT'")).rows[0].date, '2026-11-22');
});

test('database BP snapshots use inclusive five-category thresholds and retain pediatric assessment', async () => {
  for (const [systolic, diastolic, category] of [
    [115, 75, 'Normal'], [120, 80, 'Normal'], [121, 80, 'Elevated'], [120, 81, 'Stage 1 Hypertension'],
    [145, 85, 'Stage 2 Hypertension'], [180, 85, 'Hypertensive Crisis'], [150, 120, 'Hypertensive Crisis'],
  ]) {
    const result = (await pg.query('select public.bp_classification_json($1,$2,false) as classification', [systolic, diastolic])).rows[0].classification;
    assert.equal(result.category, category);
  }
  const pediatric = (await insert({ residentId: 'CLINICAL-C', overrides: { bp: '135/85' } })).rows[0];
  assert.equal(pediatric.bp_classification.category, 'Age-specific BP Assessment');
  const pediatricCrisis = (await insert({ id: 'PEDIATRIC-CRISIS', residentId: 'CLINICAL-C', overrides: { bp: '180/85' } })).rows[0];
  assert.equal(pediatricCrisis.bp_classification.category, 'Hypertensive Crisis');
});

test('historical partial visits remain partial through metadata changes and never fabricate legacy Low', async () => {
  await insert({ details: { remarks: 'Historical' }, overrides: { bp: '', o2sat: null, temperature: null, hr: null, rr: null, height: null, weight: null, bmi: null } });
  const before = await stored(); await saveDetails({ remarks: 'Administrative correction' }); const after = await stored();
  assert.equal(after.bp, ''); assert.equal(after.bmi, null); assert.deepEqual(after.visit_date, before.visit_date);
  const risk = await compareRisk(); assert.equal(risk.riskLevel, null); assert.equal(risk.riskAssessmentStatus, 'unavailable');
});

test('saved screening has SQL/JS parity and all bounded RPC/aggregate consumers honor it', async () => {
  await insert({ overrides: { bp: '150/95' }, details: detail(screening('Medium')) });
  const risk = await compareRisk(); assert.equal(risk.riskLevel, 'Moderate'); assert.equal(risk.riskSource, 'consultation_screening');
  const detailRisk = (await pg.query('select resident_risk_for_ids($1::text[],$2::uuid) as risk', [['CLINICAL-A'], actorId])).rows[0].risk;
  assert.equal(detailRisk[0].riskLevel, 'Moderate'); assert.equal(detailRisk[0].consultationRiskAssessment.level, 'Medium');
  const summary = (await pg.query('select resident_risk_summary($1,null,10,0) as risk', [actorId])).rows[0].risk;
  assert.equal(summary.summary.moderate, 1); assert.equal(summary.summary.high, 0);
  await pg.query('select recalculate_resident_risk($1,$2)', [null, municipalityId]);
  assert.equal((await pg.query("select risk_level from residents where id='CLINICAL-A'")).rows[0].risk_level, 'Moderate');
  const ew = (await pg.query("select scoped_aggregate_analytics($1,'early-warning') as risk", [actorId])).rows[0].risk;
  assert.equal(ew.riskDistribution.find((row) => row.name === 'Moderate Risk')?.value, 1);
});

test('positive legacy weighted High is retained by actual consultation dates until an authorized reasoned review', async () => {
  await insert({ id: 'LEGACY-HIGH', details: { consultationDate: '2026-10-20', consultationTime: '09:00' }, date: '2026-10-20T09:00:00+08:00', overrides: { bp: '160/100', o2sat: 88 } });
  await pg.exec("update visits set created_at='2026-11-30T00:00:00Z' where id='LEGACY-HIGH'");
  await assert.rejects(insert(), { code: '23514' });
  await insert({ details: detail(screening('High', { previousHighHeld: true })) });
  const held = await compareRisk(); assert.equal(held.riskLevel, 'High'); assert.equal(held.previousAssessment.sourceVisitId, 'LEGACY-HIGH');
  assert.ok(held.previousAssessment.reasons[0].message.includes('recorded legacy risk evidence'));
  const old = (await stored()).consultation_details;
  const low = screening('Low');
  await assert.rejects(saveDetails({ ...old, consultationRiskAssessment: low, consultationRiskAssessmentHistory: [...old.consultationRiskAssessmentHistory, low] }), { code: '23514' });
  const review = { level: 'Low', reason: 'Repeat clinical examination confirms resolved prior findings.', reassessmentConfirmed: true,
    reviewedBy: actorId, reviewedByRole: 'phn', reviewedAt: new Date().toISOString() };
  const reassessed = screening('Low', { review });
  await saveDetails({ ...old, consultationRiskAssessment: reassessed, consultationRiskAssessmentHistory: [...old.consultationRiskAssessmentHistory, reassessed], riskReviewHistory: [review] });
  assert.equal((await compareRisk()).riskLevel, 'Low');
  const summary = (await pg.query('select resident_risk_summary($1,null,10,0) as risk', [actorId])).rows[0].risk;
  assert.equal(summary.summary.high, 0);
});

test('screening actor/history cannot be replaced, stripped, forged into protocol approval or downgraded by unlicensed review', async () => {
  await insert({ details: detail(screening('High')) }); const original = (await stored()).consultation_details;
  await assert.rejects(saveDetails({ ...original, consultationRiskAssessmentHistory: [] }), { code: '23514' });
  await assert.rejects(saveDetails({ ...original, consultationRiskAssessment: { ...original.consultationRiskAssessment, assessedBy: otherId } }), { code: '23514' });
  const fake = screening('Low', { reviewStatus: 'approved' });
  await assert.rejects(saveDetails({ ...original, consultationRiskAssessment: fake, consultationRiskAssessmentHistory: [...original.consultationRiskAssessmentHistory, fake] }), { code: '23514' });
  const review = { level: 'Low', reason: 'Claimed clinical reassessment', reassessmentConfirmed: true, reviewedBy: otherId,
    reviewedByRole: 'health_supervisor', clinicianAuthority: 'consultation_station', reviewedAt: new Date().toISOString() };
  const reviewed = screening('Low', { review });
  await assert.rejects(saveDetails({ ...original, consultationRiskAssessment: reviewed, consultationRiskAssessmentHistory: [...original.consultationRiskAssessmentHistory, reviewed], riskReviewHistory: [review] }), { code: '42501' });
  const permissions = (await pg.query("select has_function_privilege('authenticated','analytics_assess_saved_visit(text,jsonb,boolean)','EXECUTE') as browser, has_function_privilege('service_role','analytics_assess_saved_visit(text,jsonb,boolean)','EXECUTE') as backend")).rows[0];
  assert.deepEqual(permissions, { browser: false, backend: true });
});

test('approved clinicalAssessment cannot be claimed without a matching active local clinical protocol', async () => {
  const clinicalAssessment = { level: 'Low', reviewStatus: 'approved', protocolVersion: 'fabricated',
    approval: { approvedBy: actorId, approvedAt: new Date().toISOString(), reviewReference: 'fabricated' }, inputs: { thresholds: {} } };
  await assert.rejects(insert({ details: detail(screening(), { clinicalAssessment, clinicalAssessmentHistory: [clinicalAssessment] }) }), { code: '23514' });
});

test('new/changed prescriptions use predefined choices while exact historical entries are preserved', async () => {
  const medication = { genericName: 'Test custom', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', duration: '3 days', quantity: '3', instructions: '', custom: true, source: 'custom' };
  await assert.rejects(insert({ medications: [{ ...medication, route: 'Arbitrary route' }] }), { code: '23514' });
  await assert.rejects(insert({ medications: [{ ...medication, quantity: '0' }] }), { code: '23514' });
  await insert({ id: 'LEGACY-MED', details: {}, medications: [{ ...medication, route: 'Shipped legacy route' }] });
  await pg.query('update visits set consultation_details=$1::jsonb where id=$2', [JSON.stringify(detail(screening())), 'LEGACY-MED']);
  assert.equal((await stored('LEGACY-MED')).medications[0].route, 'Shipped legacy route');
});

test('same-resident maternal episode linkage is enforced without creating pregnancy rows per visit', async () => {
  const pregnancyId = randomUUID();
  await pg.query("insert into maternal_pregnancies(id,resident_id,date_of_registration,lmp_date,edd_date,status) values($1,'CLINICAL-A','2026-07-01','2026-06-01','2027-03-08','active')", [pregnancyId]);
  await assert.rejects(pg.query("insert into maternal_records(resident_id,pregnancy_id,status) values('CLINICAL-B',$1,'Active')", [pregnancyId]), { code: '23514' });
  await pg.query("insert into maternal_records(resident_id,pregnancy_id,status) values('CLINICAL-A',$1,'Active')", [pregnancyId]);
  await insert();
  assert.equal((await pg.query('select count(*)::integer as count from maternal_pregnancies')).rows[0].count, 1);
  assert.equal((await pg.query('select count(*)::integer as count from maternal_records')).rows[0].count, 1);
});

test('immutable service-time reporting scope cannot be supplied by clients or rewritten with mutable operational geography', async () => {
  const reportingScope = { municipalityId, barangayId };
  await assert.rejects(insert({ details: detail(screening(), { reportingScope: { municipalityId, barangayId: randomUUID() } }) }), { code: '23514' });
  await insert({ details: detail(screening(), { reportingScope }) });
  const original = (await stored()).consultation_details;
  await assert.rejects(saveDetails({ ...original, reportingScope: { municipalityId, barangayId: null } }), { code: '23514' });
  await pg.query("update visits set municipality_id=$1,barangay_id=null where id='CURRENT'", [municipalityId]);
  assert.deepEqual((await stored()).consultation_details.reportingScope, reportingScope);
});

test('malformed legacy reason containers and null aliases remain readable with SQL/JS parity', async () => {
  for (const [index, reasons] of ['Stable', { text: 'Historical rationale' }, [{ ruleId: 42, field: {}, message: true }]].entries()) {
    // Simulate already-shipped data in this in-memory database only; new legacy aliases stay blocked.
    await pg.exec('alter table visits disable trigger visits_consultation_clinical_integrity');
    try {
      await insert({ id: `LEGACY-${index}`, details: { clinicalAssessment: null, clinical_assessment: { level: 'High', reasons } } });
    } finally {
      await pg.exec('alter table visits enable trigger visits_consultation_clinical_integrity');
    }
    assert.equal((await compareRisk(`LEGACY-${index}`)).riskLevel, 'High');
  }
});

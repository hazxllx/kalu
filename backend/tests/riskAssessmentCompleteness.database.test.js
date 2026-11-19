import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { assessVitals } from '../src/utils/residentRisk.js';

const db = new PGlite({ extensions: { pgcrypto } });
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const rule = (field, weight = 70, operator = 'gte', value = 140, extra = {}) =>
  ({ code: `${field}-${weight}`, name: field, field, weight, operator, value, enabled: true, ...extra });
const configuration = (criteria) => ({ criteria, thresholds: { moderateMin: 40, highMin: 70 } });
const defaults = configuration([rule('systolic'), rule('systolic', 40, 'between', 130, { value2: 139 }), rule('o2sat', 70, 'lt', 95)]);
const assess = async (vitals = {}, config = defaults, factors = true) => (await query(
  'select analytics_assess_vitals($1,$2,$3,$4,$5,$6,$7,$8,$9) as risk',
  [vitals.bp ?? null, vitals.o2sat ?? null, vitals.temperature ?? null, vitals.hr ?? null,
    vitals.rr ?? null, vitals.heightCm ?? null, vitals.weightKg ?? null, config, factors]))[0].risk;

before(async () => {
  // Platform shims only: production application schema/functions come from the
  // actual ordered migrations, including all later replacements of the RPCs.
  await db.exec(`create schema auth; create schema storage;
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
  for (const filename of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
    try { await db.exec(await readFile(new URL(filename, directory), 'utf8')); }
    catch (error) { throw new Error(`Migration ${filename}: ${error.message}`); }
  }
});
after(async () => { await db.close(); });

test('KFT-014 complete inputs retain configured weights, thresholds, and distinct required fields', async () => {
  const normal = await assess({ bp: ' 120 / 80 ', o2sat: 98 });
  assert.equal(normal.riskLevel, 'Low');
  assert.equal(normal.riskScore, 0);
  assert.equal(normal.riskAssessmentStatus, 'assessed');
  assert.deepEqual(normal.missingMeasurements, []);
  assert.equal(normal.riskReason, 'No configured risk criteria matched the recorded measurements.');
  const high = await assess({ bp: '145/90', o2sat: 94 });
  assert.equal(high.riskScore, 140);
  assert.equal(high.riskLevel, 'High');
  assert.equal(high.riskFactors.length, 2);
  const custom = configuration([rule('pulse', 20, 'eq', 80), rule('pulse', 25, 'lte', 80), rule('temperature', 5, 'gt', 37)]);
  custom.thresholds = { moderateMin: 45, highMin: 50 };
  assert.equal((await assess({ hr: 80, temperature: 38 }, custom)).riskLevel, 'High');
  assert.equal((await assess({ hr: 80, temperature: 37 }, custom)).riskLevel, 'Moderate');
});

test('KFT-014 partial normal stays unclassified while partial positive findings retain High/Moderate', async () => {
  const partial = await assess({ bp: '120/80' });
  assert.equal(partial.riskLevel, null);
  assert.equal(partial.riskScore, 0);
  assert.equal(partial.riskAssessmentStatus, 'incomplete');
  assert.equal(partial.riskReason, 'Assessment incomplete. Missing measurements: oxygen saturation.');
  assert.deepEqual(partial.missingMeasurements, ['o2sat']);
  for (const [bp, expected] of [['160/100', 'High'], ['135/85', 'Moderate']]) {
    const positive = await assess({ bp });
    assert.equal(positive.riskLevel, expected);
    assert.equal(positive.riskAssessmentStatus, 'assessed');
    assert.deepEqual(positive.missingMeasurements, ['o2sat']);
    assert.equal(positive.riskFactors.length, 1);
  }
  assert.deepEqual((await assess({ bp: '160/100' }, defaults, false)).riskFactors, []);
});

test('KFT-014 unrelated vitals, disabled rules, malformed BP, and invalid numerics never fabricate Low', async () => {
  const unrelated = await assess({ temperature: 37 });
  assert.equal(unrelated.riskLevel, null);
  assert.equal(unrelated.riskScore, null);
  assert.equal(unrelated.riskAssessmentStatus, 'unavailable');
  assert.equal(unrelated.riskReason, 'No measurements required by the configured risk criteria are available.');
  assert.deepEqual(unrelated.missingMeasurements, ['o2sat', 'systolic']);
  for (const bp of ['prefix 160/100', '160/100 suffix', '1160/100', '160/1000', '160/100/80', '00/00', '']) {
    const risk = await assess({ bp }, configuration([rule('systolic')]));
    assert.equal(risk.riskLevel, null, bp);
    assert.equal(risk.riskAssessmentStatus, 'unavailable', bp);
  }
  for (const o2sat of [0, -1, 'NaN', 'Infinity', '-Infinity', null]) {
    assert.equal((await assess({ o2sat }, configuration([rule('o2sat', 70, 'lt', 95)]))).riskLevel, null);
  }
  const disabled = await assess({ bp: '160/100', o2sat: 90 }, configuration([rule('systolic', 70, 'gte', 140, { enabled: false })]));
  assert.equal(disabled.riskAssessmentStatus, 'unavailable');
  assert.equal(disabled.riskReason, 'No measurements required by the configured risk criteria are available.');
  assert.deepEqual(disabled.missingMeasurements, []);
});

test('KFT-014 BMI completeness uses both valid components and enabled fields only', async () => {
  const config = configuration([rule('bmi', 40, 'gte', 25), rule('pulse', 70, 'gt', 100, { enabled: false })]);
  assert.equal((await assess({ heightCm: 170, weightKg: 60 }, config)).riskLevel, 'Low');
  assert.equal((await assess({ heightCm: 170, weightKg: 80 }, config)).riskLevel, 'Moderate');
  for (const heightCm of [null, 0, -170, 'NaN', 'Infinity']) {
    const risk = await assess({ heightCm, weightKg: 60 }, config);
    assert.equal(risk.riskAssessmentStatus, 'unavailable');
    assert.deepEqual(risk.missingMeasurements, ['bmi']);
  }
});

test('KFT-014 SQL and JS return identical risk and completeness contracts', async () => {
  for (const config of [defaults, configuration([]), configuration([rule('bmi', 40, 'gte', 25)])]) {
    for (const vitals of [{}, { temperature: 37 }, { bp: '120/80' }, { bp: '135/85' }, { bp: '160/100' },
      { bp: '120/80', o2sat: 98 }, { bp: 'bad 160/100', o2sat: 0 },
      { bp: '\t 120 / 80 \n', o2sat: 98 }, { heightCm: 170, weightKg: 80 }]) {
      const sql = await assess(vitals, config);
      const js = assessVitals(vitals, config);
      assert.deepEqual(sql, { riskScore: js.score, riskLevel: js.level, riskFactors: js.factors,
        riskAssessmentStatus: js.status, missingMeasurements: js.missingMeasurements, riskReason: js.reason });
    }
  }
});

test('KFT-014 deployed detail, persistence, resident summary, early warning and map share current assessment', async () => {
  const municipality = randomUUID();
  const barangay = randomUUID();
  const actor = randomUUID();
  await query('insert into municipalities(id,name) values($1,$2)', [municipality, 'KFT-014 Synthetic']);
  await query("insert into barangays(id,municipality_id,name) values($1,$2,'San Isidro')", [barangay, municipality]);
  await query('insert into auth.users(id,email) values($1,$2)', [actor, `${actor}@example.test`]);
  await query("update profiles set role='phn',status='active',municipality_id=$2 where id=$1", [actor, municipality]);
  await db.exec("insert into role_permissions(role,permission_id,granted) values('phn','reports.analytics.view',true) on conflict(role,permission_id) do update set granted=true");
  await db.exec('delete from risk_criteria');
  for (const c of defaults.criteria) {
    await query('insert into risk_criteria(code,name,field,operator,value,value2,weight,enabled,priority) values($1,$2,$3,$4,$5,$6,$7,true,10)',
      [c.code, c.name, c.field, c.operator, c.value, c.value2 ?? null, c.weight]);
  }
  for (const suffix of ['normal', 'positive', 'none', 'complete']) {
    await query(`insert into residents(id,health_record_no,first_name,last_name,municipality_id,barangay_id,barangay)
      values($1,$1,'Synthetic','KFT',$2,$3,'San Isidro')`, [`KFT-${suffix}`, municipality, barangay]);
  }
  for (const [suffix, bp, o2sat] of [['normal', '120/80', null], ['positive', '160/100', null], ['complete', '120/80', 98]]) {
    await query(`insert into visits(id,resident_id,recorded_by_id,recorded_by_role,status,bp,o2sat,visit_date)
      values($1,$2,$3,'phn','completed',$4,$5,now())`, [`KFT-V-${suffix}`, `KFT-${suffix}`, actor, bp, o2sat]);
  }
  const detail = (await query('select resident_risk_for_ids($1,$2) as result', [['KFT-normal', 'KFT-positive', 'KFT-none', 'KFT-complete'], actor]))[0].result;
  assert.equal(detail.find((r) => r.residentId === 'KFT-normal').riskLevel, null);
  assert.equal(detail.find((r) => r.residentId === 'KFT-positive').riskLevel, 'High');
  assert.equal(detail.find((r) => r.residentId === 'KFT-none').riskAssessmentStatus, 'unavailable');
  await query('select recalculate_resident_risk(null,$1)', [municipality]);
  assert.deepEqual(await query("select risk_level from residents where id='KFT-normal'"), [{ risk_level: null }]);
  const summary = (await query('select resident_risk_summary($1) as result', [actor]))[0].result.summary;
  assert.equal(summary.totalResidents, 4);
  assert.equal(summary.assessed, 2);
  assert.equal(summary.unassessed, 2);
  assert.equal(summary.distribution.find((r) => r.name === 'Unassessed').value, 2);
  const ew = (await query("select scoped_aggregate_analytics($1,'early-warning') as result", [actor]))[0].result;
  assert.equal(ew.riskDistribution.find((r) => r.name === 'Unassessed').value, 2);
  assert.equal(ew.riskDistribution.find((r) => r.name === 'Low Risk').value, 1);
  const map = (await query("select scoped_aggregate_analytics($1,'community-map') as result", [actor]))[0].result;
  const counts = map.barangays.find((b) => b.name === 'San Isidro').riskCounts;
  assert.equal(counts.Low, 1);
  assert.equal(counts.High, 1);
  assert.equal(counts.Unassessed, 1); // Map riskCounts cover matched encounters.
  for (const signature of ['analytics_assess_vitals(text,numeric,numeric,numeric,numeric,numeric,numeric,jsonb,boolean)',
    'resident_risk_for_ids(text[],uuid)', 'resident_risk_summary(uuid,text,integer,integer)',
    'scoped_aggregate_analytics(uuid,text,text,text,text,text,date,date,integer,boolean)']) {
    assert.equal((await query("select has_function_privilege('authenticated',$1,'EXECUTE') as allowed", [signature]))[0].allowed, false);
    assert.equal((await query("select has_function_privilege('service_role',$1,'EXECUTE') as allowed", [signature]))[0].allowed, true);
  }
});

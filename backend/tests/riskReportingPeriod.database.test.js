import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const riskValue = (distribution, name) => distribution.find((item) => item.name === name)?.value;

before(async () => {
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

test('KFT-015 early-warning risk distribution follows selected dates and keeps legacy metrics', async () => {
  const municipality = randomUUID();
  const outsideMunicipality = randomUUID();
  const barangay = randomUUID();
  const outsideBarangay = randomUUID();
  const actor = randomUUID();
  await query('insert into municipalities(id,name) values($1,$2),($3,$4)',
    [municipality, 'KFT-015 Scope', outsideMunicipality, 'KFT-015 Outside']);
  await query('insert into barangays(id,municipality_id,name) values($1,$2,$3),($4,$5,$6)',
    [barangay, municipality, 'San Isidro', outsideBarangay, outsideMunicipality, 'San Antonio']);
  await query('insert into auth.users(id,email) values($1,$2)', [actor, `${actor}@example.test`]);
  await query("update profiles set role='phn',status='active',municipality_id=$2 where id=$1", [actor, municipality]);
  await query(`insert into role_permissions(role,permission_id,granted)
    values('phn','reports.analytics.view',true)
    on conflict(role,permission_id) do update set granted=true`);

  await db.exec('delete from risk_criteria');
  await query(`insert into risk_criteria(code,name,field,operator,value,weight,enabled,priority)
    values('systolic-high','High systolic pressure','systolic','gte',140,70,true,10),
      ('low-o2','Low oxygen saturation','o2sat','lt',95,70,true,20)`);

  const residents = [
    ['KFT015-boundary-start', municipality, barangay],
    ['KFT015-boundary-end', municipality, barangay],
    ['KFT015-prior-year', municipality, barangay],
    ['KFT015-blank', municipality, barangay],
    ['KFT015-no-visit', municipality, barangay],
    ['KFT015-outside', outsideMunicipality, outsideBarangay],
  ];
  for (const [id, residentMunicipality, residentBarangay] of residents) {
    await query(`insert into residents(id,health_record_no,first_name,last_name,municipality_id,barangay_id,barangay)
      values($1,$1,'Synthetic','KFT-015',$2,$3,$4)`, [id, residentMunicipality, residentBarangay,
      residentBarangay === barangay ? 'San Isidro' : 'San Antonio']);
  }

  const visits = [
    ['KFT015-v-start-2025', 'KFT015-boundary-start', '2025-12-31T23:59:59.999999+08:00', '160/100', null],
    ['KFT015-v-start-2026', 'KFT015-boundary-start', '2026-01-01T00:00:00+08:00', '120/80', null],
    ['KFT015-v-end-2026', 'KFT015-boundary-end', '2026-12-31T23:59:59.999999+08:00', '160/100', null],
    ['KFT015-v-end-2027', 'KFT015-boundary-end', '2027-01-01T00:00:00+08:00', '120/80', null],
    ['KFT015-v-prior-year', 'KFT015-prior-year', '2025-06-15T12:00:00+08:00', '160/100', null],
    ['KFT015-v-prior-year-latest', 'KFT015-prior-year', '2026-06-15T12:00:00+08:00', '120/80', null],
    ['KFT015-v-blank', 'KFT015-blank', '2026-06-15T12:00:00+08:00', '', null],
    ['KFT015-v-outside', 'KFT015-outside', '2026-06-15T12:00:00+08:00', '160/100', null],
  ];
  for (const [id, residentId, visitDate, bp, o2sat] of visits) {
    await query(`insert into visits(id,resident_id,recorded_by_id,recorded_by_role,status,visit_date,bp,o2sat)
      values($1,$2,$3,'phn','completed',$4,$5,$6)`, [id, residentId, actor, visitDate, bp, o2sat]);
  }

  const aggregate = async (from = null, to = null, year = null, barangayName = null) => (await query(
    'select scoped_aggregate_analytics($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result',
    [actor, 'early-warning', barangayName, null, null, null, from, to, year, false],
  ))[0].result;
  const communityMap = async (from, to, barangayName = null, condition = null, status = null) => (await query(
    'select scoped_aggregate_analytics($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result',
    [actor, 'community-map', barangayName, condition, status, null, from, to, null, false],
  ))[0].result;
  const year2025 = await aggregate(null, null, 2025);
  const year2026 = await aggregate(null, null, 2026);
  assert.equal(riskValue(year2025.reportingRiskDistribution, 'High Risk'), 2);
  assert.equal(riskValue(year2025.reportingRiskDistribution, 'Unassessed'), 3);
  assert.equal(riskValue(year2025.reportingRiskDistribution, 'Low Risk'), 0);
  assert.equal(riskValue(year2026.reportingRiskDistribution, 'High Risk'), 1);
  assert.equal(riskValue(year2026.reportingRiskDistribution, 'Unassessed'), 4);
  assert.equal(riskValue(year2026.reportingRiskDistribution, 'Low Risk'), 0);
  assert.deepEqual(year2025.reportingPeriod, { from: '2025-01-01', to: '2025-12-31', year: 2025 });
  assert.deepEqual(year2026.reportingPeriod, { from: '2026-01-01', to: '2026-12-31', year: 2026 });
  assert.equal(year2025.summary.residents, 5);
  assert.equal(year2026.summary.residents, 5);

  // Date filtering changes only the additive fields; the legacy summary is all-time/current-month.
  assert.deepEqual(year2025.riskDistribution, year2026.riskDistribution);
  assert.equal(year2025.summary.consultationsThisMonth, year2026.summary.consultationsThisMonth);
  const allTime = await aggregate();
  assert.deepEqual(allTime.reportingRiskDistribution, allTime.riskDistribution);
  assert.deepEqual(allTime.reportingPeriod, { from: null, to: null, year: null });
  const openEnded = await aggregate('2026-01-01');
  assert.deepEqual(openEnded.reportingPeriod, { from: '2026-01-01', to: null, year: null });
  assert.equal(riskValue(openEnded.reportingRiskDistribution, 'High Risk'), 0);
  assert.equal(riskValue(openEnded.reportingRiskDistribution, 'Unassessed'), 5);

  const map2025 = await communityMap('2025-01-01', '2025-12-31');
  const map2025Barangay = map2025.barangays.find((row) => row.name === 'San Isidro');
  assert.equal(map2025Barangay.highRiskResidents, 0);
  assert.equal(map2025Barangay.reportingHighRiskResidents, 2);
  assert.equal(map2025.barangays.some((row) => row.name === 'San Antonio'), false);
  const map2026 = await communityMap('2026-01-01', '2026-12-31');
  const map2026Barangay = map2026.barangays.find((row) => row.name === 'San Isidro');
  assert.equal(map2026Barangay.highRiskResidents, 0);
  assert.equal(map2026Barangay.reportingHighRiskResidents, 1);
  const filteredMap = await communityMap('2026-01-01', '2026-12-31', null, 'Dengue', 'submitted');
  assert.equal(filteredMap.barangays[0].caseCount, 0);
  assert.equal(filteredMap.barangays[0].reportingHighRiskResidents, 1);
  await assert.rejects(communityMap('2026-01-01', '2026-12-31', 'San Antonio'), (error) => error.code === '22023');

  await assert.rejects(aggregate(null, null, 2026, 'San Antonio'), (error) => error.code === '22023');
  const signature = 'scoped_aggregate_analytics(uuid,text,text,text,text,text,date,date,integer,boolean)';
  assert.equal((await query("select has_function_privilege('authenticated',$1,'EXECUTE') as allowed", [signature]))[0].allowed, false);
  assert.equal((await query("select has_function_privilege('service_role',$1,'EXECUTE') as allowed", [signature]))[0].allowed, true);
});

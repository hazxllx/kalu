import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { assessVitals, hasAssessableVitals, healthDataFromVitals } from '../src/utils/residentRisk.js';
import { DEFAULT_RISK_CONFIG } from '../src/config/riskConfig.js';
import { getCommunityMap, getCommunityMapTrends, getEarlyWarning, getHouseholdMap } from '../src/services/analytics.service.js';

const db = new PGlite({ extensions: { pgcrypto } });
const migrations = new URL('../../supabase/migrations/', import.meta.url);
const ids = Object.fromEntries(['municipality', 'foreignMunicipality', 'emptyMunicipality', 'unregisteredMunicipality',
  'primary', 'secondary', 'unplotted', 'foreign', 'empty'].map((key) => [key, randomUUID()]));
const actors = {};
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const rpc = async (actorId, kind, filters = {}) => (await query(`select public.scoped_aggregate_analytics(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result`, [actorId, kind, filters.barangay ?? null,
  filters.condition ?? null, filters.status ?? null, filters.riskLevel ?? null,
  filters.from ?? null, filters.to ?? null, filters.year ?? null, filters.distinctResidents ?? false]))[0].result;
const injectedRpc = async (name, params) => {
  assert.equal(name, 'scoped_aggregate_analytics');
  try {
    return { data: await rpc(params.p_actor_id, params.p_kind, {
      barangay: params.p_barangay, condition: params.p_condition, status: params.p_status, riskLevel: params.p_risk_level,
      from: params.p_from, to: params.p_to, year: params.p_year, distinctResidents: params.p_distinct_residents,
    }) };
  } catch (error) { return { error }; }
};
const dependencies = { repo: { mode: 'supabase' }, rpc: injectedRpc };
let currentMonth;
let reportingYear;
const account = async (role, barangayId = null, municipalityId = ids.municipality, status = 'active') => {
  const id = randomUUID();
  await query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.test`]);
  await query('update public.profiles set role=$2,status=$3,municipality_id=$4,barangay_id=$5 where id=$1',
    [id, role, status, municipalityId, barangayId]);
  return id;
};
const asClient = async (role, actorId, run, claimRole = role) => {
  await query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [actorId || '', claimRole]);
  await db.exec(`set role ${role}`);
  try { return await run(); }
  finally {
    await db.exec('reset role');
    await db.exec("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false)");
  }
};

before(async () => {
  // Supabase platform stubs only. Every application table/function comes from
  // the real ordered migration chain, including the parent-owned risk wrappers.
  await db.exec(`create schema auth; create schema storage;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as
      $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
    create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb not null default '{}',
      raw_app_meta_data jsonb not null default '{}',email_confirmed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    create policy objects_owner on storage.objects for all to authenticated using(owner=auth.uid()) with check(owner=auth.uid());
    select set_config('request.jwt.claim.role','service_role',false);`);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort()) {
    try { await db.exec(await readFile(new URL(file, migrations), 'utf8')); }
    catch (error) { throw new Error(`Migration ${file}: ${error.message}`); }
  }
  await query(`insert into public.municipalities(id,name,latitude,longitude) values
    ($1,'Scale Municipality',13.55417,123.27528),($2,'Foreign Municipality',null,null),
    ($3,'Empty Municipality',null,null),($4,'Unregistered Municipality',null,null)`,
  [ids.municipality, ids.foreignMunicipality, ids.emptyMunicipality, ids.unregisteredMunicipality]);
  await query(`insert into public.barangays(id,municipality_id,name,latitude,longitude) values
    ($1,$2,'San Antonio',13.5581,123.273),($3,$2,'San Isidro',13.55,123.27),($4,$2,'Old San Roque',null,null),
    ($5,$6,'San Antonio',14.0,124.0),($7,$8,'San Antonio',null,null)`,
  [ids.primary, ids.municipality, ids.secondary, ids.unplotted, ids.foreign, ids.foreignMunicipality, ids.empty, ids.emptyMunicipality]);
  actors.mho = await account('mho');
  actors.phn = await account('phn');
  actors.supervisor = await account('health_supervisor', ids.primary);
  actors.secondary = await account('health_supervisor', ids.secondary);
  actors.foreign = await account('health_supervisor', ids.foreign, ids.foreignMunicipality);
  actors.empty = await account('mho', null, ids.emptyMunicipality);
  actors.unregistered = await account('mho', null, ids.unregisteredMunicipality);
  actors.disabled = await account('mho', null, ids.municipality, 'disabled');
  actors.bhw = await account('bhw', ids.primary);
  actors.admin = await account('admin');
  await db.exec(`insert into public.role_permissions(role,permission_id,granted) values
    ('mho','reports.analytics.view',true),('phn','reports.analytics.view',true),('health_supervisor','reports.analytics.view',true)
    on conflict(role,permission_id) do update set granted=excluded.granted;`);
  const calendar = (await query(`select date_trunc('month',now() at time zone 'Asia/Manila')::date::text as month,
    extract(year from now() at time zone 'Asia/Manila')::integer as year`))[0];
  currentMonth = calendar.month;
  reportingYear = calendar.year;

  // Seed retained historical rows, not a referral write workflow. Local replica
  // mode skips write triggers; check/unique constraints and all read/RPC guards
  // remain real. Explicit IDs/scopes supply retained snapshots to test joins.
  await db.exec('begin; set local session_replication_role=replica;');
  try {
    await query(`insert into public.residents(id,health_record_no,first_name,last_name,cellphone_no,
      municipality_id,barangay_id,barangay,verification_status)
      select 'PRIVATE-RES-'||n,'PRIVATE-HR-'||n,'PRIVATE FIRST','PRIVATE LAST','09171234567',$1,$2,'San Antonio',
        case n when 6000 then 'pending' else 'approved' end
      from generate_series(1,6000) n`, [ids.municipality, ids.primary]);
    await query(`insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,status,chief_complaint,bp,
      visit_date,created_at,updated_at,municipality_id,barangay_id)
      select 'PRIVATE-VISIT-'||n,'PRIVATE-RES-'||n,$1,'phn','completed','TB recorded','145/95',
      $2::date::timestamp at time zone 'Asia/Manila',$2::date::timestamp at time zone 'Asia/Manila',
      $2::date::timestamp at time zone 'Asia/Manila',$3,$4 from generate_series(1,6000) n`,
    [actors.phn, currentMonth, ids.foreignMunicipality, ids.foreign]);
    await query(`insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,status,chief_complaint,bp,visit_date,created_at,updated_at)
      values('PRIVATE-OLDER','PRIVATE-RES-1',$1,'phn','completed','TB recorded','118/76',
        ($2::date-interval '1 month') at time zone 'Asia/Manila',($2::date-interval '1 month') at time zone 'Asia/Manila',
        ($2::date-interval '1 month') at time zone 'Asia/Manila')`, [actors.phn, currentMonth]);
    await query(`insert into public.health_referrals(resident_id,created_at,created_by,municipality_id,barangay_id)
      select 'PRIVATE-RES-'||n,$1::date::timestamp at time zone 'Asia/Manila',$2,$3,$4 from generate_series(1,6000) n`,
    [currentMonth, actors.supervisor, ids.foreignMunicipality, ids.foreign]);
    await query(`insert into public.referrals(id,resident_id,visit_id,created_at,patient_snapshot)
      values('PRIVATE-LEGACY','PRIVATE-RES-1','PRIVATE-VISIT-1',$1::date::timestamp at time zone 'Asia/Manila',
      '{"name":"PRIVATE LEGACY SNAPSHOT"}')`, [currentMonth]);
    await query(`insert into public.tcl_entries(resident_id,program,status,created_at,municipality_id,barangay_id)
      select 'PRIVATE-RES-'||n,'TB DOTS','Active',$1::date::timestamp at time zone 'Asia/Manila',$2,$3 from generate_series(1,6000) n`,
    [currentMonth, ids.municipality, ids.primary]);
    await query(`insert into public.tcl_entries(resident_id,program,status,created_at)
      values('PRIVATE-RES-1','Tuberculosis','Active',$1::date::timestamp at time zone 'Asia/Manila')`, [currentMonth]);
    await query(`insert into public.households(id,municipality_id,barangay_id,barangay,head_name,latitude,longitude,risk_level,verification_status)
      select 'PRIVATE-HH-'||n,$1,$2,'San Antonio','PRIVATE HEAD '||n,13.111111,123.222222,
      case n when 1 then 'High' when 2 then 'Moderate' else 'Low' end,
      case when n in (1,6000) then 'Verified' else 'Pending Verification' end from generate_series(1,6000) n`, [ids.municipality, ids.primary]);
    await db.exec(`insert into public.household_members(household_id,resident_id,name)
      select 'PRIVATE-HH-'||n,'PRIVATE-RES-'||n,'PRIVATE MEMBER' from generate_series(1,6000) n;
      insert into public.household_members(household_id,name) values('PRIVATE-HH-1','PRIVATE UNLINKED');`);
    await db.exec(`insert into public.follow_ups(resident_id,scheduled_date,status)
      select 'PRIVATE-RES-'||n,(now() at time zone 'Asia/Manila')::date-1,'Scheduled' from generate_series(1,6000) n;
      insert into public.maternal_records(resident_id,status) select 'PRIVATE-RES-'||n,'Active' from generate_series(1,6000) n;
      insert into public.immunizations(resident_id,vaccine) select 'PRIVATE-RES-'||n,'Recorded' from generate_series(1,6000) n;`);
    await query(`insert into public.residents(id,health_record_no,first_name,last_name,municipality_id,barangay_id,barangay)
      values('PRIVATE-FOREIGN','PRIVATE-HR-FOREIGN','PRIVATE FOREIGN','PRIVATE LAST',$1,$2,'San Antonio')`,
    [ids.foreignMunicipality, ids.foreign]);
    await query(`insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,status,chief_complaint,bp,visit_date,created_at)
      values('PRIVATE-FOREIGN-VISIT','PRIVATE-FOREIGN',$1,'phn','submitted','TB recorded','190/110',
      $2::date::timestamp at time zone 'Asia/Manila',$2::date::timestamp at time zone 'Asia/Manila')`, [actors.phn, currentMonth]);
    for (const suffix of ['A', 'B', 'C', 'TB1', 'TB2', 'TB3', 'TB4', 'U']) {
      await query(`insert into public.residents(id,health_record_no,first_name,last_name,municipality_id,barangay_id,barangay)
        values($1,$2,'PRIVATE DATE','PRIVATE LAST',$3,$4,$5)`, [`PRIVATE-DATE-${suffix}`, `PRIVATE-HR-DATE-${suffix}`,
        ids.municipality, suffix === 'U' ? ids.unplotted : ids.secondary, suffix === 'U' ? 'Old San Roque' : 'San Isidro']);
    }
    const dated = [
      ['before', 'A', '2026-04-30T15:59:59.999999Z', '145/95', 'Dengue'],
      ['start', 'A', '2026-04-30T16:00:00Z', '145/95', 'Dengue'],
      ['end', 'A', '2026-05-01T15:59:59.999999Z', '145/95', 'Dengue'],
      ['after', 'A', '2026-05-01T16:00:00Z', '118/76', 'Dengue'],
      ['fallback', 'B', null, '', 'Dengue'],
      ['offset', 'C', '2026-05-01T00:00:00+08:00', '130/80', 'Unspecified'],
      ['prior-year', 'A', '2025-12-31T15:59:59.999999Z', '145/95', 'Dengue'],
      ['new-year', 'A', '2025-12-31T16:00:00Z', '145/95', 'Dengue'],
      ['tb-first', 'TB1', '2026-06-01T00:00:00+08:00', '145/95', 'TB'],
      ['tb-latest', 'TB1', '2026-06-02T00:00:00+08:00', '118/76', 'TB'],
      ['respiratory', 'TB2', '2026-06-01T00:00:00+08:00', '145/95', 'Cough'],
    ];
    for (const [id, suffix, date, bp, condition] of dated) {
      await query(`insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,status,chief_complaint,findings,bp,
        visit_date,created_at,updated_at) values($1,$2,$3,'phn',$4,$5,$6,$7,$8,$9,$9)`,
      [`PRIVATE-${id}`, `PRIVATE-DATE-${suffix}`, actors.phn, ['tb-latest', 'respiratory'].includes(id) ? 'submitted' : 'completed',
        condition, id === 'offset' ? 'Dengue diagnosed' : '', bp, date, date || '2026-04-30T16:00:00Z']);
    }
    for (const suffix of ['TB1', 'TB1', 'TB2', 'TB3', 'TB3', 'U']) {
      await query(`insert into public.tcl_entries(resident_id,program,status,created_at) values($1,'TB','Active','2026-06-01T00:00:00+08:00')`,
        [`PRIVATE-DATE-${suffix}`]);
    }
    await db.exec(`insert into public.tcl_entries(resident_id,program,status,created_at) values
      ('PRIVATE-DATE-TB4','MTB unrelated','Active','2026-06-01T00:00:00+08:00'),
      ('PRIVATE-DATE-TB4','TB','Inactive','2026-06-01T00:00:00+08:00');`);
    await query(`insert into public.households(id,municipality_id,barangay_id,barangay,head_name,latitude,longitude) values
      ('PRIVATE-HH-ACTIVE',$1,$2,'San Isidro','PRIVATE ACTIVE',13.111111,123.222222),
      ('PRIVATE-HH-FOREIGN',$1,$2,'San Isidro','PRIVATE FOREIGN',13.111111,123.222222),
      ('PRIVATE-HH-UNPLOTTED',$1,$3,'Old San Roque','PRIVATE UNPLOTTED',13.111111,123.222222)`,
    [ids.municipality, ids.secondary, ids.unplotted]);
    await db.exec(`insert into public.household_members(household_id,resident_id,name) values
      ('PRIVATE-HH-ACTIVE','PRIVATE-DATE-TB2','PRIVATE MEMBER'),
      ('PRIVATE-HH-FOREIGN','PRIVATE-FOREIGN','PRIVATE MEMBER'),
      ('PRIVATE-HH-UNPLOTTED','PRIVATE-DATE-U','PRIVATE MEMBER');`);
    await db.exec('commit;');
  } catch (error) { await db.exec('rollback;'); throw new Error(`Analytics fixture: ${error.message}`); }
  // Bulk-loaded test databases need the statistics production autovacuum keeps
  // current; otherwise tiny pre-fixture estimates hide the indexed/hash plans.
  await db.exec(`analyze public.residents,public.visits,public.health_referrals,public.tcl_entries,
    public.households,public.household_members,public.follow_ups,public.maternal_records,public.immunizations,
    public.risk_criteria,public.risk_settings,public.profiles,public.barangays,public.municipalities;`);
}, { timeout: 120000 });
after(async () => { await db.close(); });

test('6,000 residents/visits/referrals/TB/households and monitoring sources are exact, scoped and uncapped', async () => {
  for (const actorId of [actors.supervisor, actors.mho, actors.phn]) {
    const result = await getEarlyWarning({ actorId, barangay: 'San Antonio', municipalityId: ids.foreignMunicipality }, dependencies);
    assert.deepEqual(result.summary, { consultationsThisMonth: 6000, referralsThisMonth: 6000,
      topCondition: 'Tuberculosis', topConditionCases: 6001, highRiskResidents: 6000, residents: 6000 });
    assert.deepEqual(result.riskDistribution, [{ name: 'Low Risk', value: 0 }, { name: 'Moderate Risk', value: 0 },
      { name: 'High Risk', value: 6000 }, { name: 'Unassessed', value: 0 }]);
    assert.deepEqual(result.monitoring, { verifiedResidents: 6000, totalHouseholds: 6000,
      householdRisk: { High: 1, Moderate: 1, Low: 5998 }, activeFollowUps: 6000, pendingFollowUps: 6000,
      overdueFollowUps: 6000, upcomingFollowUps: 0, pendingReferrals: 6000, totalReferrals: 6000,
      maternalCases: 6000, activeMaternalCases: 6000, immunizationRecords: 6000 });
    assert.equal(result.consultationTrends.length, 12);
    assert.equal(result.consultationTrends.at(-1).consultations, 6000);
    assert.equal(result.consultationTrends.at(-1).referrals, 6000);
  }
  const map = await getCommunityMap({ actorId: actors.mho, barangay: 'San Antonio' }, dependencies);
  assert.deepEqual(map.summary, { totalCases: 6000, affectedBarangays: 1, newCases: 6000, activeCases: 0, completedCases: 6000 });
  assert.equal(map.barangays[0].residents, 6000);
  assert.equal(map.barangays[0].riskCounts.High, 6000);
  assert.equal(map.barangays[0].highRiskResidents, 6000);
  assert.deepEqual(map.barangays[0].conditions, [{ name: 'Tuberculosis', value: 6000 }]);
  const trends = await getCommunityMapTrends({ actorId: actors.mho, barangay: 'San Antonio', year: reportingYear }, dependencies);
  assert.equal(trends.monthly[Number(currentMonth.slice(5, 7)) - 1].cases, 6000);
  const households = await getHouseholdMap({ actorId: actors.mho, barangay: 'San Antonio' }, dependencies);
  assert.deepEqual(households.summary, { households: 6000, plotted: 1, unplotted: 0, activeCaseHouseholds: 6000 });
  assert.deepEqual(households.locations, [{ barangay: 'San Antonio', householdCount: 6000, memberCount: 6001,
    activeHouseholds: 6000, hasCoordinates: true, latitude: 13.5581, longitude: 123.273 }]);
});

test('profile scope is authoritative across roles and same-name barangays in different municipalities', async () => {
  assert.equal((await rpc(actors.mho, 'early-warning')).summary.residents, 6008);
  assert.equal((await rpc(actors.secondary, 'early-warning')).summary.residents, 7);
  assert.equal((await rpc(actors.foreign, 'early-warning')).summary.residents, 1);
  const map = await rpc(actors.foreign, 'community-map', { barangay: 'San Antonio' });
  assert.equal(map.barangays[0].id, ids.foreign);
  assert.equal(map.barangays[0].residents, 1);
  for (const actorId of [actors.bhw, actors.admin, actors.disabled, randomUUID(), null]) {
    await assert.rejects(() => rpc(actorId, 'early-warning'), (error) => error.code === '42501');
  }
  await assert.rejects(() => rpc(actors.supervisor, 'community-map', { barangay: 'San Isidro' }), (error) => error.code === '42501');
  await assert.rejects(() => rpc(actors.foreign, 'community-map', { barangay: 'San Isidro' }), (error) => error.code === '42501');
  await assert.rejects(() => rpc(actors.empty, 'community-map', { barangay: 'San Isidro' }), (error) => error.code === '22023');
});

test('anon/authenticated cannot execute any helper or aggregate RPC, even with forged actor/JWT role', async () => {
  for (const [role, claimRole] of [['anon', 'anon'], ['authenticated', 'authenticated'], ['authenticated', 'service_role']]) {
    await asClient(role, actors.mho, async () => {
      await assert.rejects(() => rpc(actors.mho, 'early-warning'), (error) => error.code === '42501');
      await assert.rejects(() => query('select public.analytics_risk_configuration()'), (error) => error.code === '42501');
      await assert.rejects(() => query("select public.analytics_condition('TB')"), (error) => error.code === '42501');
    }, claimRole);
  }
  await asClient('service_role', null, async () => assert.equal((await rpc(actors.supervisor, 'early-warning')).summary.residents, 6000));
});

test('a configured permission denial fails closed while an empty role matrix retains bootstrap authorization', async () => {
  await db.exec("update public.role_permissions set granted=false where role='mho' and permission_id='reports.analytics.view'");
  try { await assert.rejects(() => rpc(actors.mho, 'early-warning'), (error) => error.code === '42501'); }
  finally { await db.exec("update public.role_permissions set granted=true where role='mho' and permission_id='reports.analytics.view'"); }
  const saved = await query("select role,permission_id,granted from public.role_permissions where role='phn'");
  await db.exec("delete from public.role_permissions where role='phn'");
  try { assert.equal((await rpc(actors.phn, 'early-warning')).summary.residents, 6008); }
  finally { for (const row of saved) await query('insert into public.role_permissions(role,permission_id,granted) values($1,$2,$3)', [row.role, row.permission_id, row.granted]); }
});

test('inclusive Manila date ranges include start/end microseconds, offsets and created_at fallback, not adjacent days', async () => {
  const filters = { from: '2026-05-01', to: '2026-05-01' };
  const map = await rpc(actors.secondary, 'community-map', filters);
  assert.equal(map.summary.totalCases, 4);
  assert.equal(map.barangays[0].lastRecorded, '2026-05-01');
  assert.deepEqual(map.barangays[0].riskCounts, { High: 1, Moderate: 1, Low: 0, Unassessed: 1 });
  assert.equal(map.barangays[0].highRiskResidents, 1, 'latest scope risk is independent of the date/visit filter');
  assert.equal((await rpc(actors.secondary, 'community-map', { ...filters, riskLevel: 'High', status: 'completed' })).summary.totalCases, 2);
  assert.equal((await rpc(actors.secondary, 'community-map', { ...filters, condition: 'Dengue' })).summary.totalCases, 3,
    'map classification uses complaints only; early-warning also uses findings');
  const trends = await rpc(actors.secondary, 'community-map-trends', { ...filters, year: 2026 });
  assert.equal(trends.monthly[4].cases, 4);
  assert.equal(trends.monthly.reduce((sum, row) => sum + row.cases, 0), 4);
  assert.equal((await rpc(actors.secondary, 'community-map-trends', { ...filters, year: 2026, distinctResidents: true })).monthly[4].cases, 3);
  assert.equal((await rpc(actors.secondary, 'community-map-trends', { year: 2026 })).monthly[0].cases, 1);
  assert.equal((await rpc(actors.secondary, 'community-map-trends', { year: 2025 })).monthly[11].cases, 1);
});

test('TB is one resident-condition group across duplicate visits/enrollments; unrelated visits do not suppress TB', async () => {
  const filters = { from: '2026-06-01', to: '2026-06-30', condition: 'Tuberculosis' };
  const map = await rpc(actors.secondary, 'community-map', filters);
  assert.equal(map.summary.totalCases, 3);
  assert.equal(map.summary.activeCases, 3);
  assert.deepEqual(map.barangays[0].conditions, [{ name: 'Tuberculosis', value: 3 }]);
  assert.equal((await rpc(actors.secondary, 'community-map', { ...filters, status: 'completed' })).summary.totalCases, 1);
  assert.equal((await rpc(actors.secondary, 'community-map-trends', { ...filters, year: 2026 })).monthly[5].cases, 3);
  assert.equal((await rpc(actors.secondary, 'community-map-trends', { ...filters, condition: null, year: 2026 })).monthly[5].cases, 4);
});

test('all configured fields/operators/weights/disabled criteria and BMI normalization match the pure risk engine', async () => {
  const vitals = { bp: '142 / 95', o2sat: 94, temperature: 38, hr: 101, rr: 24, heightCm: 160, weightKg: 64.5 };
  const measured = healthDataFromVitals(vitals);
  for (const [field, value] of Object.entries(measured)) {
    for (const operator of ['gte', 'gt', 'lte', 'lt', 'eq', 'between']) {
      const config = { thresholds: { moderateMin: 5, highMin: 10 }, criteria: [
        { code: 'enabled', name: 'Configured rule', field, operator, value, value2: value, weight: 10, enabled: true, priority: 10 },
        { code: 'disabled', name: 'Disabled rule', field, operator: 'gte', value: 0, weight: 1000, enabled: false, priority: 0 },
      ] };
      const expected = assessVitals(vitals, config);
      const result = (await query('select public.analytics_assess_vitals($1,$2,$3,$4,$5,$6,$7,$8) as result',
        [vitals.bp, vitals.o2sat, vitals.temperature, vitals.hr, vitals.rr, vitals.heightCm, vitals.weightKg, JSON.stringify(config)]))[0].result;
      assert.deepEqual(result, { riskScore: expected.score, riskLevel: expected.level, riskFactors: expected.factors }, `${field}/${operator}`);
    }
  }
  for (const vitals of [{}, { bp: 'bad' }, { bp: 'value 140/090 recorded' }, { o2sat: 'NaN' }, { o2sat: 90 }]) {
    const expected = hasAssessableVitals(vitals) ? assessVitals(vitals, DEFAULT_RISK_CONFIG) : null;
    const result = (await query('select public.analytics_assess_vitals($1,$2,null,null,null,null,null,$3) as result',
      [vitals.bp || '', vitals.o2sat ?? null, JSON.stringify(DEFAULT_RISK_CONFIG)]))[0].result;
    assert.deepEqual(result, { riskScore: expected?.score ?? null, riskLevel: expected?.level ?? null, riskFactors: expected?.factors || [] });
  }
});

test('aggregate risk honors changed stored thresholds/criteria and does not reuse persisted resident classifications', async () => {
  await db.exec('update public.risk_settings set high_min=100,moderate_min=40');
  try {
    const result = await rpc(actors.supervisor, 'early-warning');
    assert.equal(result.summary.highRiskResidents, 0);
    assert.equal(result.riskDistribution.find((row) => row.name === 'Moderate Risk').value, 6000);
    await db.exec("update public.risk_criteria set enabled=false where code='bp_systolic_high'");
    assert.equal((await rpc(actors.supervisor, 'early-warning')).riskDistribution.find((row) => row.name === 'Low Risk').value, 6000);
  } finally {
    await db.exec("update public.risk_settings set high_min=70,moderate_min=40; update public.risk_criteria set enabled=true where code='bp_systolic_high'");
  }
});

test('household maps exclude foreign residents from active flags and retain honest unplotted barangay counts', async () => {
  const scoped = await rpc(actors.secondary, 'household-map');
  assert.deepEqual(scoped.summary, { households: 2, plotted: 1, unplotted: 0, activeCaseHouseholds: 1 });
  const municipal = await rpc(actors.mho, 'household-map');
  assert.deepEqual(municipal.summary, { households: 6003, plotted: 2, unplotted: 1, activeCaseHouseholds: 6002 });
  assert.equal(municipal.locations[1].memberCount, 2);
});

test('aggregate snapshots are bounded and contain no resident IDs, PII, clinical snapshots or household GPS', async (t) => {
  for (const kind of ['early-warning', 'community-map', 'community-map-trends', 'household-map']) {
    const started = performance.now();
    const result = await rpc(actors.mho, kind, { year: reportingYear });
    const json = JSON.stringify(result);
    t.diagnostic(`${kind}: ${Math.round(performance.now() - started)} ms, ${json.length} JSON bytes for 6000+ scoped records (local PGlite).`);
    assert.ok(json.length < 20000, `${kind} result should depend on aggregate groups, not source row count`);
    assert.doesNotMatch(json, /PRIVATE|09171234567|13\.111111|123\.222222|residentId|resident_id|head_name|patient_snapshot|visit_snapshot/);
  }
  const indexes = await query("select indexname from pg_indexes where schemaname='public' and indexname like 'analytics_%'");
  assert.equal(indexes.length, 5);
});

test('registered empty scopes return verified zeroes, but absent registry and invalid filters are errors', async () => {
  const empty = await rpc(actors.empty, 'community-map');
  assert.equal(empty.scopeComplete, true);
  assert.equal(empty.barangays.length, 1);
  assert.equal(empty.summary.totalCases, 0);
  assert.equal(empty.barangays[0].hasCoordinates, false);
  await assert.rejects(() => rpc(actors.unregistered, 'community-map'), (error) => error.code === '55000');
  for (const filters of [{ from: '2026-05-02', to: '2026-05-01' }, { year: 0 }, { riskLevel: 'Critical' }, { condition: 'Fabricated' }]) {
    await assert.rejects(() => rpc(actors.mho, 'community-map', filters), (error) => error.code === '22023');
  }
});

test('reporting totals/default year and followup today boundaries are independent of the session timezone', async () => {
  await db.exec(`update public.follow_ups set scheduled_date=(now() at time zone 'Asia/Manila')::date
    where resident_id='PRIVATE-RES-1'`);
  try {
    for (const timezone of ['UTC', 'Pacific/Honolulu', 'Asia/Tokyo']) {
      await db.exec(`set timezone='${timezone}'`);
      const result = await rpc(actors.supervisor, 'early-warning');
      assert.equal(result.summary.consultationsThisMonth, 6000);
      assert.equal(result.monitoring.overdueFollowUps, 5999);
      assert.equal(result.monitoring.upcomingFollowUps, 1);
      assert.equal((await rpc(actors.supervisor, 'community-map-trends')).year, reportingYear);
    }
  } finally {
    await db.exec(`set timezone='UTC'; update public.follow_ups set scheduled_date=(now() at time zone 'Asia/Manila')::date-1
      where resident_id='PRIVATE-RES-1'`);
  }
});

test('empty risk config tables use documented defaults, unlike failed source reads', async () => {
  const criteria = (await query('select to_jsonb(c) as row from public.risk_criteria c')).map(({ row }) => row);
  const settings = (await query('select to_jsonb(s) as row from public.risk_settings s')).map(({ row }) => row);
  await db.exec('delete from public.risk_criteria; delete from public.risk_settings;');
  try {
    const config = (await query('select public.analytics_risk_configuration() as config'))[0].config;
    assert.deepEqual(config.thresholds, { moderateMin: 40, highMin: 70 });
    assert.equal(config.criteria.length, 3);
    assert.equal((await rpc(actors.supervisor, 'early-warning')).summary.highRiskResidents, 6000);
  } finally {
    await query('insert into public.risk_criteria select * from jsonb_populate_recordset(null::public.risk_criteria,$1::jsonb)', [JSON.stringify(criteria)]);
    await query('insert into public.risk_settings select * from jsonb_populate_recordset(null::public.risk_settings,$1::jsonb)', [JSON.stringify(settings)]);
  }
});

test('an unavailable canonical referral table is a service error, never an empty success or legacy fallback', async () => {
  await db.exec('alter table public.health_referrals rename to analytics_unavailable_health_referrals');
  try {
    await assert.rejects(() => getEarlyWarning({ actorId: actors.supervisor }, dependencies),
      (error) => error.statusCode === 503 && error.cause?.code === '42P01');
  } finally {
    await db.exec('alter table public.analytics_unavailable_health_referrals rename to health_referrals');
  }
  assert.equal((await rpc(actors.supervisor, 'early-warning')).summary.referralsThisMonth, 6000);
});

test('monthly activity exposes exact 6000+ real cohorts, unique residents and denominators without official coverage', async () => {
  await db.exec('begin; set local session_replication_role=replica;');
  await query(`update public.residents set birth_date=($1::date-interval '65 years')::date where id like 'PRIVATE-RES-%';
    `, [currentMonth]);
  await query(`update public.follow_ups set status='Completed',scheduled_date=$1 where resident_id like 'PRIVATE-RES-%'`, [currentMonth]);
  await db.exec(`update public.health_referrals set status=case
    when substring(resident_id from '[0-9]+$')::integer<=3000 then 'Completed'
    else 'Rejected' end where resident_id like 'PRIVATE-RES-%';`);
  await query(`update public.tcl_entries set last_visit=$1 where resident_id like 'PRIVATE-RES-%'`, [currentMonth]);
  await db.exec('commit; analyze public.residents,public.follow_ups,public.health_referrals,public.tcl_entries;');
  try {
    for (const actorId of [actors.supervisor, actors.mho, actors.phn]) {
      const result = await getEarlyWarning({ actorId, barangay: 'San Antonio', municipalityId: ids.foreignMunicipality }, dependencies);
      const activity = result.activity;
      const row = activity.rows.find((item) => item.month === currentMonth.slice(0, 7));
      assert.equal(activity.schemaVersion, 1);
      assert.equal(activity.timeZone, 'Asia/Manila');
      assert.equal(activity.granularity, 'barangay-month');
      assert.equal(activity.months.length, 12);
      assert.equal(activity.scopeComplete, true);
      assert.equal(row.barangayId, ids.primary);
      assert.deepEqual(row.followUps, { scheduled: 6000, completed: 6000, completionPercent: 100 });
      assert.deepEqual(row.referrals, { created: 6000, completed: 3000, completionPercent: 50 }, 'Rejected is not completed');
      assert.deepEqual(row.maternal, { records: 6000, residents: 6000 });
      assert.deepEqual(row.immunizations, { records: 6000, residents: 6000 }, 'Due records are recorded rows, not doses/coverage');
      assert.deepEqual(row.consultations.senior, { records: 6000, residents: 6000 });
      assert.equal(row.consultations.records, 6000);
      assert.equal(row.consultations.residents, 6000);
      assert.equal(row.tcl.enrollmentGroups, 6001, 'groups use distinct recorded normalized program text, not an official program denominator');
      assert.equal(row.tcl.enrolledResidents, 6000);
      assert.equal(row.tcl.participationGroups, 6001);
      assert.equal(row.tcl.participatingResidents, 6000);
      assert.equal(activity.definitions.followUps.numerator, 'followUps.completed');
      assert.equal(activity.definitions.followUps.denominator, 'followUps.scheduled');
      assert.equal(activity.definitions.referrals.denominator, 'referrals.created');
      for (const definition of ['maternal', 'minorConsultations', 'seniorConsultations', 'immunizations', 'tclEnrollment', 'tclParticipation']) {
        assert.equal(activity.definitions[definition].denominator, null);
      }
      assert.equal(activity.definitions.immunizations.officialCoverageAvailable, false);
      assert.equal(activity.definitions.tclEnrollment.officialComplianceAvailable, false);
      assert.equal(activity.definitions.tclParticipation.officialComplianceAvailable, false);
      assert.match(activity.definitions.tclParticipation.note, /not a complete attendance history/);
      assert.doesNotMatch(JSON.stringify(activity), /PRIVATE|residentId|resident_id|09171234567|birth_date/);
    }
    await db.exec('begin; set local session_replication_role=replica;');
    await query("update public.residents set birth_date=($1::date-interval '10 years')::date where id like 'PRIVATE-RES-%'", [currentMonth]);
    await db.exec('commit;');
    const row = (await rpc(actors.supervisor, 'early-warning')).activity.rows.find((item) => item.month === currentMonth.slice(0, 7));
    assert.deepEqual(row.consultations.minor, { records: 6000, residents: 6000 });
    assert.deepEqual(row.consultations.senior, { records: 0, residents: 0 });
  } finally {
    await db.exec(`begin; set local session_replication_role=replica;
      update public.residents set birth_date=null where id like 'PRIVATE-RES-%';
      update public.follow_ups set status='Scheduled',scheduled_date=(now() at time zone 'Asia/Manila')::date-1 where resident_id like 'PRIVATE-RES-%';
      update public.health_referrals set status='Pending' where resident_id like 'PRIVATE-RES-%';
      update public.tcl_entries set last_visit=null where resident_id like 'PRIVATE-RES-%'; commit;
      analyze public.residents,public.follow_ups,public.health_referrals,public.tcl_entries;`);
  }
});

test('activity uses inclusive Manila cohorts, age at encounter and unique residents across repeated records and months', async () => {
  const referrals = [];
  const maternal = [];
  const immunizations = [];
  const enrollments = [];
  const followups = [];
  await db.exec('begin; set local session_replication_role=replica;');
  await db.exec(`update public.residents set birth_date=case id
    when 'PRIVATE-DATE-A' then '2008-05-02'::date when 'PRIVATE-DATE-C' then '1966-05-02'::date
    when 'PRIVATE-DATE-B' then '2030-01-01'::date else birth_date end
    where id in ('PRIVATE-DATE-A','PRIVATE-DATE-B','PRIVATE-DATE-C');`);
  await query(`insert into public.visits(id,resident_id,recorded_by_id,recorded_by_role,status,chief_complaint,bp,visit_date,created_at,updated_at)
    values('PRIVATE-ACTIVITY-BIRTHDAY','PRIVATE-DATE-C',$1,'phn','completed','Unspecified','130/80',
    '2026-05-02T00:00:00+08:00','2026-05-02T00:00:00+08:00','2026-05-02T00:00:00+08:00')`, [actors.phn]);
  for (const [date, status] of [['2026-04-30T15:59:59.999999Z', 'Completed'], ['2026-04-30T16:00:00Z', 'Completed'],
    ['2026-05-01T15:59:59.999999Z', 'Rejected'], ['2026-05-01T16:00:00Z', 'Completed'], ['2026-06-01T00:00:00+08:00', 'Completed']]) {
    referrals.push((await query('insert into public.health_referrals(resident_id,created_at,status) values($1,$2,$3) returning id',
      ['PRIVATE-DATE-A', date, status]))[0].id);
  }
  for (const [date, status] of [['2026-05-01', 'Completed'], ['2026-05-01', 'Missed'], ['2026-05-01', 'Cancelled'], ['2026-05-02', 'Completed']]) {
    followups.push((await query('insert into public.follow_ups(resident_id,scheduled_date,status) values($1,$2,$3) returning id',
      ['PRIVATE-DATE-A', date, status]))[0].id);
  }
  for (const date of ['2026-04-30T16:00:00Z', '2026-05-01T15:59:59.999999Z', '2026-05-01T16:00:00Z', '2026-06-01T00:00:00+08:00']) {
    maternal.push((await query('insert into public.maternal_records(resident_id,created_at,status) values($1,$2,$3) returning id',
      ['PRIVATE-DATE-A', date, 'Completed']))[0].id);
    immunizations.push((await query('insert into public.immunizations(resident_id,vaccine,created_at,status) values($1,$2,$3,$4) returning id',
      ['PRIVATE-DATE-A', 'Recorded', date, 'Due']))[0].id);
  }
  for (const program of ['TB', ' tb ']) {
    enrollments.push((await query(`insert into public.tcl_entries(resident_id,program,status,created_at,last_visit)
      values($1,$2,'Inactive','2026-05-01T00:00:00+08:00','2026-05-01') returning id`, ['PRIVATE-DATE-A', program]))[0].id);
  }
  await db.exec('commit; analyze public.visits,public.health_referrals,public.follow_ups,public.maternal_records,public.immunizations,public.tcl_entries;');
  try {
    const baseline = await rpc(actors.secondary, 'early-warning');
    const result = await rpc(actors.secondary, 'early-warning', { from: '2026-05-01', to: '2026-05-01', year: 2026 });
    assert.deepEqual(result.summary, baseline.summary);
    assert.deepEqual(result.monitoring, baseline.monitoring);
    assert.deepEqual(result.consultationTrends, baseline.consultationTrends, 'activity filters do not change existing contracts');
    assert.deepEqual(result.activity.reportingPeriod, { from: '2026-05-01', to: '2026-05-01' });
    assert.deepEqual(result.activity.months, ['2026-05']);
    assert.equal(result.activity.rows.length, 1);
    const row = result.activity.rows[0];
    assert.equal(row.barangayId, ids.secondary);
    assert.deepEqual(row.followUps, { scheduled: 3, completed: 1, completionPercent: 33.33 });
    assert.deepEqual(row.referrals, { created: 2, completed: 1, completionPercent: 50 });
    assert.deepEqual(row.maternal, { records: 2, residents: 1 });
    assert.deepEqual(row.immunizations, { records: 2, residents: 1 });
    assert.deepEqual(row.consultations, { records: 4, residents: 3, minor: { records: 2, residents: 1 },
      senior: { records: 0, residents: 0 }, unknownAge: { records: 1, residents: 1 } });
    assert.deepEqual(row.tcl, { enrollmentGroups: 1, enrolledResidents: 1, participationGroups: 1, participatingResidents: 1 });
    const birthday = (await rpc(actors.secondary, 'early-warning', { from: '2026-05-02', to: '2026-05-02' })).activity.rows[0];
    assert.deepEqual(birthday.consultations.minor, { records: 0, residents: 0 }, 'A is 18 on this encounter date');
    assert.deepEqual(birthday.consultations.senior, { records: 1, residents: 1 }, 'C is 60 on this encounter date');
    const month = (await rpc(actors.secondary, 'early-warning', { from: '2026-05-01', to: '2026-06-30' })).activity;
    assert.equal(month.rows.find((item) => item.month === '2026-05').referrals.completionPercent, 66.67);
    assert.deepEqual(month.rows.find((item) => item.month === '2026-06').maternal, { records: 1, residents: 1 });
    const foreign = (await rpc(actors.foreign, 'early-warning', { year: 2026 })).activity;
    assert.equal(foreign.rows.every((item) => item.barangayId === ids.foreign), true);
    assert.equal(foreign.rows.some((item) => item.barangayId === ids.secondary), false);
    assert.doesNotMatch(JSON.stringify(month), /PRIVATE|residentId|resident_id|2008-05-02|1966-05-02|2030-01-01/);
  } finally {
    await db.exec('begin; set local session_replication_role=replica;');
    for (const [table, records] of [['health_referrals', referrals], ['follow_ups', followups],
      ['maternal_records', maternal], ['immunizations', immunizations], ['tcl_entries', enrollments]]) {
      await query(`delete from public.${table} where id=any($1::uuid[])`, [records]);
    }
    await db.exec(`delete from public.visits where id='PRIVATE-ACTIVITY-BIRTHDAY';
      update public.residents set birth_date=null where id in ('PRIVATE-DATE-A','PRIVATE-DATE-B','PRIVATE-DATE-C'); commit;
      analyze public.residents,public.visits,public.health_referrals,public.follow_ups,public.maternal_records,public.immunizations,public.tcl_entries;`);
  }
});

test('zero-denominator activity is null, empty months are sparse and missing official eligibility never becomes a percentage', async () => {
  const activity = (await rpc(actors.secondary, 'early-warning', { from: '2026-01-01', to: '2026-01-31' })).activity;
  assert.deepEqual(activity.months, ['2026-01']);
  assert.deepEqual(activity.reportingPeriod, { from: '2026-01-01', to: '2026-01-31' });
  assert.equal(activity.rows.length, 1);
  assert.deepEqual(activity.rows[0].followUps, { scheduled: 0, completed: 0, completionPercent: null });
  assert.deepEqual(activity.rows[0].referrals, { created: 0, completed: 0, completionPercent: null });
  assert.equal(activity.rows[0].consultations.records, 1);
  assert.deepEqual(Object.keys(activity.rows[0].immunizations).sort(), ['records', 'residents']);
  assert.equal(activity.definitions.immunizations.denominator, null);
  assert.equal(activity.definitions.tclParticipation.denominator, null);
  const empty = (await rpc(actors.empty, 'early-warning', { year: 2026 })).activity;
  assert.equal(empty.scopeComplete, true);
  assert.equal(empty.months.length, 12);
  assert.deepEqual(empty.rows, []);
  assert.equal((await rpc(actors.unregistered, 'early-warning')).activity.scopeComplete, false);
  await assert.rejects(() => rpc(actors.secondary, 'early-warning', { from: '2026-06-02', to: '2026-06-01' }),
    (error) => error.code === '22023');
});

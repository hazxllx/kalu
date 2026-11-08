import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { attachRiskToResidents, assessResidentById, recalculateAll, getRiskSummary, getHighRiskResidents } from '../src/services/residentRisk.service.js';

test('production directory risk requests bounded authorized IDs, not capped/unscoped visit rows', async () => {
  const calls = [];
  const rows = Array.from({ length: 1201 }, (_, i) => ({ id: `resident-${i}` }));
  const supabase = { async rpc(name, params) {
    calls.push({ name, params });
    return { data: params.p_resident_ids.map((residentId) => ({ residentId, riskScore: 70, riskLevel: 'High', riskFactors: [], riskAssessedAt: null })), error: null };
  } };
  const repo = { driver: 'supabase', listVisits() { throw new Error('No full visit fetch allowed'); } };
  const result = await attachRiskToResidents(rows, { repo, supabase, user: { id: 'actor-a' } });
  assert.equal(result.length, 1201);
  assert.equal(result[1200].riskLevel, 'High');
  assert.deepEqual(calls.map((call) => call.params.p_resident_ids.length), [1000, 201]);
  assert.ok(calls.every((call) => call.name === 'resident_risk_for_ids' && call.params.p_actor_id === 'actor-a'));
});

test('missing migration or changed authorization never becomes fabricated unassessed directory data', async () => {
  const repo = { driver: 'supabase' };
  await assert.rejects(attachRiskToResidents([{ id: 'resident-a' }], { repo, supabase: { rpc: async () => ({ error: { code: '42883' } }) } }), { statusCode: 503 });
  await assert.rejects(attachRiskToResidents([{ id: 'resident-a' }], { repo, supabase: { rpc: async () => ({ data: [], error: null }) }, user: { id: 'actor-a' } }), { statusCode: 403 });
  await assert.rejects(assessResidentById({ id: 'resident-a', repo, supabase: { rpc: async () => ({ error: { code: '42501' } }) } }), { statusCode: 403 });
});

test('production configuration recalculation uses count-only SQL response without resident PII or limits', async () => {
  const repo = { driver: 'supabase', searchResidents() { throw new Error('No resident scan allowed'); } };
  let called;
  const result = await recalculateAll({ repo, municipalityId: 'municipality-a', supabase: { rpc: async (name, params) => {
    called = { name, params }; return { data: { updated: 6001, total: 6001 }, error: null };
  } } });
  assert.deepEqual(called, { name: 'recalculate_resident_risk', params: { p_barangay: null, p_municipality_id: 'municipality-a' } });
  assert.deepEqual(result, { updated: 6001, total: 6001 });
});

test('production risk summaries and high-risk pages never scan full resident/visit datasets', async () => {
  const calls = [];
  const summary = { totalResidents: 6001, assessed: 6001, high: 6001, moderate: 0, low: 0, highRiskPercentage: 100, distribution: [] };
  const user = { id: 'actor-a', role: 'phn', municipalityId: 'municipality-a' };
  const supabase = { rpc: async (name, params) => {
    calls.push({ name, params });
    return { data: { summary, highRisk: params.p_limit ? [{ residentId: 'high-resident', riskLevel: 'High', riskScore: 70, riskFactors: [] }] : [] }, error: null };
  } };
  let requested;
  const repo = { driver: 'supabase', listVisits() { throw new Error('No full visit scan'); }, searchResidents() { throw new Error('No full resident scan'); },
    listResidents: async (params) => { requested = params; return { rows: [{ id: 'high-resident' }], total: 1 }; } };
  assert.deepEqual(await getRiskSummary({ user, repo, supabase }), summary);
  assert.equal(calls[0].params.p_limit, 0);
  const high = await getHighRiskResidents({ user, repo, supabase, limit: 25, offset: 50 });
  assert.equal(high[0].resident.id, 'high-resident');
  assert.equal(high[0].riskLevel, 'High');
  assert.deepEqual(requested.ids, ['high-resident']);
  assert.equal(requested.municipalityId, 'municipality-a');
  assert.equal(calls[1].params.p_limit, 25);
  assert.equal(calls[1].params.p_offset, 50);
});

test('PostgreSQL risk detail/recalculation shares the real analytics evaluator beyond 5000 visits and preserves revisions', async () => {
  const pg = new PGlite();
  const municipality = '10000000-0000-4000-8000-000000000001';
  const outside = '10000000-0000-4000-8000-000000000002';
  const barangay = '20000000-0000-4000-8000-000000000001';
  const actor = '30000000-0000-4000-8000-000000000001';
  try {
    await pg.exec(`
      create role anon; create role authenticated; create role service_role;
      create table profiles(id uuid primary key, status text, role text, municipality_id uuid, barangay_id uuid);
      create table barangays(id uuid primary key, name text, municipality_id uuid);
      create function public.personnel_actor_has_permission(uuid,text) returns boolean language sql stable as $$select true$$;
      create table residents(id text primary key, auth_user_id uuid, municipality_id uuid, barangay_id uuid, barangay text,
        revision integer not null default 1, updated_at timestamptz default now(), risk_score numeric, risk_level text,
        risk_factors jsonb not null default '[]', risk_assessed_at timestamptz);
      create table visits(id text primary key, resident_id text references residents(id), visit_date timestamptz,
        created_at timestamptz default now(), updated_at timestamptz default now(),
        bp text default '', o2sat numeric, temperature numeric, hr numeric, rr numeric, height_cm numeric, weight_kg numeric);
      create table risk_criteria(code text, name text, field text, operator text, value numeric, value2 numeric, weight numeric, enabled boolean, priority integer);
      create table risk_settings(id boolean primary key, moderate_min numeric, high_min numeric);
      insert into profiles values ('${actor}','active','phn','${municipality}',null);
      insert into barangays values ('${barangay}','San Isidro','${municipality}');
      insert into residents(id,municipality_id,barangay_id,barangay) select 'resident-'||i,'${municipality}','${barangay}','San Isidro' from generate_series(1,6000) i;
      insert into residents(id,municipality_id,barangay_id,barangay) values ('outside-resident','${outside}','${barangay}','San Isidro');
      insert into visits(id,resident_id,visit_date,bp) select 'visit-'||i,'resident-'||i,'2026-11-04T09:00:00Z','160/100' from generate_series(1,6000) i;
      insert into visits(id,resident_id,visit_date,bp) values ('latest-low','resident-1','2026-11-05T09:00:00Z','110/70');
    `);
    const analytics = await readFile(new URL('../../supabase/migrations/20261106030000_scoped_aggregate_analytics.sql', import.meta.url), 'utf8');
    for (const name of ['analytics_assess_vitals', 'analytics_risk_configuration']) {
      const match = analytics.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'));
      assert.ok(match, `Actual migration helper ${name} exists`);
      await pg.exec(match[0]);
    }
    await pg.exec(await readFile(new URL('../../supabase/migrations/20261106040000_resident_revision_concurrency.sql', import.meta.url), 'utf8'));
    const riskSql = await readFile(new URL('../../supabase/migrations/20261106041000_bounded_resident_risk.sql', import.meta.url), 'utf8');
    await pg.exec(riskSql);
    await pg.exec(riskSql);
    const detail = await pg.query('select public.resident_risk_for_ids($1,$2) as result', [['resident-1', 'resident-6000', 'outside-resident'], actor]);
    assert.equal(detail.rows[0].result.length, 2);
    assert.equal(detail.rows[0].result.find((row) => row.residentId === 'resident-1').riskLevel, 'Low');
    assert.equal(detail.rows[0].result.find((row) => row.residentId === 'resident-6000').riskLevel, 'High');
    await assert.rejects(pg.query('select resident_risk_for_ids($1,$2)', [Array(1001).fill('resident-1'), actor]), /paginated/);
    const first = await pg.query('select recalculate_resident_risk(null,$1) as result', [municipality]);
    assert.deepEqual(first.rows[0].result, { total: 6000, updated: 6000 });
    const unchanged = await pg.query('select recalculate_resident_risk(null,$1) as result', [municipality]);
    assert.deepEqual(unchanged.rows[0].result, { total: 6000, updated: 0 });
    assert.deepEqual((await pg.query("select revision,risk_level from residents where id='resident-6000'")).rows, [{ revision: 2, risk_level: 'High' }]);
    assert.equal((await pg.query("select has_function_privilege('authenticated','resident_risk_for_ids(text[],uuid)','EXECUTE') as allowed")).rows[0].allowed, false);
    assert.equal((await pg.query("select risk_level from residents where id='outside-resident'")).rows[0].risk_level, null);
    const summary = (await pg.query('select resident_risk_summary($1,null,0,0) as result', [actor])).rows[0].result;
    assert.equal(summary.summary.totalResidents, 6000);
    assert.equal(summary.summary.high, 5999);
    assert.equal(summary.summary.low, 1);
    assert.deepEqual(summary.highRisk, []);
    const highPage = (await pg.query('select resident_risk_summary($1,null,5,5990) as result', [actor])).rows[0].result;
    assert.equal(highPage.highRisk.length, 5);
    assert.ok(highPage.highRisk.every((row) => row.riskLevel === 'High'));
    await pg.exec('create or replace function public.personnel_actor_has_permission(uuid,text) returns boolean language sql stable as $$select false$$;');
    await assert.rejects(pg.query('select resident_risk_summary($1)', [actor]), /active authorized account/);
  } finally { await pg.close(); }
});

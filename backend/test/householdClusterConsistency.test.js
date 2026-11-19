import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import ApiError from '../src/utils/apiError.js';
import { getRiskClusterSummary, getWorkflow, saveWorkflow } from '../src/services/householdRiskWorkflow.service.js';

const levels = ['priority', 'intervention', 'monitor', 'stable'];
const fixtures = levels.map((level, index) => ({ id: `HH-TEST-0${21 + index}`, level }));
const worker = { id: 'synthetic-worker', role: 'phn', municipalityId: 'synthetic-municipality' };

const database = ({ households = [], initial = [], pageResponse } = {}) => {
  const rows = new Map(initial.map((row) => [row.household_id, row]));
  const calls = [];
  const client = {
    from(table) {
      calls.push({ table });
      let saved;
      let id;
      const filters = [];
      const query = {
        select() { return query; },
        eq(field, value) { filters.push([field, value]); if (field === 'household_id') id = value; return query; },
        order(field, options) { calls.push({ order: field, ...options }); return query; },
        upsert(row) { saved = { workflow_status: 'Unassigned', ...(rows.get(row.household_id) || {}), ...row }; rows.set(row.household_id, saved); return query; },
        single: async () => ({ data: saved, error: null }),
        maybeSingle: async () => ({ data: rows.get(id) || null, error: null }),
        async range(from, to) {
          calls.push({ from, to, filters });
          if (pageResponse) return pageResponse({ from, to, filters });
          const scoped = households.filter((row) => filters.every(([key, value]) => row[key] === value))
            .sort((a, b) => a.id.localeCompare(b.id));
          return { count: scoped.length, error: null, data: scoped.slice(from, to + 1).map((row) => ({
            id: row.id, risk_workflow: row.array ? [rows.get(row.id)].filter(Boolean) : rows.get(row.id) || null,
          })) };
        },
      };
      return query;
    },
  };
  return { rows, client, calls };
};

test('KFT-017 HH-TEST-021..024 persist and retrieve four separate cluster assignments', async () => {
  const db = database();
  const checked = [];
  const scopeCheck = async ({ id, user }) => { checked.push(id); assert.equal(user, worker); return { id }; };
  for (const fixture of fixtures) {
    const saved = await saveWorkflow({ id: fixture.id, user: worker, patch: { riskClusterLevel: fixture.level.toUpperCase() }, supabase: db.client, scopeCheck });
    const loaded = await getWorkflow({ id: fixture.id, user: worker, supabase: db.client, scopeCheck });
    assert.equal(saved.riskClusterLevel, fixture.level);
    assert.equal(loaded.riskClusterLevel, fixture.level);
    assert.equal(loaded.householdId, fixture.id);
    assert.equal(db.rows.get(fixture.id).risk_cluster_level, fixture.level);
  }
  assert.equal(checked.length, 8);
});

test('KFT-017 an unrelated workflow update preserves the assignment and explicit null clears it', async () => {
  const db = database({ initial: [{ household_id: 'HH-TEST-021', risk_cluster_level: 'priority' }] });
  const options = { id: 'HH-TEST-021', user: worker, supabase: db.client, scopeCheck: async () => ({}) };
  const unrelated = await saveWorkflow({ ...options, patch: { lastNote: 'Synthetic follow-up note' } });
  assert.equal(unrelated.riskClusterLevel, 'priority');
  const cleared = await saveWorkflow({ ...options, patch: { riskClusterLevel: null } });
  assert.equal(cleared.riskClusterLevel, null);
  assert.equal((await getWorkflow(options)).riskClusterLevel, null);
});

test('KFT-017 invalid assignments are rejected and invalid or missing stored values never become Stable', async () => {
  for (const value of ['Low', 'High', 'unknown', 5, true, {}]) {
    const db = database();
    await assert.rejects(saveWorkflow({ id: 'HH-TEST-021', user: worker, patch: { riskClusterLevel: value }, supabase: db.client, scopeCheck: async () => ({}) }), { statusCode: 422 });
    assert.equal(db.rows.size, 0);
  }
  const db = database({ initial: [{ household_id: 'HH-TEST-021', risk_cluster_level: 'incorrect' }] });
  const options = { user: worker, supabase: db.client, scopeCheck: async () => ({}) };
  assert.equal((await getWorkflow({ ...options, id: 'HH-TEST-021' })).riskClusterLevel, null);
  assert.equal(await getWorkflow({ ...options, id: 'HH-TEST-024' }), null);
});

test('KFT-017 MHO aggregate reads every scoped page and never exposes household records', async () => {
  const households = Array.from({ length: 1205 }, (_, index) => ({
    id: index < 4 ? fixtures[index].id : `HH-SYNTHETIC-${String(index).padStart(4, '0')}`,
    municipality_id: worker.municipalityId, barangay: index % 2 ? 'Synthetic B' : 'Synthetic A', array: index % 2,
  }));
  households.push({ id: 'HH-OUTSIDE', municipality_id: 'other-municipality', barangay: 'Synthetic A' });
  const initial = fixtures.map(({ id, level }) => ({ household_id: id, risk_cluster_level: level }));
  initial.push({ household_id: 'HH-SYNTHETIC-0004', risk_cluster_level: 'incorrect' });
  const db = database({ households, initial });
  const summary = await getRiskClusterSummary({ user: { ...worker, role: 'mho', barangay: 'Synthetic A', barangayId: 'incidental-assignment' }, supabase: db.client });
  assert.equal(summary.totalHouseholds, 1205);
  assert.equal(summary.classifiedHouseholds, 4);
  assert.deepEqual(summary.riskDistribution, [
    ...levels.map((name) => ({ name, value: 1 })), { name: 'unassessed', value: 1201 },
  ]);
  assert.deepEqual(db.calls.filter((call) => call.from !== undefined).map(({ from, to }) => [from, to]), [[0, 499], [500, 999], [1000, 1499]]);
  assert.doesNotMatch(JSON.stringify(summary), /HH-TEST|HH-SYNTHETIC|HH-OUTSIDE/);
  const scoped = await getRiskClusterSummary({ user: { ...worker, role: 'health_supervisor', barangay: 'Synthetic A' }, supabase: db.client });
  assert.equal(scoped.totalHouseholds, 603);
  assert.equal(scoped.classifiedHouseholds, 2);
});

test('KFT-017 original household scope and read-only MHO access restrictions remain enforced', async () => {
  const db = database();
  await assert.rejects(saveWorkflow({ id: 'HH-TEST-021', user: { ...worker, role: 'mho' }, patch: { riskClusterLevel: 'stable' }, supabase: db.client, scopeCheck: async () => ({}) }), { statusCode: 403 });
  const deny = async () => { throw ApiError.notFound('Synthetic out-of-scope household'); };
  await assert.rejects(getWorkflow({ id: 'HH-OUTSIDE', user: worker, supabase: db.client, scopeCheck: deny }), { statusCode: 404 });
  await assert.rejects(saveWorkflow({ id: 'HH-OUTSIDE', user: worker, patch: { riskClusterLevel: 'stable' }, supabase: db.client, scopeCheck: deny }), { statusCode: 404 });
  await assert.rejects(getRiskClusterSummary({ user: { role: 'mho' }, supabase: db.client }), { statusCode: 403 });
  await assert.rejects(getRiskClusterSummary({ user: { ...worker, role: 'health_supervisor' }, supabase: db.client }), { statusCode: 403 });
  assert.equal(db.calls.length, 0);
  const route = await readFile(new URL('../src/routes/households.routes.js', import.meta.url), 'utf8');
  assert.match(route, /'\/risk-clusters\/summary',\s*authorize\(FEATURE_ROLES\.analytics, \{ permission: 'reports\.analytics\.view' \}\),\s*asyncHandler\(householdRiskWorkflowController\.getRiskClusterSummary\)/);
});

test('KFT-017 malformed, truncated and unavailable cluster sources cannot fabricate a distribution', async () => {
  const badPages = [
    () => ({ data: null, count: 0 }),
    () => ({ data: [], count: null }),
    () => ({ data: [], count: 1 }),
    () => ({ data: [{ id: 'HH-TEST-021' }], count: 2 }),
  ];
  for (const pageResponse of badPages) {
    const db = database({ pageResponse });
    await assert.rejects(getRiskClusterSummary({ user: worker, supabase: db.client }), { statusCode: 500 });
  }
  const db = database({ pageResponse: () => ({ data: null, error: { message: 'column household_risk_workflow.risk_cluster_level does not exist', code: '42703' } }) });
  await assert.rejects(getRiskClusterSummary({ user: worker, supabase: db.client }), (error) => error.statusCode === 503 && /20261119050000/.test(error.message));
});

test('KFT-017 migration accepts exactly the four persisted levels or null and rejects invalid SQL values', async () => {
  const db = await PGlite.create();
  try {
    await db.exec('create table public.household_risk_workflow (household_id text primary key)');
    const migration = await readFile(new URL('../../supabase/migrations/20261119050000_household_cluster_assignment.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    for (const fixture of fixtures) await db.query('insert into public.household_risk_workflow (household_id, risk_cluster_level) values ($1, $2)', [fixture.id, fixture.level]);
    await db.exec("insert into public.household_risk_workflow (household_id) values ('HH-TEST-UNASSESSED')");
    assert.equal((await db.query('select count(*)::integer as count from public.household_risk_workflow')).rows[0].count, 5);
    await assert.rejects(db.query('insert into public.household_risk_workflow (household_id, risk_cluster_level) values ($1, $2)', ['HH-TEST-INVALID', 'Low']), { code: '23514' });
  } finally {
    await db.close();
  }
});

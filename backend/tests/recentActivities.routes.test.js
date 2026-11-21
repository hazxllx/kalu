import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { configureLocalTestEnvironment } from '../test/helpers/localEnv.js';

configureLocalTestEnvironment();
const { default: router } = await import('../src/routes/analytics.routes.js');
const { default: errorHandler } = await import('../src/middleware/errorHandler.js');
const { getServiceClient } = await import('../src/config/supabase.js');
const ACTOR = '11111111-1111-4111-8111-111111111111';
const MUNICIPALITY = '22222222-2222-4222-8222-222222222222';
const BARANGAY = '33333333-3333-4333-8333-333333333333';

const harness = async ({ role = 'health_supervisor', permission = true, status = 'active', rpcError = null } = {}, run) => {
  const client = getServiceClient();
  const originals = { from: client.from, rpc: client.rpc, getUser: client.auth.getUser };
  const calls = [];
  client.auth.getUser = async (token) => token === 'verified' ? {
    data: { user: { id: ACTOR, email: 'staff@example.test' } }, error: null,
  } : { data: { user: null }, error: { status: 401 } };
  client.from = (table) => {
    const result = () => {
      if (table === 'profiles') return { data: { id: ACTOR, role, status, full_name: 'PRIVATE STAFF',
        municipality_id: MUNICIPALITY, barangay_id: BARANGAY,
        barangay: { id: BARANGAY, name: 'San Antonio', status: 'Active', municipality_id: MUNICIPALITY } }, error: null };
      if (table === 'personnel_accounts') return { data: null, error: null };
      if (table === 'role_permissions') return { data: [{ permission_id: 'reports.analytics.view', granted: permission }], error: null };
      throw new Error(`Unexpected row read: ${table}`);
    };
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => result(),
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject) };
    return chain;
  };
  client.rpc = async (name, params) => {
    calls.push({ name, params });
    return { data: { activities: [{ id: '0123456789abcdef0123456789abcdef', kind: 'visit_created',
      occurredAt: '2026-11-21T10:00:00Z', notes: 'PRIVATE CLINICAL NOTE', href: '/PRIVATE' }] }, error: rpcError };
  };
  const app = express();
  app.use('/api/analytics', router);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const api = async (query = '', token = 'verified') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/analytics/recent-activities${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: response.status, body: await response.json(), cacheControl: response.headers.get('cache-control') };
  };
  try { return await run({ api, calls }); }
  finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    client.from = originals.from;
    client.rpc = originals.rpc;
    client.auth.getUser = originals.getUser;
  }
};

test('recent activities HTTP route authenticates, authorizes role and analytics permission before querying', async () => {
  await harness({}, async ({ api, calls }) => {
    assert.equal((await api('', null)).status, 401);
    assert.equal((await api('', 'invalid')).status, 401);
    assert.equal(calls.length, 0);
  });
  for (const options of [{ role: 'bhw' }, { role: 'admin' }, { role: 'resident' }, { permission: false }, { status: 'disabled' }]) {
    await harness(options, async ({ api, calls }) => {
      assert.equal((await api()).status, 403);
      assert.equal(calls.length, 0);
    });
  }
});

test('real scope middleware rejects every cross-barangay filter and binds own assignment to the verified actor', async () => {
  await harness({}, async ({ api, calls }) => {
    for (const query of ['?barangay=San%20Isidro', '?barangayId=foreign', '?barangay_id=foreign']) {
      assert.equal((await api(query)).status, 403);
    }
    assert.equal(calls.length, 0);
    const result = await api('?barangay=San%20Antonio&actorId=forged&municipalityId=foreign&limit=100');
    assert.equal(result.status, 200);
    assert.equal(result.cacheControl, 'private, no-store');
    assert.deepEqual(calls, [{ name: 'scoped_recent_monitoring_activities', params: { p_actor_id: ACTOR, p_barangay: 'San Antonio' } }]);
    assert.equal(result.body.data.activities.length, 1);
    assert.equal(result.body.data.activities[0].title, 'Visit recorded');
    assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE|notes|href/);
  });
});

test('municipal analytics roles use the same RPC without a client-controlled municipality', async () => {
  for (const role of ['phn', 'mho']) {
    await harness({ role }, async ({ api, calls }) => {
      assert.equal((await api('?barangay=San%20Isidro&municipalityId=forged')).status, 200);
      assert.deepEqual(calls[0].params, { p_actor_id: ACTOR, p_barangay: 'San Isidro' });
      assert.equal((await api('?barangay=Unknown')).status, 422);
      assert.equal(calls.length, 1);
    });
  }
});

test('SQL authorization failure or missing migration cannot turn into an empty successful HTTP feed', async () => {
  for (const [code, expected] of [['42501', 403], ['PGRST202', 503]]) {
    await harness({ rpcError: { code, message: 'PRIVATE DATABASE DETAIL' } }, async ({ api }) => {
      const result = await api();
      assert.equal(result.status, expected);
      assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE/);
    });
  }
});

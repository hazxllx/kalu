import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://personnel-routes-tests.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'personnel-test-service-key';
process.env.SUPABASE_ANON_KEY = 'personnel-test-anon-key';
process.env.AUTH_RATE_LIMIT_MAX_REQUESTS = '10';
process.env.AUTH_RATE_LIMIT_WINDOW_MS = '900000';

const usersRouter = (await import('../src/routes/users.routes.js')).default;
const authRouter = (await import('../src/routes/auth.routes.js')).default;
const staffRouter = (await import('../src/routes/staffAccounts.routes.js')).default;
const errorHandler = (await import('../src/middleware/errorHandler.js')).default;
const repository = (await import('../src/repositories/supabaseRepository.js')).default;
const { getServiceClient } = await import('../src/config/supabase.js');

const ACTOR = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const OPERATION = '33333333-3333-4333-8333-333333333333';
const MUNICIPALITY = '44444444-4444-4444-8444-444444444444';
const BARANGAY = '55555555-5555-4555-8555-555555555555';
const REQUEST = '77777777-7777-4777-8777-777777777777';
const PASSWORD = 'OwnerChosen9!';
const ALL_PERMISSIONS = ['accounts.view', 'accounts.create', 'accounts.roles.manage', 'accounts.edit', 'accounts.personnel.approve', 'accounts.deactivate', 'accounts.access.reset', 'accounts.delete'];

const withMethods = async (object, overrides, run) => {
  const originals = Object.fromEntries(Object.keys(overrides).map((key) => [key, object[key]]));
  Object.assign(object, overrides);
  try { return await run(); } finally { Object.assign(object, originals); }
};
const profile = (patch = {}) => ({
  id: TARGET, email: 'nurse@example.gov', name: 'Nurse Juana', role: 'phn', status: 'disabled',
  municipalityId: MUNICIPALITY, rhuStations: [], approvalStatus: 'approved', activationRequested: true,
  setupRequired: true, setupCompletedAt: null, suspendedAt: null, lifecycleVersion: 1, ...patch,
});

const harness = async ({ role = 'admin', status = 'active', permissions = ALL_PERMISSIONS, repo = {}, ownerId = ACTOR, request = null } = {}, run) => {
  const client = getServiceClient();
  const authCalls = [];
  const dbWrites = [];
  const from = (table) => {
    const result = () => {
      if (table === 'profiles') return { data: {
        id: ACTOR, email: 'actor@example.gov', full_name: 'Verified Actor', role, status,
        municipality_id: MUNICIPALITY, barangay_id: BARANGAY, facility_id: null, rhu_stations: [],
        barangay: { id: BARANGAY, name: 'San Isidro', status: 'Active', municipality_id: MUNICIPALITY },
      }, error: null };
      if (table === 'role_permissions') return { data: ALL_PERMISSIONS.map((permission_id) => ({ permission_id, granted: permissions.includes(permission_id) })), error: null };
      if (table === 'staff_account_requests') return { data: request, error: null };
      if (table === 'staff_registration_documents') return { data: [], error: null };
      throw new Error(`Unexpected test database read: ${table}`);
    };
    const chain = {
      select: () => chain, eq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => result(),
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
      update: () => { dbWrites.push(table); throw new Error('must not use separate profile/request writes'); },
      insert: () => { dbWrites.push(table); throw new Error('must not use separate inserts'); },
    };
    return chain;
  };
  return withMethods(client.auth, {
    getUser: async (token) => {
      authCalls.push(token);
      if (token !== 'verified-token') return { data: { user: null }, error: { status: 401 } };
      return { data: { user: { id: ownerId, email: 'actor@example.gov', email_confirmed_at: '2026-10-31T09:00:00Z', app_metadata: { personnel_managed: true, role: 'admin' } } }, error: null };
    },
  }, () => withMethods(client, { from }, () => withMethods(repository, repo, async () => {
    const app = express();
    app.use(express.json());
    app.use('/users', usersRouter);
    app.use('/auth', authRouter);
    app.use('/staff-accounts', staffRouter);
    app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const api = async (path, { token = 'verified-token', body, method = 'GET', headers = {} } = {}) => {
      const response = await fetch(`${origin}${path}`, {
        method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      });
      return { status: response.status, json: await response.json(), headers: response.headers };
    };
    try { return await run({ api, client, authCalls, dbWrites }); }
    finally { server.closeAllConnections(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  })));
};

test('public registration route rejects before malformed multipart parsing, upload and Auth', async () => {
  await harness({}, async ({ api, authCalls, dbWrites }) => {
    const result = await api('/staff-accounts/register', { token: null, method: 'POST', body: 'not multipart data', headers: { 'Content-Type': 'multipart/form-data' } });
    assert.equal(result.status, 403);
    assert.match(result.json.error.message, /registration is disabled/i);
    assert.deepEqual(authCalls, []);
    assert.deepEqual(dbWrites, []);
  });
});

test('all users endpoints require a real token and the actual profile admin role, not Auth/client role metadata', async () => {
  await harness({}, async ({ api }) => {
    assert.equal((await api('/users', { token: null })).status, 401);
    assert.equal((await api('/users', { token: 'invalid-token' })).status, 401);
  });
  for (const role of ['mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw', 'resident']) {
    await harness({ role }, async ({ api }) => {
      for (const [path, method, body] of [
        ['/users', 'GET'], ['/users/options', 'GET'], ['/users/summary', 'GET'], [`/users/${TARGET}`, 'GET'],
        [`/users/${TARGET}/history`, 'GET'], ['/users', 'POST', {}], [`/users/${TARGET}`, 'PUT', {}],
        [`/users/${TARGET}/lifecycle`, 'POST', { action: 'approve', operationId: OPERATION }],
      ]) assert.equal((await api(path, { method, body })).status, 403, `${role} ${method} ${path}`);
    });
  }
});

test('approved creation requires create, role management, approval and activation permissions; pending/inactive creation does not need approval', async () => {
  let created = 0;
  const repo = {
    getAccountAssignmentOptions: async () => ({ municipalities: [{ id: MUNICIPALITY }], barangays: [], facilities: [] }),
    reservePersonnelAccount: async () => ({ target_id: TARGET, completed: true }),
    createPersonnelAccountProfile: async ({ actorId }) => { assert.equal(actorId, ACTOR); created += 1; return profile(); },
    getProfileById: async () => profile(),
  };
  const body = { fullName: 'Nurse Juana', email: 'nurse@example.gov', role: 'phn', municipalityId: MUNICIPALITY, operationId: OPERATION };
  await harness({ permissions: ['accounts.create', 'accounts.roles.manage'], repo }, async ({ api }) => {
    assert.equal((await api('/users', { method: 'POST', body: { ...body, approvalStatus: 'approved', activate: false } })).status, 403);
    assert.equal((await api('/users', { method: 'POST', body: { ...body, approvalStatus: 'pending', activate: false } })).status, 201);
    assert.equal((await api('/users', { method: 'POST', body: { ...body, approvalStatus: 'pending', activate: true } })).status, 403);
  });
  await harness({ permissions: ['accounts.create', 'accounts.roles.manage', 'accounts.personnel.approve'], repo }, async ({ api }) => {
    assert.equal((await api('/users', { method: 'POST', body: { ...body, activate: false, actorId: TARGET } })).status, 201);
    assert.equal((await api('/users', { method: 'POST', body: { ...body, status: 'disabled', activate: false } })).status, 201);
    assert.equal((await api('/users', { method: 'POST', body })).status, 403);
  });
  assert.equal(created, 3);
});

test('lifecycle actions enforce their own configured permissions and take actor only from verified req.user', async () => {
  const actions = [];
  const repo = {
    transitionPersonnelAccount: async (args) => { actions.push(args); return profile(); },
    getProfileById: async () => profile(),
  };
  await harness({ permissions: ['accounts.personnel.approve'], repo }, async ({ api }) => {
    assert.equal((await api(`/users/${TARGET}/lifecycle`, { method: 'POST', body: { action: 'approve', activate: false, actorId: TARGET, operationId: OPERATION } })).status, 200);
    assert.equal((await api(`/users/${TARGET}/lifecycle`, { method: 'POST', body: { action: 'approve', activate: true, operationId: OPERATION } })).status, 403);
    assert.equal((await api(`/users/${TARGET}/lifecycle`, { method: 'POST', body: { action: 'suspend', reason: 'Access withheld', operationId: OPERATION } })).status, 403);
    assert.equal((await api(`/users/${TARGET}/lifecycle`, { method: 'POST', body: { action: 'invite', operationId: OPERATION } })).status, 403);
  });
  await harness({ permissions: ['accounts.deactivate'], repo }, async ({ api }) => {
    assert.equal((await api(`/users/${TARGET}/lifecycle`, { method: 'POST', body: { action: 'suspend', reason: 'Access withheld', operationId: OPERATION } })).status, 200);
    assert.equal((await api(`/users/${TARGET}/lifecycle`, { method: 'POST', body: { action: 'reject', reason: 'Credentials invalid', operationId: OPERATION } })).status, 403);
  });
  await harness({ permissions: ['accounts.access.reset'], repo }, async ({ api }) => {
    assert.equal((await api(`/users/${TARGET}/lifecycle`, { method: 'POST', body: { action: 'retry_email', operationId: OPERATION } })).status, 200);
  });
  assert.ok(actions.every(({ actorId }) => actorId === ACTOR));
  assert.deepEqual(actions.map(({ action }) => action), ['approve', 'suspend', 'retry_email']);
});

test('invalid target UUID, operation, action, boolean or reason never reaches lifecycle RPC', async () => {
  await harness({ repo: { transitionPersonnelAccount: async () => { throw new Error('invalid action reached SQL'); } } }, async ({ api }) => {
    assert.equal((await api('/users/not-a-uuid/lifecycle', { method: 'POST', body: { action: 'approve', operationId: OPERATION } })).status, 400);
    for (const body of [
      { action: 'approve', operationId: 'bad' }, { action: 'unknown', operationId: OPERATION },
      { action: 'approve', activate: 'false', operationId: OPERATION },
      { action: 'reject', operationId: OPERATION }, { action: 'suspend', reason: ' ', operationId: OPERATION },
    ]) assert.equal((await api(`/users/${TARGET}/lifecycle`, { method: 'POST', body })).status, 400);
  });
});

test('assignment and station edits require account edit plus role-management permissions', async () => {
  let edits = 0;
  const repo = { getProfileById: async () => profile(), updatePersonnelAccountProfile: async () => { edits += 1; return profile(); } };
  await harness({ permissions: ['accounts.edit'], repo }, async ({ api }) => {
    assert.equal((await api(`/users/${TARGET}`, { method: 'PUT', body: { contact: '09180000000' } })).status, 200);
    assert.equal((await api(`/users/${TARGET}`, { method: 'PUT', body: { rhuStations: ['triage'] } })).status, 403);
    assert.equal((await api(`/users/${TARGET}`, { method: 'PUT', body: { municipalityId: MUNICIPALITY } })).status, 403);
    assert.equal((await api(`/users/${TARGET}`, { method: 'PUT', body: { status: 'active' } })).status, 403);
  });
  assert.equal(edits, 1);
});

test('list and summary pass exact personnel and approval filters before repository pagination', async () => {
  await harness({ repo: {
    listProfiles: async (filters) => {
      assert.equal(filters.personnelOnly, true); assert.equal(filters.approvalStatus, 'approved');
      assert.equal(filters.lifecycleState, 'awaiting_setup'); assert.equal(filters.offset, 50); assert.equal(filters.limit, 50);
      return { rows: [profile()], total: 150 };
    },
    getAccountSummary: async (filters) => { assert.deepEqual(filters, { personnelOnly: true, approvalStatus: 'pending' }); return { total: 100, pendingApproval: 100 }; },
  } }, async ({ api }) => {
    const result = await api('/users?personnelOnly=true&approvalStatus=approved&lifecycleState=awaiting_setup&offset=50&limit=50');
    assert.equal(result.status, 200); assert.equal(result.json.data.total, 150);
    assert.equal((await api('/users/summary?personnelOnly=true&approvalStatus=pending')).json.data.pendingApproval, 100);
    assert.equal((await api('/users?personnelOnly=no')).status, 400);
  });
});

test('historical PHN and HS review hierarchy remains separate from admin users authority', async () => {
  const request = { id: REQUEST, auth_user_id: TARGET, role: 'health_supervisor', municipality_id: MUNICIPALITY, barangay_id: BARANGAY, status: 'pending' };
  const repo = { reviewPersonnelAccountRequest: async ({ actorId }) => { assert.equal(actorId, ACTOR); return { ...request, status: 'approved', decided_by: ACTOR, profileStatus: 'disabled' }; } };
  await harness({ role: 'phn', permissions: ['accounts.personnel.approve'], request, repo }, async ({ api, dbWrites }) => {
    const result = await api(`/staff-accounts/${REQUEST}/approve`, { method: 'POST', body: { remarks: 'Reviewed', actorId: TARGET } });
    assert.equal(result.status, 200); assert.equal(result.json.data.request.active, false);
    assert.equal(result.json.data.request.profileStatus, 'disabled'); assert.deepEqual(dbWrites, []);
  });
  await harness({ role: 'admin', request, repo }, async ({ api }) => {
    assert.equal((await api(`/staff-accounts/${REQUEST}/approve`, { method: 'POST', body: {} })).status, 403);
  });
});

test('setup status verifies real bearer identity without ordinary active-profile guard', async () => {
  await harness({ status: 'disabled', ownerId: TARGET, repo: { getPersonnelSetupAccount: async (id) => { assert.equal(id, TARGET); return profile(); } } }, async ({ api, authCalls }) => {
    const result = await api('/auth/personnel/setup-status');
    assert.equal(result.status, 200); assert.equal(result.json.data.setupRequired, true); assert.equal(result.json.data.active, false);
    assert.deepEqual(authCalls, ['verified-token']);
    assert.equal((await api('/auth/personnel/setup-status', { token: null })).status, 401);
    assert.equal((await api('/auth/personnel/setup-status', { token: 'invalid-token' })).status, 401);
  });
});

test('password setup rejects client ids/roles and weak passwords without updating anyone', async () => {
  await harness({ ownerId: TARGET }, async ({ api, client }) => withMethods(client.auth.admin, {
    updateUserById: async () => { throw new Error('invalid setup must not update Auth'); },
  }, async () => {
    for (const body of [{ password: PASSWORD, targetId: ACTOR }, { password: PASSWORD, role: 'admin' }, { password: 'password1' }]) {
      assert.equal((await api('/auth/personnel/password-setup', { method: 'POST', body })).status, 400);
    }
  }));
});

test('password setup SQL failure after saved password returns accurate HTTP 200 partial data', async () => {
  const calls = [];
  await harness({ ownerId: TARGET, status: 'disabled', repo: {
    getPersonnelSetupAccount: async () => profile(),
    completePersonnelAccountSetup: async (id) => { calls.push(['complete', id]); throw new Error('RPC transport failure'); },
  } }, async ({ api, client }) => withMethods(client.auth.admin, {
    updateUserById: async (id, input) => { calls.push(['password', id]); assert.deepEqual(input, { password: PASSWORD }); return { data: { user: { id } }, error: null }; },
  }, async () => {
    const result = await api('/auth/personnel/password-setup', { method: 'POST', body: { password: PASSWORD } });
    assert.equal(result.status, 200);
    assert.equal(result.json.data.passwordSaved, true); assert.equal(result.json.data.setupComplete, false); assert.equal(result.json.data.active, false);
    assert.deepEqual(calls, [['password', TARGET], ['complete', TARGET]]);
    assert.doesNotMatch(JSON.stringify(result.json), /OwnerChosen9|RPC transport/);
  }));
});

test('password setup attempts are rate limited independently of ordinary authenticated routes', async () => {
  await harness({}, async ({ api }) => {
    let limited;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const result = await api('/auth/personnel/password-setup', { method: 'POST', body: {} });
      if (result.status === 429) { limited = result; break; }
    }
    assert.equal(limited?.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  });
});

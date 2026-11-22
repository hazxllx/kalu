import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { configureLocalTestEnvironment } from './helpers/localEnv.js';
configureLocalTestEnvironment();

const repository = (await import('../src/repositories/supabaseRepository.js')).default;
const { getServiceClient } = await import('../src/config/supabase.js');
const { setupPersonnelPassword } = await import('../src/services/auth.service.js');

const ACTOR = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const OPERATION = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'nurse@example.gov';
const PASSWORD = 'OwnerChosen9!';
const rawProfile = (patch = {}) => ({
  id: TARGET, email: EMAIL, full_name: 'Nurse Juana', role: 'phn', status: 'disabled', rhu_stations: [],
  personnel_account: { account_id: TARGET, approval_status: 'approved', activation_requested: true, setup_required: true, version: 1 },
  notifications: [{ id: OPERATION, account_id: TARGET, event_type: 'approved', status: 'pending', attempts: 0, claim_token: 'SECRET-CLAIM', action_link: 'SECRET-LINK' }],
  ...patch,
});

// Use the actual Supabase SDK with a test-only transport. Unexpected hosts or
// requests are rejected; no network, credentials, SMTP or remote SQL is used.
const nativeFetch = globalThis.fetch;
let transport;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url || String(input));
  assert.equal(url.origin, process.env.SUPABASE_URL, 'tests must never access a real server');
  assert.ok(transport, 'an isolated test transport must be installed');
  return transport(url, { ...init, headers: new Headers(init.headers) });
};
after(() => { globalThis.fetch = nativeFetch; });
getServiceClient();
const respond = (data, { status = 200, count } = {}) => new Response(data === null ? null : JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', ...(count !== undefined ? { 'Content-Range': `*/${count}` } : {}) },
});
const withTransport = async (handler, run) => {
  transport = handler;
  try { return await run(); } finally { transport = null; }
};

test('personnel list sends exact filters and pagination through real Supabase query builder', async () => {
  await withTransport(async (url, request) => {
    assert.equal(url.pathname, '/rest/v1/profiles');
    assert.equal(request.headers.get('authorization'), `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`);
    assert.equal(url.searchParams.get('role'), 'in.(mho,phn,health_supervisor,rhu_personnel,bhw)');
    assert.equal(url.searchParams.get('personnel_account.approval_status'), 'eq.approved');
    assert.equal(url.searchParams.get('personnel_account.suspended_at'), 'is.null');
    assert.equal(url.searchParams.get('personnel_account.setup_required'), 'eq.true');
    assert.equal(url.searchParams.get('offset'), '50');
    assert.equal(url.searchParams.get('limit'), '50');
    assert.equal(url.searchParams.get('notifications.limit'), '1');
    assert.equal(url.searchParams.get('notifications.order'), 'created_at.desc');
    assert.match(url.searchParams.get('select'), /personnel_accounts!account_id!inner/);
    assert.match(url.searchParams.get('select'), /personnel_notification_outbox!account_id/);
    assert.doesNotMatch(url.searchParams.get('select'), /(?:^|[,(!])(?:password|password_hash|temporary_password|action_link|claim_token|claimed_at)(?:[,!)])/);
    return respond([rawProfile()], { count: 150 });
  }, async () => {
    const result = await repository.listProfiles({ personnelOnly: true, lifecycleState: 'awaiting_setup', offset: 50, limit: 50 });
    assert.equal(result.total, 150);
    assert.equal(result.rows[0].notification.status, 'pending');
    assert.doesNotMatch(JSON.stringify(result), /SECRET-/);
  });
});

test('delegated personnel list applies its permitted roles without an undefined variable error', async () => {
  await withTransport(async (url) => {
    assert.equal(url.pathname, '/rest/v1/profiles');
    assert.equal(url.searchParams.get('role'), 'in.(health_supervisor,rhu_personnel)');
    assert.equal(url.searchParams.get('municipality_id'), `eq.${ACTOR}`);
    return respond([], { count: 0 });
  }, async () => {
    const result = await repository.listProfiles({
      roles: ['health_supervisor', 'rhu_personnel'],
      municipalityId: ACTOR,
      personnelOnly: true,
    });
    assert.deepEqual(result, { rows: [], total: 0 });
  });
});

test('the Resident directory filter includes pending resident identities', async () => {
  await withTransport(async (url) => {
    assert.equal(url.searchParams.get('role'), 'in.(resident,resident-limited)');
    return respond([rawProfile({ role: 'resident-limited', status: 'pending_verification', personnel_account: null })], { count: 1 });
  }, async () => {
    const result = await repository.listProfiles({ role: 'resident' });
    assert.equal(result.total, 1);
    assert.equal(result.rows[0].role, 'resident-limited');
  });
});

test('each lifecycle state is filtered in SQL before any rows are paginated', async () => {
  for (const [lifecycleState, expected] of [
    ['pending', { 'personnel_account.approval_status': 'eq.pending' }],
    ['rejected', { 'personnel_account.approval_status': 'eq.rejected' }],
    ['suspended', { 'personnel_account.approval_status': 'eq.approved', 'personnel_account.suspended_at': 'not.is.null' }],
    ['active', { status: 'eq.active', 'personnel_account.setup_required': 'eq.false', 'personnel_account.suspended_at': 'is.null' }],
    ['approved_inactive', { status: 'neq.active', 'personnel_account.setup_required': 'eq.false', 'personnel_account.suspended_at': 'is.null' }],
  ]) {
    await withTransport(async (url) => {
      for (const [field, value] of Object.entries(expected)) assert.equal(url.searchParams.get(field), value, lifecycleState);
      assert.match(url.searchParams.get('select'), /personnel_accounts!account_id!inner/);
      return respond([], { count: 0 });
    }, async () => assert.equal((await repository.listProfiles({ personnelOnly: true, lifecycleState })).total, 0));
  }
});

test('summary exact counts retain personnel and approval filters on every head-only query', async () => {
  let requests = 0;
  await withTransport(async (url, request) => {
    requests += 1;
    assert.equal(request.method, 'HEAD');
    assert.equal(url.searchParams.get('role'), 'in.(mho,phn,health_supervisor,rhu_personnel,bhw)');
    assert.match(url.searchParams.get('select'), /personnel_accounts!account_id!inner/);
    const approvals = url.searchParams.getAll('personnel_account.approval_status');
    assert.equal(approvals[0], 'eq.pending');
    const impossible = approvals.some((value) => value !== 'eq.pending') || ['eq.active', 'eq.disabled'].includes(url.searchParams.get('status'));
    return respond(null, { count: impossible ? 0 : 25 });
  }, async () => {
    const result = await repository.getAccountSummary({ personnelOnly: true, approvalStatus: 'pending' });
    assert.equal(requests, 10);
    assert.equal(result.total, 25); assert.equal(result.pendingApproval, 25);
    assert.equal(result.approved, 0); assert.equal(result.rejected, 0); assert.equal(result.awaitingSetup, 0); assert.equal(result.suspended, 0);
  });
});

test('resident verification and registration status updates cannot reactivate administratively disabled accounts', async () => {
  for (const status of ['active', 'pending_verification']) {
    await withTransport(async (url, request) => {
      assert.equal(request.method, 'PATCH');
      assert.equal(url.pathname, '/rest/v1/profiles');
      assert.equal(url.searchParams.get('id'), `eq.${TARGET}`);
      assert.equal(url.searchParams.get('role'), 'in.(resident,resident-limited)');
      assert.equal(url.searchParams.get('status'), 'neq.disabled');
      assert.deepEqual(JSON.parse(request.body), { status });
      return respond([]);
    }, async () => assert.equal(await repository.setProfileStatus(TARGET, status), null));
  }
});

test('account history allowlists notifications and strips nested audit credential data', async () => {
  await withTransport(async (url) => {
    if (url.pathname.endsWith('/health_audit_logs')) {
      assert.doesNotMatch(url.searchParams.get('select'), /profiles|actor:/);
      return respond([{
        id: OPERATION, action: 'ACCOUNT_APPROVED', actor_id: null, entity_id: TARGET, entity_type: 'profiles',
        metadata: {
          actor: { id: ACTOR, name: 'Administrator Snapshot', role: 'admin', token: 'SECRET-ACTOR-TOKEN' },
          reason: 'Reviewed', password: 'SECRET-PASSWORD',
          previous: { role: 'bhw', barangay_id: TARGET, token: 'SECRET-PREVIOUS-TOKEN' },
          before: { role: 'phn', token: 'SECRET-TOKEN', personnel_account: { approval_status: 'pending', action_link: 'SECRET-LINK' } },
        },
      }, { id: TARGET, action: 'ACCOUNT_UPDATED', actor_id: ACTOR, entity_id: TARGET, entity_type: 'profiles', metadata: { reason: 'Legacy update' } }]);
    }
    if (url.pathname.endsWith('/profiles')) {
      assert.equal(url.searchParams.get('select'), 'id,full_name');
      assert.equal(url.searchParams.get('id'), `in.(${ACTOR})`);
      return respond([{ id: ACTOR, full_name: 'Administrator' }]);
    }
    assert.equal(url.pathname, '/rest/v1/personnel_notification_outbox');
    assert.equal(url.searchParams.get('account_id'), `eq.${TARGET}`);
    assert.doesNotMatch(url.searchParams.get('select'), /claim_token|claimed_at|last_error[^_]|password|action_link/);
    return respond(rawProfile().notifications);
  }, async () => {
    const result = await repository.getPersonnelAccountHistory({ id: TARGET });
    assert.equal(result.audit[0].metadata.before.personnel_account.approval_status, 'pending');
    assert.deepEqual(result.audit[0].metadata.previous, { role: 'bhw', barangay_id: TARGET });
    assert.equal(result.audit[0].actorName, 'Administrator Snapshot');
    assert.equal(result.audit[0].actorId, ACTOR);
    assert.equal(result.audit[1].actorName, 'Administrator');
    assert.deepEqual(result.audit[0].metadata.actor, { id: ACTOR, name: 'Administrator Snapshot', role: 'admin' });
    assert.equal(result.notifications[0].status, 'pending');
    assert.doesNotMatch(JSON.stringify(result), /SECRET-|claim_token|action_link|password/);
  });
});

test('silent custom-id Auth creation recovers the reserved identity using actual Supabase admin API semantics', async () => {
  let authUser = null;
  const paths = [];
  await withTransport(async (url, request) => {
    paths.push([request.method, url.pathname]);
    assert.equal(request.headers.get('authorization'), `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`);
    if (request.method === 'GET') {
      assert.equal(url.pathname, `/auth/v1/admin/users/${TARGET}`);
      return authUser ? respond(authUser) : respond({ code: 'user_not_found', msg: 'Not found' }, { status: 404 });
    }
    assert.equal(request.method, 'POST'); assert.equal(url.pathname, '/auth/v1/admin/users');
    const body = JSON.parse(request.body);
    assert.equal(body.id, TARGET); assert.equal(body.email_confirm, false);
    assert.deepEqual(body.user_metadata, { full_name: 'Nurse Juana' });
    assert.deepEqual(body.app_metadata, { personnel_managed: true });
    assert.ok(body.password.length >= 48); assert.notEqual(body.password, PASSWORD);
    assert.ok(body.password.length < 72);
    assert.match(body.password, /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9\s]).{8,}$/);
    authUser = { id: TARGET, email: EMAIL, app_metadata: body.app_metadata };
    return respond(authUser);
  }, async () => {
    assert.equal(await repository.createManagedAuthAccount({ id: TARGET, email: EMAIL, fullName: 'Nurse Juana' }), TARGET);
    assert.equal(await repository.createManagedAuthAccount({ id: TARGET, email: EMAIL, fullName: 'Nurse Juana' }), TARGET);
    assert.deepEqual(paths.map(([method]) => method), ['GET', 'POST', 'GET']);
  });
});

test('verified own-password update uses the caller bearer and anon key without demoting the singleton before setup RPC', async () => {
  const paths = [];
  await withTransport(async (url, request) => {
    paths.push(url.pathname);
    if (url.pathname === '/auth/v1/user') {
      assert.equal(request.headers.get('authorization'), 'Bearer owner-token');
      if (request.method === 'PUT') {
        assert.equal(request.headers.get('apikey'), process.env.SUPABASE_ANON_KEY);
        assert.deepEqual(JSON.parse(request.body), { password: PASSWORD });
      } else assert.equal(request.method, 'GET');
      return respond({ id: TARGET, email: EMAIL, email_confirmed_at: '2026-10-31T09:00:00Z', app_metadata: { personnel_managed: true } });
    }
    assert.equal(request.headers.get('authorization'), `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`);
    if (url.pathname === '/rest/v1/profiles') {
      assert.equal(url.searchParams.get('id'), `eq.${TARGET}`);
      return respond(rawProfile());
    }
    assert.equal(url.pathname, '/rest/v1/rpc/complete_personnel_account_setup');
    assert.deepEqual(JSON.parse(request.body), { p_target_id: TARGET });
    return respond(rawProfile({ status: 'active', personnel_account: { approval_status: 'approved', activation_requested: true, setup_required: false, setup_completed_at: '2026-10-31T10:00:00Z', version: 2 } }));
  }, async () => {
    const result = await setupPersonnelPassword({ accessToken: 'owner-token', password: PASSWORD });
    assert.equal(result.passwordSaved, true); assert.equal(result.setupComplete, true); assert.equal(result.active, true);
    assert.deepEqual(paths, ['/auth/v1/user', '/rest/v1/profiles', '/auth/v1/user', '/rest/v1/rpc/complete_personnel_account_setup']);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://personnel-tests.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'personnel-test-service-key';
process.env.SUPABASE_ANON_KEY = 'personnel-test-anon-key';

const repository = (await import('../src/repositories/supabaseRepository.js')).default;
const { profileToAdminUser } = await import('../src/repositories/supabaseRepository.js');
const { getServiceClient } = await import('../src/config/supabase.js');
const users = await import('../src/services/users.service.js');
const auth = await import('../src/services/auth.service.js');
const staff = await import('../src/services/staffAccounts.service.js');
const validators = await import('../src/validators/users.validators.js');
const { personnelPasswordSetupValidator } = await import('../src/validators/auth.validators.js');

const ACTOR = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const OPERATION = '33333333-3333-4333-8333-333333333333';
const MUNICIPALITY = '44444444-4444-4444-8444-444444444444';
const BARANGAY = '55555555-5555-4555-8555-555555555555';
const FACILITY = '66666666-6666-4666-8666-666666666666';
const REQUEST = '77777777-7777-4777-8777-777777777777';
const EMAIL = 'nurse@example.gov';
const PASSWORD = 'OwnerChosen9!';

const withMethods = async (object, overrides, run) => {
  const originals = Object.fromEntries(Object.keys(overrides).map((key) => [key, object[key]]));
  Object.assign(object, overrides);
  try { return await run(); } finally { Object.assign(object, originals); }
};

const profile = (patch = {}) => ({
  id: TARGET, email: EMAIL, name: 'Nurse Juana', role: 'phn', status: 'disabled',
  municipalityId: MUNICIPALITY, barangayId: null, facilityId: null, rhuStations: [],
  contact: '09171234567', position: 'Nurse', licenseNo: 'LIC-1', approvalStatus: 'approved',
  activationRequested: true, setupRequired: true, setupCompletedAt: null, suspendedAt: null,
  suspensionReason: '', decisionReason: '', lifecycleVersion: 1, notification: null,
  ...patch,
});
const creation = (patch = {}) => ({
  fullName: 'Nurse Juana', email: EMAIL, role: 'phn', municipalityId: MUNICIPALITY,
  operationId: OPERATION, ...patch,
});
const options = () => ({
  municipalities: [{ id: MUNICIPALITY, name: 'Pili' }],
  barangays: [{ id: BARANGAY, name: 'San Isidro', municipalityId: MUNICIPALITY }],
  facilities: [{ id: FACILITY, name: 'RHU', municipalityId: MUNICIPALITY }],
});

test('public personnel submission is denied at the exported service without touching Auth or the database', async () => {
  await assert.rejects(() => staff.submitRequest(creation({ password: PASSWORD }), [{ file: Buffer.from('document') }]),
    (error) => error.statusCode === 403 && /disabled/i.test(error.message));
});

test('creation reserves identity, silently creates Auth, then provisions approval and outbox together', async () => {
  const calls = [];
  await withMethods(repository, {
    getAccountAssignmentOptions: async () => options(),
    reservePersonnelAccount: async (args) => { calls.push(['reserve', args]); return { target_id: TARGET, completed: false }; },
    createManagedAuthAccount: async (args) => { calls.push(['auth', args]); return TARGET; },
    createPersonnelAccountProfile: async (args) => { calls.push(['sql', args]); return profile(); },
    getProfileById: async () => profile({ notification: { status: 'pending', eventType: 'approved' } }),
    inviteAccount: async () => { throw new Error('must never invite before provisioning'); },
  }, async () => {
    const result = await users.createUser({ actorId: ACTOR, input: creation({ email: ' Nurse@Example.gov ' }) });
    assert.deepEqual(calls.map(([kind]) => kind), ['reserve', 'auth', 'sql']);
    assert.equal(calls[0][1].actorId, ACTOR);
    assert.equal(calls[0][1].operationId, OPERATION);
    assert.deepEqual(calls[0][1].profile, calls[2][1].profile);
    assert.equal(calls[2][1].profile.email, EMAIL);
    assert.equal(calls[2][1].profile.approval_status, 'approved');
    assert.equal(calls[2][1].profile.activation_requested, true);
    assert.equal(calls[2][1].profile.status, 'disabled', 'setup must finish before staff is active');
    assert.deepEqual(calls[1][1], { id: TARGET, email: EMAIL, fullName: 'Nurse Juana' });
    assert.equal(result.notification.status, 'pending');
    assert.equal(JSON.stringify(result).includes('password'), false);
  });
});

test('pending creation with activation withheld uses one SQL workflow; administrator creation is managed too', async () => {
  for (const role of ['phn', 'admin']) {
    let payload;
    await withMethods(repository, {
      getAccountAssignmentOptions: async () => options(),
      reservePersonnelAccount: async () => ({ target_id: TARGET, completed: false }),
      createManagedAuthAccount: async () => TARGET,
      createPersonnelAccountProfile: async (args) => { payload = args.profile; return profile({ role, approvalStatus: 'pending' }); },
      getProfileById: async () => profile({ role, approvalStatus: 'pending' }),
    }, async () => {
      await users.createUser({ actorId: ACTOR, input: creation({ role, approvalStatus: 'pending', activate: false }) });
      assert.equal(payload.approval_status, 'pending');
      assert.equal(payload.activation_requested, false);
      assert.equal(payload.status, 'pending_verification');
      assert.deepEqual(payload.rhu_stations, []);
      if (role === 'admin') assert.equal(payload.municipality_id, null);
    });
  }
});

test('completed creation replay performs no additional Auth operation', async () => {
  await withMethods(repository, {
    getAccountAssignmentOptions: async () => options(),
    reservePersonnelAccount: async () => ({ target_id: TARGET, completed: true }),
    createManagedAuthAccount: async () => { throw new Error('must not recreate completed Auth identity'); },
    createPersonnelAccountProfile: async () => profile(),
    getProfileById: async () => profile(),
  }, async () => assert.equal((await users.createUser({ actorId: ACTOR, input: creation() })).id, TARGET));
});

test('uncertain provisioning never deletes Auth and preserves the operation reference for recovery', async () => {
  let authCreated = 0;
  let deleted = 0;
  await withMethods(repository, {
    getAccountAssignmentOptions: async () => options(),
    reservePersonnelAccount: async () => ({ target_id: TARGET, completed: false }),
    createManagedAuthAccount: async () => { authCreated += 1; return TARGET; },
    createPersonnelAccountProfile: async ({ operationId }) => { assert.equal(operationId, OPERATION); throw Object.assign(new Error('timeout'), { statusCode: 503 }); },
    removeUnprovisionedAuthUser: async () => { deleted += 1; },
    deleteAuthAccount: async () => { deleted += 1; },
  }, async () => {
    await assert.rejects(() => users.createUser({ actorId: ACTOR, input: creation() }), (error) => error.statusCode === 503);
    assert.equal(authCreated, 1);
    assert.equal(deleted, 0);
  });
});

test('invalid operations, password input and resident creation are refused before reservation', async () => {
  await withMethods(repository, {
    reservePersonnelAccount: async () => { throw new Error('must not reserve invalid input'); },
  }, async () => {
    for (const input of [creation({ operationId: undefined }), creation({ operationId: 'invalid' }), creation({ password: PASSWORD }), creation({ role: 'resident' })]) {
      await assert.rejects(() => users.createUser({ actorId: ACTOR, input }), (error) => [400, 422].includes(error.statusCode));
    }
  });
});

test('RHU creation requires known nonempty stations; HS stations are optional and other roles have none', async () => {
  await withMethods(repository, {
    getAccountAssignmentOptions: async () => options(),
    reservePersonnelAccount: async () => { throw new Error('invalid stations must fail before reservation'); },
  }, async () => {
    for (const rhuStations of [[], ['unknown'], ['triage', 'unknown']]) {
      await assert.rejects(() => users.createUser({ actorId: ACTOR, input: creation({ role: 'rhu_personnel', facilityId: FACILITY, rhuStations }) }),
        (error) => error.statusCode === 422 && /station/i.test(error.message));
    }
    await assert.rejects(() => users.createUser({ actorId: ACTOR, input: creation({ rhuStations: ['triage'] }) }),
      (error) => error.statusCode === 422);
  });
  let payload;
  await withMethods(repository, {
    getAccountAssignmentOptions: async () => options(),
    reservePersonnelAccount: async () => ({ target_id: TARGET, completed: true }),
    createPersonnelAccountProfile: async (args) => { payload = args.profile; return profile(); },
    getProfileById: async () => profile(),
  }, async () => {
    await users.createUser({ actorId: ACTOR, input: creation({ role: 'health_supervisor', barangayId: BARANGAY }) });
    assert.deepEqual(payload.rhu_stations, []);
    await users.createUser({ actorId: ACTOR, input: creation({ role: 'rhu_personnel', facilityId: FACILITY, rhuStations: [' Triage ', 'consultation', 'triage'] }) });
    assert.deepEqual(payload.rhu_stations, ['triage', 'consultation']);
  });
});

test('unrelated edits preserve historical bad or absent assignments and stations without normalizing them', async () => {
  const historical = profile({ role: 'rhu_personnel', facilityId: null, municipalityId: null, rhuStations: ['legacy-station'] });
  let payload;
  await withMethods(repository, {
    getProfileById: async () => historical,
    getAccountAssignmentOptions: async () => { throw new Error('must not revalidate unchanged historical assignments'); },
    updatePersonnelAccountProfile: async (args) => { payload = args.profile; return historical; },
  }, async () => {
    await users.updateUser({ id: TARGET, actorId: ACTOR, patch: { contact: '09180000000', operationId: OPERATION } });
    assert.equal(payload.facility_id, null);
    assert.equal(payload.municipality_id, null);
    assert.deepEqual(payload.rhu_stations, ['legacy-station']);
    await users.updateUser({ id: TARGET, actorId: ACTOR, patch: { facilityId: null, municipalityId: null, rhuStations: ['legacy-station'], operationId: OPERATION } });
    assert.deepEqual(payload.rhu_stations, ['legacy-station']);
  });
});

test('new or changed RHU assignment validates stations while station-only changes preserve scope', async () => {
  let payload;
  await withMethods(repository, {
    getProfileById: async () => profile({ role: 'rhu_personnel', facilityId: null, rhuStations: [] }),
    getAccountAssignmentOptions: async () => options(),
    updatePersonnelAccountProfile: async (args) => { payload = args.profile; return profile(); },
  }, async () => {
    await assert.rejects(() => users.updateUser({ id: TARGET, actorId: ACTOR, patch: { facilityId: FACILITY } }),
      (error) => error.statusCode === 422 && /station/i.test(error.message));
    await users.updateUser({ id: TARGET, actorId: ACTOR, patch: { facilityId: FACILITY, rhuStations: ['consultation'], operationId: OPERATION } });
    assert.equal(payload.facility_id, FACILITY);
    assert.deepEqual(payload.rhu_stations, ['consultation']);
  });
  await withMethods(repository, {
    getProfileById: async () => profile({ role: 'health_supervisor', barangayId: null }),
    getAccountAssignmentOptions: async () => { throw new Error('unchanged scope must not be renormalized'); },
    updatePersonnelAccountProfile: async (args) => { payload = args.profile; return profile(); },
  }, async () => {
    await users.updateUser({ id: TARGET, actorId: ACTOR, patch: { rhuStations: ['consultation'], operationId: OPERATION } });
    assert.equal(payload.barangay_id, null);
    assert.deepEqual(payload.rhu_stations, ['consultation']);
  });
});

test('pending or rejected personnel cannot be activated through generic profile edits', async () => {
  for (const approvalStatus of ['pending', 'rejected']) {
    await withMethods(repository, { getProfileById: async () => profile({ approvalStatus }) }, async () => {
      await assert.rejects(() => users.updateUser({ id: TARGET, actorId: ACTOR, patch: { status: 'active' } }),
        (error) => error.statusCode === 409 && /approve/i.test(error.message));
    });
  }
});

test('lifecycle validation rejects bad UUIDs, actions, boolean strings and missing decision reasons', () => {
  for (const input of [
    { action: 'approve', operationId: 'bad' },
    { action: 'activate', operationId: OPERATION },
    { action: 'approve', activate: 'false', operationId: OPERATION },
    { action: 'reject', reason: ' ', operationId: OPERATION },
    { action: 'suspend', reason: '', operationId: OPERATION },
  ]) assert.ok(validators.personnelLifecycleValidator(input).error);
  assert.ok(validators.userQueryValidator({ personnelOnly: 'not-a-boolean' }).error);
  assert.ok(validators.userQueryValidator({ approvalStatus: 'active' }).error);
  assert.ok(validators.userQueryValidator({ lifecycleState: 'invited' }).error);
  assert.ok(validators.userIdParamValidator({ id: 'bad' }).error);
  assert.ok(validators.createUserValidator(creation({ facilityId: [FACILITY] })).error?.facilityId);
  assert.ok(validators.personnelLifecycleValidator({ action: ['approve'], operationId: OPERATION }).error?.action);
});

test('lifecycle actor is separate from input; self approval and suspension are refused', async () => {
  await withMethods(repository, {
    transitionPersonnelAccount: async (args) => { assert.equal(args.actorId, ACTOR); assert.equal(args.id, TARGET); return profile(); },
    getProfileById: async () => profile(),
  }, async () => {
    await users.transitionUserLifecycle({ id: TARGET, actorId: ACTOR, input: { action: 'approve', actorId: TARGET, operationId: OPERATION } });
    for (const action of ['approve', 'suspend']) {
      await assert.rejects(() => users.transitionUserLifecycle({ id: ACTOR, actorId: ACTOR, input: { action, reason: 'Access withheld', operationId: OPERATION } }),
        (error) => error.statusCode === 409);
    }
  });
});

test('managed setup-required access reset queues an invitation instead of sending an immediate recovery email', async () => {
  await withMethods(repository, {
    getProfileById: async () => profile(),
    transitionPersonnelAccount: async ({ action, actorId }) => { assert.equal(action, 'invite'); assert.equal(actorId, ACTOR); return profile(); },
    sendAccountRecoveryEmail: async () => { throw new Error('must not bypass setup lifecycle'); },
  }, async () => {
    const result = await users.resetUserAccess({ id: TARGET, actorId: ACTOR, operationId: OPERATION });
    assert.equal(result.queued, true);
    assert.equal(result.sent, false);
  });
});

test('legacy access reset requests Supabase recovery without claiming verified email acceptance', async () => {
  await withMethods(repository, {
    getProfileById: async () => profile({ setupRequired: false }),
    sendAccountRecoveryEmail: async ({ actorId, user }) => { assert.equal(actorId, ACTOR); assert.equal(user.id, TARGET); },
  }, async () => {
    assert.deepEqual(await users.resetUserAccess({ id: TARGET, actorId: ACTOR }), { requested: true, deliveryStatus: 'unverified' });
  });
});

test('Supabase Auth creation uses the reserved id, unconfirmed email, secret random password and non-role metadata', async () => {
  const admin = getServiceClient().auth.admin;
  const passwords = [];
  await withMethods(admin, {
    getUserById: async (id) => { assert.equal(id, TARGET); return { data: { user: null }, error: { status: 404 } }; },
    createUser: async (input) => {
      assert.equal(input.id, TARGET);
      assert.equal(input.email_confirm, false);
      assert.equal(input.email, EMAIL);
      assert.deepEqual(input.user_metadata, { full_name: 'Nurse Juana' });
      assert.deepEqual(input.app_metadata, { personnel_managed: true });
      assert.ok(input.password.length >= 48);
      assert.ok(input.password.length < 72);
      assert.match(input.password, /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9\s]).{8,}$/);
      passwords.push(input.password);
      return { data: { user: { id: TARGET, email: EMAIL } }, error: null };
    },
    deleteUser: async () => { throw new Error('must never delete uncertain Auth identity'); },
  }, async () => {
    assert.equal(await repository.createManagedAuthAccount({ id: TARGET, email: EMAIL, fullName: 'Nurse Juana' }), TARGET);
    assert.equal(await repository.createManagedAuthAccount({ id: TARGET, email: EMAIL, fullName: 'Nurse Juana' }), TARGET);
    assert.notEqual(passwords[0], passwords[1]);
  });
});

test('Auth creation retry recovers only the same reserved id and never adopts another email owner', async () => {
  const admin = getServiceClient().auth.admin;
  let reads = 0;
  await withMethods(admin, {
    getUserById: async (id) => {
      assert.equal(id, TARGET); reads += 1;
      return reads === 1 ? { data: { user: null }, error: { status: 404 } }
        : { data: { user: { id: TARGET, email: EMAIL, app_metadata: { personnel_managed: true } } }, error: null };
    },
    createUser: async () => { throw new Error('network acknowledgement lost'); },
  }, async () => assert.equal(await repository.createManagedAuthAccount({ id: TARGET, email: EMAIL, fullName: 'Nurse Juana' }), TARGET));

  await withMethods(admin, {
    getUserById: async () => ({ data: { user: null }, error: { status: 404 } }),
    createUser: async () => ({ data: null, error: { code: 'email_exists', message: 'opaque duplicate' } }),
  }, async () => {
    await assert.rejects(() => repository.createManagedAuthAccount({ id: TARGET, email: EMAIL, fullName: 'Nurse Juana' }),
      (error) => error.statusCode === 409);
  });
});

test('mismatched Auth identity is refused and not deleted', async () => {
  const admin = getServiceClient().auth.admin;
  await withMethods(admin, {
    getUserById: async () => ({ data: { user: null }, error: { status: 404 } }),
    createUser: async () => ({ data: { user: { id: ACTOR, email: EMAIL } }, error: null }),
    deleteUser: async () => { throw new Error('must not delete mismatched identity'); },
  }, async () => {
    await assert.rejects(() => repository.createManagedAuthAccount({ id: TARGET, email: EMAIL, fullName: 'Nurse Juana' }),
      (error) => error.statusCode === 409);
  });
});

const withSetup = async ({ account = profile(), owner = {}, updateError = null, completion = profile({ setupRequired: false, setupCompletedAt: '2026-10-31T10:00:00Z', status: 'active' }), completionError = null } = {}, run) => {
  const calls = [];
  const client = getServiceClient();
  return withMethods(client.auth, {
    getUser: async (token) => { calls.push(['verify', token]); return { data: { user: { id: TARGET, email: EMAIL, email_confirmed_at: '2026-10-31T09:00:00Z', app_metadata: { personnel_managed: true }, ...owner } }, error: null }; },
    updateUser: async () => { throw new Error('must not mutate singleton user session'); },
    signInWithPassword: async () => { throw new Error('must not sign in singleton'); },
  }, () => withMethods(client.auth.admin, {
    updateUserById: async (id, input) => { calls.push(['password', id, input]); return { data: { user: { id } }, error: updateError }; },
  }, () => withMethods(repository, {
    getPersonnelSetupAccount: async (id) => { calls.push(['account', id]); return account; },
    completePersonnelAccountSetup: async (id) => { calls.push(['complete', id]); if (completionError) throw completionError; return completion; },
  }, () => run(calls))));
};

test('setup status verifies the token owner and allows pending/disabled managed profiles without active-profile authentication', async () => {
  await withSetup({}, async (calls) => {
    assert.deepEqual(await auth.getPersonnelSetupStatus({ accessToken: 'owner-token', id: ACTOR, role: 'admin' }), {
      setupRequired: true, approvalStatus: 'approved', activationRequested: true, suspended: false, active: false,
    });
    assert.deepEqual(calls, [['verify', 'owner-token'], ['account', TARGET]]);
  });
});

test('nonmanaged legacy and resident setup status is false; missing managed provisioning fails closed', async () => {
  await withSetup({ owner: { app_metadata: {} }, account: profile({ role: 'resident', lifecycleVersion: null, setupRequired: false }) }, async () => {
    assert.equal((await auth.getPersonnelSetupStatus({ accessToken: 'resident-token' })).setupRequired, false);
  });
  await withSetup({ account: profile({ lifecycleVersion: null, setupRequired: false }) }, async (calls) => {
    await assert.rejects(() => auth.getPersonnelSetupStatus({ accessToken: 'owner-token' }), (error) => error.statusCode === 503);
    assert.equal(calls.some(([kind]) => kind === 'password'), false);
  });
});

test('password setup enforces actual strength rather than the legacy weak policy or error wording', () => {
  for (const password of ['password1', 'PASSWORD1!', 'Password!!', 'Password9 ', 'Short1!', 'Password9!\n', 'A'.repeat(201)]) {
    assert.ok(personnelPasswordSetupValidator({ password }).error?.password);
  }
  assert.deepEqual(personnelPasswordSetupValidator({ password: PASSWORD }).value, { password: PASSWORD });
  assert.ok(personnelPasswordSetupValidator({ password: PASSWORD, targetId: ACTOR, role: 'admin' }).error?.request);
});

test('password setup requires confirmed email, approved unsuspended lifecycle and pending setup before saving', async () => {
  for (const state of [
    { owner: { email_confirmed_at: null, confirmed_at: '2026-10-31T09:00:00Z' } },
    { account: profile({ approvalStatus: 'pending' }) },
    { account: profile({ approvalStatus: 'rejected' }) },
    { account: profile({ suspendedAt: '2026-10-31T09:00:00Z' }) },
    { account: profile({ setupRequired: false }) },
  ]) {
    await withSetup(state, async (calls) => {
      await assert.rejects(() => auth.setupPersonnelPassword({ accessToken: 'owner-token', password: PASSWORD }),
        (error) => [403, 409].includes(error.statusCode));
      assert.equal(calls.some(([kind]) => ['password', 'complete'].includes(kind)), false);
    });
  }
});

test('password is saved only for the verified owner and before SQL completion', async () => {
  await withSetup({}, async (calls) => {
    const result = await auth.setupPersonnelPassword({ accessToken: 'owner-token', password: PASSWORD, id: ACTOR });
    assert.deepEqual(calls.map(([kind]) => kind), ['verify', 'account', 'password', 'complete']);
    assert.deepEqual(calls[2], ['password', TARGET, { password: PASSWORD }]);
    assert.deepEqual(calls[3], ['complete', TARGET]);
    assert.equal(result.passwordSaved, true);
    assert.equal(result.setupComplete, true);
    assert.equal(result.active, true);
    assert.equal(JSON.stringify(result).includes(PASSWORD), false);
  });
});

test('successful setup with activation withheld remains inactive', async () => {
  await withSetup({ completion: profile({ setupRequired: false, activationRequested: false, status: 'disabled' }) }, async () => {
    const result = await auth.setupPersonnelPassword({ accessToken: 'owner-token', password: PASSWORD });
    assert.equal(result.setupComplete, true);
    assert.equal(result.active, false);
    assert.equal(result.activationRequested, false);
  });
});

test('SQL failure after password success returns an accurate partial outcome and no provider secrets', async () => {
  await withSetup({ completionError: new Error('provider TOKEN SECRET') }, async () => {
    const result = await auth.setupPersonnelPassword({ accessToken: 'owner-token', password: PASSWORD });
    assert.equal(result.passwordSaved, true);
    assert.equal(result.setupComplete, false);
    assert.equal(result.active, false);
    assert.match(result.message, /password was saved/i);
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
  });
});

test('Auth password failure never completes SQL or leaks the password/provider error', async () => {
  await withSetup({ updateError: { message: `raw provider ${PASSWORD}`, code: 'weak_password' } }, async (calls) => {
    await assert.rejects(() => auth.setupPersonnelPassword({ accessToken: 'owner-token', password: PASSWORD }),
      (error) => error.statusCode === 503 && !JSON.stringify(error).includes(PASSWORD));
    assert.equal(calls.some(([kind]) => kind === 'complete'), false);
  });
});

test('admin shape preserves raw historical stations and strips outbox credential/lease material', () => {
  const result = profileToAdminUser({
    id: TARGET, email: EMAIL, full_name: 'Nurse Juana', role: 'rhu_personnel', status: 'disabled', rhu_stations: ['historical'],
    personnel_account: { approval_status: 'approved', activation_requested: true, setup_required: true, version: 5 },
    notifications: [{ id: OPERATION, status: 'delivery_unknown', event_type: 'approved', attempts: 1, claim_token: 'private-claim', action_link: 'private-link', password: 'private-password' }],
  });
  assert.deepEqual(result.rhuStations, ['historical']);
  assert.equal(result.lifecycleVersion, 5);
  assert.equal(result.notification.status, 'delivery_unknown');
  assert.doesNotMatch(JSON.stringify(result), /private-|claim_token|action_link|password/);
});

test('account RPC error mapping is safe, explicit and never exposes SQL/Auth details', async () => {
  const client = getServiceClient();
  for (const [code, status] of [['42501', 403], ['P0002', 404], ['23505', 409], ['23514', 409], ['22023', 422], ['PGRST202', 503]]) {
    await withMethods(client, { rpc: async () => ({ data: null, error: { code, message: 'TOKEN SECRET', details: PASSWORD } }) }, async () => {
      await assert.rejects(() => repository.reservePersonnelAccount({ actorId: ACTOR, operationId: OPERATION, profile: {} }),
        (error) => error.statusCode === status && !JSON.stringify(error).includes(PASSWORD) && !error.message.includes('SECRET'));
    });
  }
});

test('staff historical decision uses the atomic RPC, retained hierarchy/scope and verified actor', async () => {
  const row = { id: REQUEST, auth_user_id: TARGET, role: 'health_supervisor', municipality_id: MUNICIPALITY, barangay_id: BARANGAY, status: 'pending', email: EMAIL };
  const client = getServiceClient();
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
  await withMethods(client, { from: () => chain }, () => withMethods(repository, {
    reviewPersonnelAccountRequest: async (args) => {
      assert.deepEqual(args, { requestId: REQUEST, actorId: ACTOR, decision: 'approved', reason: 'Reviewed credentials' });
      return { ...row, status: 'approved', decided_by: ACTOR, profileStatus: 'disabled' };
    },
  }, async () => {
    const result = await staff.approve({ id: REQUEST, user: { id: ACTOR, role: 'phn', municipalityId: MUNICIPALITY }, remarks: 'Reviewed credentials' });
    assert.equal(result.status, 'approved');
    assert.equal(result.profileStatus, 'disabled');
    assert.equal(result.active, false);
    await assert.rejects(() => staff.approve({ id: REQUEST, user: { id: ACTOR, role: 'phn', municipalityId: BARANGAY } }),
      (error) => error.statusCode === 404);
    await assert.rejects(() => staff.approve({ id: REQUEST, user: { id: TARGET, role: 'phn', municipalityId: MUNICIPALITY } }),
      (error) => error.statusCode === 403);
  }));
});

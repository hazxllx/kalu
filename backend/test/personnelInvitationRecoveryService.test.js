import assert from 'node:assert/strict';
import test from 'node:test';
import { personnelPasswordSetupValidator, temporaryPersonnelPasswordChangeValidator } from '../src/validators/auth.validators.js';

import { configureLocalTestEnvironment } from './helpers/localEnv.js';
configureLocalTestEnvironment();

const repository = (await import('../src/repositories/supabaseRepository.js')).default;
const { getServiceClient, updateOwnPassword } = await import('../src/config/supabase.js');
const env = (await import('../src/config/env.js')).default;
const auth = await import('../src/services/auth.service.js');

const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const CLAIM_ID = '88888888-8888-4888-8888-888888888888';
const PASSWORD = 'OwnerChosen9!';
const RECOVERY_SECRET = 'supabase-generated-one-time-token-hash';
const account = (patch = {}) => ({
  id: ACCOUNT_ID,
  email: 'nurse@example.gov',
  status: 'disabled',
  approvalStatus: 'approved',
  activationRequested: false,
  setupRequired: true,
  lifecycleVersion: 4,
  setupCompletedAt: null,
  mustChangePassword: true,
  temporaryPasswordExpiresAt: '2020-01-01T00:00:00.000Z',
  suspendedAt: null,
  ...patch,
});
const withMethods = async (object, overrides, run) => {
  const originals = Object.fromEntries(Object.keys(overrides).map((key) => [key, object[key]]));
  Object.assign(object, overrides);
  try { return await run(); } finally { Object.assign(object, originals); }
};

const scenario = async ({
  accountState = account(), proofClaim = CLAIM_ID, completeError = null,
  invalidSession = false, authUpdateError = null,
} = {}, run) => {
  const calls = [];
  const client = getServiceClient();
  return withMethods(client.auth, {
    getUser: async (token) => {
      calls.push(['verify', token]);
      if (typeof invalidSession === 'function' ? invalidSession(token) : invalidSession) {
        return { data: { user: null }, error: { status: 401 } };
      }
      return { data: { user: {
        id: ACCOUNT_ID, email: 'nurse@example.gov', email_confirmed_at: '2026-11-20T09:00:00Z',
        app_metadata: { personnel_managed: true },
      } }, error: null };
    },
  }, () => withMethods(client.auth.admin, {
    updateUserById: async (id, input) => {
      calls.push(['password', id, input]);
      return { data: { user: { id } }, error: authUpdateError };
    },
    getUserById: async (id) => {
      calls.push(['getUserById', id]);
      return { data: { user: { id, email: 'nurse@example.gov', email_confirmed_at: '2026-11-20T09:00:00Z', app_metadata: { personnel_managed: true } } }, error: null };
    },
  }, () => withMethods(repository, {
    updatePersonnelOwnPassword: async ({ password }) => {
      calls.push(['password', ACCOUNT_ID, { password }]);
      return { data: { user: { id: ACCOUNT_ID } }, error: null };
    },
    getPersonnelSetupAccount: async (id) => { calls.push(['account', id]); return accountState; },
    getPersonnelInvitationRecoveryOwner: async (tokenDigest) => { calls.push(['recoveryOwner', tokenDigest]); return proofClaim ? ACCOUNT_ID : null; },
    beginPersonnelInvitationRecovery: async (input) => { calls.push(['begin', input]); return proofClaim; },
    releasePersonnelInvitationRecovery: async (input) => { calls.push(['release', input]); return true; },
    completePersonnelInvitationRecovery: async (input) => {
      calls.push(['completeRecovery', input]);
      const failure = Array.isArray(completeError) ? completeError.shift() : completeError;
      if (failure) throw failure;
      return account({ setupRequired: false, mustChangePassword: false, temporaryPasswordExpiresAt: null, lifecycleVersion: 5 });
    },
  }, () => run(calls))));
};

test('only setup endpoint accepts the invitation proof field', () => {
  assert.equal(personnelPasswordSetupValidator({ password: PASSWORD, recoverySecret: RECOVERY_SECRET }).error, undefined);
  assert.ok(temporaryPersonnelPasswordChangeValidator({ password: PASSWORD, recoverySecret: RECOVERY_SECRET }).error);
});

test('public forgot-password does not supersede a temporary-account administrator invitation', async () => {
  const client = getServiceClient();
  let generated = false;
  await withMethods(client, {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { id: ACCOUNT_ID, email: 'nurse@example.gov', role: 'rhu_personnel' }, error: null }) }),
      }),
    }),
  }, () => withMethods(client.auth.admin, {
    getUserById: async (id) => ({ data: { user: { id, email: 'nurse@example.gov', email_confirmed_at: '2026-11-20T09:00:00Z' } }, error: null }),
    generateLink: async () => { generated = true; throw new Error('must not create unbound recovery link'); },
  }, () => withMethods(repository, {
    getPersonnelSetupAccount: async () => account(),
  }, async () => {
    assert.deepEqual(await auth.requestPasswordReset({ email: 'nurse@example.gov' }), { accepted: true });
  })));
  assert.equal(generated, false);
});

test('password mutation uses the verified caller bearer and anon key', async () => {
  await withMethods(globalThis, {
    fetch: async (url, options) => {
      assert.equal(url, `${env.supabaseUrl.replace(/\/$/, '')}/auth/v1/user`);
      assert.equal(options.method, 'PUT');
      assert.equal(options.headers.apikey, env.supabaseAnonKey);
      assert.equal(options.headers.authorization, 'Bearer verified-email-session');
      assert.notEqual(options.headers.apikey, env.supabaseServiceRoleKey);
      assert.equal(JSON.parse(options.body).password, PASSWORD);
      return { ok: true, json: async () => ({ id: ACCOUNT_ID }) };
    },
  }, async () => {
    const result = await updateOwnPassword('verified-email-session', PASSWORD);
    assert.equal(result.data.user.id, ACCOUNT_ID);
    assert.equal(result.error, null);
  });
});

test('an expired temporary-password bearer cannot use ordinary personnel setup', async () => {
  await scenario({}, async (calls) => {
    await assert.rejects(() => auth.setupPersonnelPassword({ accessToken: 'expired-temp-bearer', password: PASSWORD }),
      (error) => error.statusCode === 403);
    assert.equal(calls.some(([kind]) => kind === 'password'), false);
    assert.equal(calls.some(([kind]) => kind === 'begin'), false);
  });
});

test('completed personnel session cutoff also blocks stale tokens from the ordinary reset status path', async () => {
  const cutoff = Math.floor(Date.now() / 1000);
  const jwt = (iat) => `header.${Buffer.from(JSON.stringify({ sub: ACCOUNT_ID, iat })).toString('base64url')}.signature`;
  await scenario({ accountState: account({
    setupRequired: false, mustChangePassword: false, setupCompletedAt: '2026-11-20T10:00:00Z',
    credentialValidAfter: cutoff,
  }) }, async () => {
    await assert.rejects(() => auth.getPersonnelSetupStatus({ accessToken: jwt(cutoff - 1) }),
      (error) => error.statusCode === 401);
    const current = await auth.getPersonnelSetupStatus({ accessToken: jwt(cutoff) });
    assert.equal(current.setupRequired, false);
  });
});

test('email secret is hashed and bound to the verified account before Auth mutation', async () => {
  await scenario({}, async (calls) => {
    const result = await auth.setupPersonnelPassword({
      accessToken: 'verified-email-session', password: PASSWORD, recoverySecret: RECOVERY_SECRET,
    });
    assert.equal(result.passwordSaved, true);
    assert.equal(result.setupComplete, true);
    assert.equal(result.activationRequested, false);
    assert.equal(result.active, false);
    assert.equal(calls[0][0], 'verify');
    assert.equal(calls[1][0], 'account');
    assert.equal(calls[2][0], 'begin');
    assert.equal(calls[3][0], 'password');
    assert.equal(calls[4][0], 'completeRecovery');
    assert.equal(calls[2][1].id, ACCOUNT_ID);
    assert.match(calls[2][1].tokenDigest, /^[0-9a-f]{64}$/);
    assert.notEqual(calls[2][1].tokenDigest, RECOVERY_SECRET);
    assert.match(calls[2][1].passwordDigest, /^[0-9a-f]{64}$/);
    assert.deepEqual(calls[4][1], { id: ACCOUNT_ID, tokenDigest: calls[2][1].tokenDigest, claimId: CLAIM_ID });
    assert.equal(calls[3][2].password, PASSWORD);
  });
});

test('wrong-account, expired or consumed email proofs fail before Auth mutation', async () => {
  for (const proofClaim of [null, false]) {
    await scenario({ proofClaim }, async (calls) => {
      await assert.rejects(() => auth.setupPersonnelPassword({
        accessToken: 'verified-email-session', password: PASSWORD, recoverySecret: RECOVERY_SECRET,
      }), (error) => error.statusCode === 403);
      assert.equal(calls.some(([kind]) => kind === 'password'), false);
    });
  }
});

test('suspended or unapproved accounts reject recovery before proof or Auth mutation', async () => {
  for (const accountState of [
    account({ suspendedAt: '2026-11-20T09:00:00Z' }),
    account({ approvalStatus: 'pending' }),
  ]) {
    await scenario({ accountState }, async (calls) => {
      await assert.rejects(() => auth.setupPersonnelPassword({
        accessToken: 'verified-email-session', password: PASSWORD, recoverySecret: RECOVERY_SECRET,
      }), (error) => error.statusCode === 403);
      assert.equal(calls.some(([kind]) => kind === 'begin' || kind === 'password'), false);
    });
  }
});

test('password-saved finalization failures preserve a same-secret retry outcome and activation decision', async () => {
  await scenario({ completeError: new Error('database unavailable') }, async (calls) => {
    const result = await auth.setupPersonnelPassword({
      accessToken: 'verified-email-session', password: PASSWORD, recoverySecret: RECOVERY_SECRET,
    });
    assert.equal(result.passwordSaved, true);
    assert.equal(result.setupComplete, false);
    assert.equal(result.active, false);
    assert.equal(result.activationRequested, false);
    assert.equal(calls.some(([kind]) => kind === 'password'), true);
  });
});

test('same email secret and password can retry finalization after Auth revokes the bearer', async () => {
  await scenario({ completeError: [new Error('database unavailable'), null], invalidSession: (token) => !token }, async (calls) => {
    const first = await auth.setupPersonnelPassword({ accessToken: 'verified-email-session', password: PASSWORD, recoverySecret: RECOVERY_SECRET });
    assert.equal(first.passwordSaved, true);
    assert.equal(first.setupComplete, false);
    const retried = await auth.setupPersonnelPassword({ password: PASSWORD, recoverySecret: RECOVERY_SECRET });
    assert.equal(retried.passwordSaved, true);
    assert.equal(retried.setupComplete, true);
    assert.equal(calls.filter(([kind]) => kind === 'password').length, 2);
    assert.equal(calls.filter(([kind]) => kind === 'getUserById').length, 1);
    assert.equal(calls.filter(([kind]) => kind === 'begin').length, 2);
    assert.equal(calls.filter(([kind]) => kind === 'completeRecovery').length, 2);
  });
});

test('definitive Auth rejection releases the claim for a corrected password', async () => {
  await scenario({ authUpdateError: { status: 422 } }, async (calls) => {
    await assert.rejects(() => auth.setupPersonnelPassword({
      accessToken: 'verified-email-session', password: PASSWORD, recoverySecret: RECOVERY_SECRET,
    }), (error) => error.statusCode === 503);
    assert.equal(calls.filter(([kind]) => kind === 'password').length, 1);
    assert.equal(calls.filter(([kind]) => kind === 'release').length, 1);
    assert.equal(calls.filter(([kind]) => kind === 'completeRecovery').length, 0);
  });
});

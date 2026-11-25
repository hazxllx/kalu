import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { transform } from 'esbuild';
import { db, setOfflineOwnerResolver, getOfflineOwnerId, captureOwnerGuard, assertCurrentOwner } from '../../src/services/offline/db.js';
import { configureSyncEngine, resetSyncEngine } from '../../src/services/offline/syncEngine.js';
import { createAuthOwnerLifecycle } from '../../src/services/auth/authOwnerLifecycle.js';
import { cacheRecord } from '../../src/services/offline/records.js';
import { queueCreate } from '../../src/services/offline/queue.js';
import { MUTATION_TIER } from '../../src/services/offline/mutationPolicy.js';
import { clearPersistedSupabaseSession, SUPABASE_AUTH_STORAGE_KEY } from '../../src/lib/supabase.js';

const authUrl = new URL('../../src/context/AuthContext.jsx', import.meta.url);
const sourceRoot = new URL('../../src/', import.meta.url);
let serial = 0;
let renderer;

beforeEach(async () => {
  setOfflineOwnerResolver(null);
  resetSyncEngine();
  if (!db.isOpen()) await db.open();
  await Promise.all([db.records.clear(), db.outbox.clear(), db.drafts.clear(), db.syncMeta.clear()]);
});
afterEach(async () => {
  if (renderer) await act(async () => { renderer.unmount(); });
  renderer = null;
  resetSyncEngine();
  setOfflineOwnerResolver(null);
  delete globalThis.__signInSessionTest;
});

test('persisted Supabase logout cleanup removes the configured auth storage key', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const removedKeys = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { removeItem: (key) => removedKeys.push(key) } },
  });
  try {
    clearPersistedSupabaseSession();
    assert.deepEqual(removedKeys, [SUPABASE_AUTH_STORAGE_KEY]);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});

const settleEvents = async (ready = () => true) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    if (ready()) return;
  }
  assert.fail('Authentication did not settle.');
};

const sessionFor = (id = 'account-a', token = 'test-access-token') => ({
  user: { id, email: `${id}@example.test`, user_metadata: { role: 'admin' } },
  access_token: token, refresh_token: 'test-refresh-token', expires_at: Math.floor(Date.now() / 1000) + 3600,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((finish) => { resolve = finish; });
  return { promise, resolve };
};

const mountAuth = async ({ initial = null, profile = null, passwordGrant = null, restoration = null, signOutFailure = null } = {}) => {
  const listeners = new Set();
  const calls = { credentials: 0, profile: 0, signOut: 0, persistedStorageClears: 0 };
  let sdkSession = initial;
  let persistedSession = initial;
  const emit = (event, session) => {
    sdkSession = session;
    persistedSession = session;
    for (const listener of listeners) listener(event, session);
  };
  const sdk = { auth: {
    getSession: async () => restoration ? restoration() : { data: { session: persistedSession }, error: null },
    onAuthStateChange(callback) {
      listeners.add(callback);
      queueMicrotask(() => callback('INITIAL_SESSION', sdkSession));
      return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } };
    },
    async signInWithPassword(args) {
      calls.credentials += 1;
      const result = passwordGrant ? await passwordGrant(args) : { data: { session: sessionFor() }, error: null };
      if (result.data?.session) emit('SIGNED_IN', result.data.session);
      return result;
    },
    async signOut(options) {
      calls.signOut += 1;
      if (signOutFailure && options?.scope !== 'local') {
        if (signOutFailure instanceof Error) throw signOutFailure;
        return { error: signOutFailure };
      }
      emit('SIGNED_OUT', null);
      return { error: null };
    },
  } };
  const api = {
    async me({ ownerId }) {
      const guard = captureOwnerGuard(ownerId);
      assertCurrentOwner(guard);
      calls.profile += 1;
      const user = profile ? await profile(ownerId) : { id: ownerId, role: 'phn', name: 'Test Personnel' };
      assertCurrentOwner(guard);
      return { user };
    },
    logout: async () => ({ success: true }),
  };
  globalThis.__signInSessionTest = {
    supabase: sdk,
    authApi: api,
    clearPersistedSupabaseSession: () => {
      calls.persistedStorageClears += 1;
      persistedSession = null;
    },
  };
  let source = await readFile(authUrl, 'utf8');
  source = source
    .replace(/import\s*\{\s*supabase\s*,\s*isSupabaseConfigured\s*,\s*clearPersistedSupabaseSession\s*\}\s*from\s*['"][^'"]+['"];?/,
      'const { supabase, clearPersistedSupabaseSession } = globalThis.__signInSessionTest; const isSupabaseConfigured = true;')
    .replace(/import \{ authApi \} from '[^']+';/, 'const { authApi } = globalThis.__signInSessionTest;')
    .replace(/from (['"])(@\/[^'"]+|\.{1,2}\/[^'"]+)\1/g, (_match, _quote, path) => {
      const resolved = path.startsWith('@/') ? new URL(`${path.slice(2)}.js`, sourceRoot) : new URL(path, authUrl);
      return `from '${resolved.href}'`;
    })
    .replace(/from 'react'/, `from '${import.meta.resolve('react')}'`);
  const output = await transform(source, { loader: 'jsx', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment' });
  const module = await import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}#signin-${serial++}`);
  let current;
  function Probe() { current = module.useAuth(); return null; }
  await act(async () => { renderer = create(React.createElement(module.AuthProvider, null, React.createElement(Probe))); });
  return { calls, emit, get state() { return current; }, get persistedSession() { return persistedSession; }, listeners };
};

test('establishing authentication must survive the sync reset performed by its owner lifecycle', async () => {
  const lifecycle = createAuthOwnerLifecycle({ bindOwner: setOfflineOwnerResolver, clearCache: async () => {}, resetStores: () => {}, stopSync: resetSyncEngine });
  lifecycle.install();
  await lifecycle.change('account-a', Date.now() + 3600000);
  assert.equal(getOfflineOwnerId(), 'account-a');
  const guard = captureOwnerGuard('account-a');
  configureSyncEngine({ getOwnerId: () => 'account-a' });
  assert.equal(guard(), true);
  await lifecycle.dispose();
});

test('equivalent owner rebinding does not invalidate a valid sign-in, but account switches still do', () => {
  setOfflineOwnerResolver(() => 'account-a');
  const guard = captureOwnerGuard('account-a');
  setOfflineOwnerResolver(() => 'account-a');
  assert.equal(guard(), true);
  setOfflineOwnerResolver(() => 'account-b');
  setOfflineOwnerResolver(() => 'account-a');
  assert.equal(guard(), false);
});

test('a real mounted AuthProvider signs in once and resolves one server profile despite SIGNED_IN', async () => {
  const auth = await mountAuth();
  let role;
  await act(async () => { role = await auth.state.login({ email: 'account-a@example.test', password: 'test-password' }); });
  assert.equal(role, 'phn');
  assert.equal(auth.state.role, 'phn');
  assert.equal(auth.state.session.user.id, 'account-a');
  assert.equal(auth.state.isAuthenticated, true);
  assert.equal(auth.state.isResolvingProfile, false);
  assert.equal(auth.calls.credentials, 1);
  assert.equal(auth.calls.profile, 1);
  assert.equal(auth.calls.signOut, 0);
});

test('a profile outage is not a session change and does not destroy the valid Supabase session', async () => {
  const auth = await mountAuth({ profile: async () => { throw Object.assign(new Error('Profile service unavailable'), { status: 503 }); } });
  await act(async () => {
    await assert.rejects(auth.state.login({ email: 'account-a@example.test', password: 'test-password' }), /profile.*unavailable|profile.*server|profile.*reach/i);
  });
  assert.equal(auth.calls.signOut, 0);
  assert.equal(auth.state.session.user.id, 'account-a');
  assert.equal(auth.state.role, null);
  assert.equal(auth.state.isAuthenticated, false);
  assert.ok(auth.state.authError);
});

test('token refresh during profile resolution preserves the new token and never starts another login', async () => {
  const gate = deferred();
  const auth = await mountAuth({ profile: async (id) => { await gate.promise; return { id, role: 'phn' }; } });
  let flight;
  await act(async () => { flight = auth.state.login({ email: 'account-a@example.test', password: 'test-password' }); flight.catch(() => {}); });
  await settleEvents(() => auth.calls.profile === 1);
  await act(async () => { auth.emit('TOKEN_REFRESHED', sessionFor('account-a', 'refreshed-test-token')); gate.resolve(); await flight; });
  assert.equal(auth.state.session.access_token, 'refreshed-test-token');
  assert.equal(auth.state.role, 'phn');
  assert.equal(auth.calls.profile, 2);
  assert.equal(auth.calls.signOut, 0);
});

test('duplicate provider submissions do not start parallel password grants', async () => {
  const gate = deferred();
  const auth = await mountAuth({ passwordGrant: async () => { await gate.promise; return { data: { session: sessionFor() }, error: null }; } });
  let flight;
  await act(async () => {
    flight = auth.state.login({ email: 'account-a@example.test', password: 'test-password' }); flight.catch(() => {});
    const duplicate = assert.rejects(auth.state.login({ email: 'account-b@example.test', password: 'other-test-password' }), /already.*progress|wait.*sign-in/i);
    gate.resolve();
    await Promise.all([flight, duplicate]);
  });
  assert.equal(auth.calls.credentials, 1);
  assert.equal(auth.state.user.id, 'account-a');
});

test('restoration deduplicates unchanged-session events and verifies a refreshed token without a password grant', async () => {
  const auth = await mountAuth({ initial: sessionFor() });
  await settleEvents(() => !auth.state.isResolvingProfile);
  assert.equal(auth.state.isAuthenticated, true);
  assert.equal(auth.state.role, 'phn');
  await act(async () => {
    auth.emit('SIGNED_IN', sessionFor());
    auth.emit('TOKEN_REFRESHED', sessionFor('account-a', 'new-restored-token'));
  });
  await settleEvents(() => !auth.state.isResolvingProfile);
  assert.equal(auth.calls.credentials, 0);
  assert.equal(auth.calls.profile, 2);
  assert.equal(auth.calls.signOut, 0);
  assert.equal(auth.listeners.size, 1);
  assert.equal(auth.state.session.access_token, 'new-restored-token');
});

test('a stale empty getSession bootstrap cannot overwrite a completed sign-in', async () => {
  const restoration = deferred();
  const auth = await mountAuth({ restoration: () => restoration.promise });
  await act(async () => { await auth.state.login({ email: 'account-a@example.test', password: 'test-password' }); });
  await act(async () => { restoration.resolve({ data: { session: null }, error: null }); });
  assert.equal(auth.state.user.id, 'account-a');
  assert.equal(auth.state.role, 'phn');
  assert.equal(auth.state.authChecked, true);
  assert.equal(auth.calls.profile, 1);
});

test('an actual account switch fences a late profile reply without signing out the new account', async () => {
  const firstProfile = deferred();
  const auth = await mountAuth({ profile: async (id) => {
    if (id === 'account-a') await firstProfile.promise;
    return { id, role: id === 'account-a' ? 'phn' : 'health_supervisor' };
  } });
  let oldLogin;
  await act(async () => { oldLogin = auth.state.login({ email: 'account-a@example.test', password: 'test-password' }); oldLogin.catch(() => {}); });
  await settleEvents(() => auth.calls.profile === 1);
  await act(async () => { auth.emit('SIGNED_IN', sessionFor('account-b')); });
  await settleEvents(() => auth.state.role === 'health_supervisor');
  await act(async () => {
    firstProfile.resolve();
    await assert.rejects(oldLogin, /session changed unexpectedly/i);
  });
  assert.equal(auth.state.user.id, 'account-b');
  assert.equal(auth.state.role, 'health_supervisor');
  assert.equal(auth.calls.signOut, 0);
});

test('logout cancels an outstanding password grant and never lets it authenticate after sign-out', async () => {
  const credentials = deferred();
  const auth = await mountAuth({ passwordGrant: () => credentials.promise });
  let login;
  let logout;
  await act(async () => {
    login = auth.state.login({ email: 'account-a@example.test', password: 'test-password' }); login.catch(() => {});
    logout = auth.state.logout(false);
    credentials.resolve({ data: { session: sessionFor() }, error: null });
    await logout;
    await assert.rejects(login, /cancelled/i);
  });
  await settleEvents();
  assert.equal(auth.state.isAuthenticated, false);
  assert.equal(auth.state.session, null);
  assert.equal(auth.calls.signOut, 1);
  assert.equal(auth.persistedSession, null);
});

test('logout clears local auth and owner cache when Supabase sign-out fails, without losing pending work', async () => {
  const auth = await mountAuth({
    initial: sessionFor('account-a'),
    signOutFailure: new TypeError('Failed to fetch'),
  });
  await settleEvents(() => auth.state.isAuthenticated && !auth.state.isResolvingProfile);
  await cacheRecord({
    entity: 'resident',
    remoteId: 'cached-resident',
    ownerId: 'account-a',
    data: { id: 'cached-resident', name: 'Synthetic resident' },
  });
  const pending = await queueCreate({
    entity: 'household',
    ownerId: 'account-a',
    data: { headName: 'Synthetic pending household' },
    mutationType: MUTATION_TIER.SAFE_SYNC,
  });

  await act(async () => { await auth.state.logout(false); });

  assert.equal(auth.state.isAuthenticated, false);
  assert.equal(auth.state.session, null);
  assert.equal(auth.state.user, null);
  assert.equal(auth.persistedSession, null);
  assert.equal(auth.calls.persistedStorageClears, 1);
  assert.equal(auth.calls.signOut, 2, 'a local SDK sign-out follows the failed global sign-out');
  assert.equal(await db.records.where('ownerId').equals('account-a').count(), 0, 'owner-scoped disposable cache is cleaned');
  assert.equal((await db.outbox.get(pending.operation.opId)).status, 'pending', 'unsynced work is retained');

  await act(async () => { renderer.unmount(); });
  renderer = null;
  const reloaded = await mountAuth({ initial: auth.persistedSession });
  await settleEvents(() => reloaded.state.authChecked && !reloaded.state.isResolvingProfile);
  assert.equal(reloaded.state.isAuthenticated, false, 'a reload cannot restore the logged-out session');
  assert.equal(reloaded.calls.profile, 0);
});

test('logout clears persisted auth when Supabase returns a sign-out error', async () => {
  const auth = await mountAuth({
    initial: sessionFor('account-a'),
    signOutFailure: { message: 'Remote sign-out failed' },
  });
  await settleEvents(() => auth.state.isAuthenticated && !auth.state.isResolvingProfile);

  await act(async () => { await auth.state.logout(false); });

  assert.equal(auth.state.isAuthenticated, false);
  assert.equal(auth.persistedSession, null);
  assert.equal(auth.calls.persistedStorageClears, 1);
  assert.equal(auth.calls.signOut, 2);
});

test('a genuine server account rejection remains blocked and ends only its own session', async () => {
  const auth = await mountAuth({ profile: async () => { throw Object.assign(new Error('Your account is awaiting verification.'), { status: 403 }); } });
  await act(async () => {
    await assert.rejects(auth.state.login({ email: 'account-a@example.test', password: 'test-password' }), /verification/i);
  });
  assert.equal(auth.state.isAuthenticated, false);
  assert.equal(auth.state.role, null);
  assert.equal(auth.calls.signOut, 1);
});

test('invalid credentials and unverified email errors are distinct and do not fetch application profiles', async () => {
  for (const [code, message] of [['invalid_credentials', /invalid email or password/i], ['email_not_confirmed', /not verified.*confirm your email/i]]) {
    const auth = await mountAuth({ passwordGrant: async () => ({ data: { session: null }, error: { status: 400, code } }) });
    await act(async () => {
      await assert.rejects(auth.state.login({ email: 'account-a@example.test', password: 'test-password' }), message);
    });
    assert.equal(auth.calls.profile, 0);
    assert.equal(auth.state.isAuthenticated, false);
    await act(async () => { renderer.unmount(); });
    renderer = null;
  }
});

test('a temporary profile outage recovers through the real retained session without another password request', async () => {
  let available = false;
  const auth = await mountAuth({ profile: async (id) => {
    if (!available) throw Object.assign(new Error('Failed to fetch'), { name: 'TypeError' });
    return { id, role: 'phn' };
  } });
  await act(async () => {
    await assert.rejects(auth.state.login({ email: 'account-a@example.test', password: 'test-password' }), /connection|reach your account profile/i);
  });
  available = true;
  await act(async () => { await auth.state.refreshProfile(); });
  assert.equal(auth.calls.credentials, 1);
  assert.equal(auth.calls.signOut, 0);
  assert.equal(auth.state.role, 'phn');
  assert.equal(auth.state.authNotice, null);
});

test('the login UI synchronously locks submissions and waits for profile/session completion before navigation', async () => {
  const login = await readFile(new URL('../../src/features/authentication/pages/Login.jsx', import.meta.url), 'utf8');
  const guard = await readFile(new URL('../../src/routes/ProtectedRoute.jsx', import.meta.url), 'utf8');
  assert.match(login, /if \(submittingRef\.current \|\| authBusy\) return/);
  assert.match(login, /submittingRef\.current = true/);
  assert.match(login, /disabled=\{submitting \|\| authBusy \|\| !isSupabaseConfigured\}/);
  assert.match(login, /await login\(\{ email, password \}, \{/);
  assert.match(guard, /isResolvingProfile \|\| isSigningIn \|\| isSigningOut/);
});

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { captureOwnerGuard, db, setOfflineOwnerResolver } from '../../src/services/offline/db.js';
import { decryptJson, encryptJson, resetCachedKey } from '../../src/services/offline/crypto.js';
import { cacheRecord } from '../../src/services/offline/records.js';
import { queueCreate } from '../../src/services/offline/queue.js';
import { MUTATION_TIER } from '../../src/services/offline/mutationPolicy.js';
import { cacheVerifiedPermissions, invalidateVerifiedPermissions, PERMISSION_CACHE_TTL_MS } from '../../src/services/accessControl/permissionCache.js';
import { cacheServerVerifiedProfile, invalidateServerVerifiedProfile, readServerVerifiedProfile, verifiedProfileScopeKey, VERIFIED_PROFILE_CACHE_TTL_MS } from '../../src/services/offline/verifiedProfileCache.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const MUNICIPALITY = '33333333-3333-4333-8333-333333333333';
const BARANGAY = '44444444-4444-4444-8444-444444444444';
const NEXT_BARANGAY = '55555555-5555-4555-8555-555555555555';
const CACHE_KEY = 'verifiedAuthProfile';
let moduleVersion = 0;
let mounted = [];
let originalWindow;
let originalNavigator;
let originalFetch;
let networkAttempts;

const sessionFor = (id = OWNER, token = 'synthetic-verified-session') => ({
  access_token: token, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id, email: `${id}@example.test`, is_anonymous: false, user_metadata: { role: 'admin', name: 'Synthetic account' } },
});
const profileFor = (id = OWNER) => ({
  id, email: `${id}@example.test`, name: 'Server-confirmed account', role: 'bhw', status: 'active',
  municipalityId: MUNICIPALITY, municipality: 'Test Municipality', barangayId: BARANGAY,
  barangay: 'San Isidro', facilityId: null, rhuStations: [], contact: 'Not required in offline profile',
});
const outage = () => { throw new TypeError('Failed to fetch'); };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const until = async (ready) => {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    if (ready()) return;
  }
  assert.fail('The real Auth/Permissions startup path did not settle.');
};

beforeEach(async () => {
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  originalFetch = globalThis.fetch;
  const browser = new EventTarget();
  browser.location = { pathname: '/app/bhw/dashboard', hash: '', href: '/app/bhw/dashboard' };
  browser.setTimeout = globalThis.setTimeout;
  browser.clearTimeout = globalThis.clearTimeout;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  networkAttempts = 0;
  globalThis.fetch = async () => { networkAttempts += 1; throw new Error('Live requests are disabled in this isolated test.'); };
  setOfflineOwnerResolver(null);
  resetCachedKey();
  if (!db.isOpen()) await db.open();
  await Promise.all([db.drafts.clear(), db.outbox.clear(), db.records.clear(), db.syncMeta.clear(), db.keys.clear()]);
});
afterEach(async () => {
  for (const instance of mounted) await instance.unmount();
  mounted = [];
  setOfflineOwnerResolver(null);
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete globalThis.window;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete globalThis.navigator;
  globalThis.fetch = originalFetch;
  delete globalThis.__verifiedProfileStartup;
  assert.equal(networkAttempts, 0, 'no real network transport may run');
});

const mountPortal = async ({ initial = sessionFor(), profile = async (id) => profileFor(id), passwordSession, passwordError } = {}) => {
  let sdkSession = initial;
  let profileHandler = profile;
  const listeners = new Set();
  const calls = { session: 0, profile: 0, permissions: 0, password: 0, signOut: 0 };
  const emit = (event, nextSession) => {
    sdkSession = nextSession;
    for (const callback of listeners) callback(event, nextSession);
  };
  const mocks = {
    supabase: { auth: {
      getSession: async () => { calls.session += 1; return { data: { session: sdkSession }, error: null }; },
      onAuthStateChange: (callback) => {
        listeners.add(callback);
        queueMicrotask(() => { if (listeners.has(callback)) callback('INITIAL_SESSION', sdkSession); });
        return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
      },
      signInWithPassword: async () => {
        calls.password += 1;
        if (passwordError) return { data: { session: null }, error: passwordError };
        const nextSession = passwordSession || sessionFor(OWNER, 'synthetic-new-password-session');
        emit('SIGNED_IN', nextSession);
        return { data: { session: nextSession }, error: null };
      },
      signOut: async () => { calls.signOut += 1; emit('SIGNED_OUT', null); return { error: null }; },
    } },
    authApi: {
      me: async ({ ownerId, headers }) => {
        calls.profile += 1;
        const guard = captureOwnerGuard(ownerId);
        assert.equal(guard(), true);
        assert.equal(headers.Authorization, `Bearer ${sdkSession.access_token}`);
        return { user: await profileHandler(ownerId) };
      },
      logout: async () => ({ success: true }),
    },
    rolesApi: { getMatrix: async () => {
      calls.permissions += 1;
      if (!navigator.onLine) return outage();
      return mocks.matrix;
    } },
  };
  globalThis.__verifiedProfileStartup = mocks;
  const compiled = await build({
    absWorkingDir: ROOT, bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent',
    stdin: { resolveDir: ROOT, contents: `export {AuthProvider,useAuth} from '@/context/AuthContext';
      export {PermissionsProvider,usePermissions} from '@/context/PermissionsContext';
      export {defaultPermissionsForRole} from '@/lib/permissions'; export const instance=${++moduleVersion};` },
    plugins: [{ name: 'isolated-portal', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({ path: import.meta.resolve('react'), external: true }));
      builder.onResolve({ filter: /^@\/lib\/supabase$/ }, () => ({ path: 'supabase', namespace: 'portal-mock' }));
      builder.onResolve({ filter: /^@\/services\/api$/ }, () => ({ path: 'authApi', namespace: 'portal-mock' }));
      builder.onResolve({ filter: /^@\/services\/api\/rolesApi$/ }, () => ({ path: 'rolesApi', namespace: 'portal-mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'portal-mock' }, ({ path: name }) => ({ contents: name === 'supabase'
        ? 'export const supabase=globalThis.__verifiedProfileStartup.supabase; export const isSupabaseConfigured=true; export const supabaseConfigurationError=null;'
        : `export const ${name}=globalThis.__verifiedProfileStartup.${name};`, loader: 'js' }));
      // These are the real shared Dexie/crypto/lifecycle/cache APIs, not copied
      // provider state or handcrafted permission/Auth implementations.
      builder.onResolve({ filter: /^@\/services\/(offline\/(db|records|syncEngine|verifiedProfileCache)|accessControl\/permissionCache|auth\/authOwnerLifecycle|local\/accountWorkingSets)$/ }, ({ path: name }) => ({
        path: pathToFileURL(path.join(ROOT, 'src', `${name.slice(2)}.js`)).href, external: true,
      }));
      builder.onResolve({ filter: /^@\// }, ({ path: name, kind }) => builder.resolve(path.join(ROOT, 'src', name.slice(2)).replaceAll('\\', '/'), { kind, resolveDir: ROOT }));
    } }],
  });
  const portal = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  mocks.matrix = { bhw: portal.defaultPermissionsForRole('bhw'), phn: portal.defaultPermissionsForRole('phn'), admin: portal.defaultPermissionsForRole('admin') };
  let current;
  let permissions;
  let renderer;
  const Probe = () => { current = portal.useAuth(); permissions = portal.usePermissions(); return null; };
  const warn = console.error;
  console.error = (...args) => { if (!String(args[0]).includes('react-test-renderer is deprecated')) warn(...args); };
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(portal.AuthProvider, null,
      React.createElement(portal.PermissionsProvider, null, React.createElement(Probe)))); });
  } finally { console.error = warn; }
  const instance = {
    get auth() { return current; }, get permissions() { return permissions; }, get sdkSession() { return sdkSession; },
    calls, emit, matrix: mocks.matrix, setProfile: (handler) => { profileHandler = handler; },
    unmount: async () => {
      if (!renderer) return;
      await act(async () => { renderer.unmount(); });
      renderer = null;
      // Drain disposable cleanup before emulating a new browser runtime.
      await Promise.all([db.records.count(), db.outbox.count(), db.drafts.count()]);
    },
  };
  mounted.push(instance);
  return instance;
};

const confirmOnline = async (options) => {
  const portal = await mountPortal(options);
  await until(() => portal.auth.isAuthenticated && !portal.auth.isResolvingProfile &&
    portal.permissions.matrixLoadState.status === 'ready' && portal.permissions.matrixLoadState.source === 'server');
  assert.equal(portal.auth.profileSource, 'server');
  assert.equal((await db.syncMeta.get(CACHE_KEY)).value.enc, true);
  return portal;
};
const reloadOffline = async (previous, options = {}) => {
  const session = previous.sdkSession;
  await previous.unmount();
  db.close();
  resetCachedKey();
  await db.open();
  navigator.onLine = false;
  const portal = await mountPortal({ initial: session, profile: outage, ...options });
  await until(() => portal.auth.authChecked && !portal.auth.isResolvingProfile &&
    (!portal.auth.isAuthenticated || portal.permissions.matrixLoadState.status === 'ready'));
  return portal;
};
const rewriteProfile = async (change) => {
  const row = await db.syncMeta.get(CACHE_KEY);
  const snapshot = await decryptJson(row.value);
  change(snapshot);
  await db.syncMeta.put({ ...row, value: await encryptJson(snapshot), revision: row.revision + 1 });
};

test('browser reload restores real AuthProvider + PermissionsProvider from only server-confirmed encrypted snapshots', async () => {
  const online = await confirmOnline();
  const raw = await db.syncMeta.get(CACHE_KEY);
  const snapshot = await decryptJson(raw.value);
  assert.equal(snapshot.user.role, 'bhw', 'untrusted admin metadata must not become an application role');
  assert.equal(Object.hasOwn(snapshot, 'access_token'), false);
  assert.equal(Object.hasOwn(snapshot.user, 'contact'), false);
  assert.equal(JSON.stringify(raw).includes(online.sdkSession.access_token), false);
  assert.ok(snapshot.expiresAt <= online.sdkSession.expires_at * 1000);
  assert.ok(snapshot.expiresAt <= snapshot.verifiedAt + VERIFIED_PROFILE_CACHE_TTL_MS);
  const restored = await reloadOffline(online);
  assert.equal(restored.auth.isAuthenticated, true);
  assert.equal(restored.auth.role, 'bhw');
  assert.equal(restored.auth.user.barangayId, BARANGAY);
  assert.equal(restored.auth.user.assignedBarangay, 'San Isidro');
  assert.equal(restored.auth.profileSource, 'cache');
  assert.equal(restored.auth.isOfflineProfile, true);
  assert.match(restored.auth.authNotice, /previously server-verified.*cached permissions/i);
  assert.equal(restored.permissions.matrixLoadState.source, 'cache');
  assert.equal(restored.permissions.can('households.view'), true);
  assert.equal(restored.calls.profile, 1);
  assert.equal(restored.calls.password, 0);
  assert.equal(restored.calls.signOut, 0);
});

test('missing, expired, wrong-role and plaintext permission snapshots cannot admit a cached Auth role', async (t) => {
  for (const reason of ['missing', 'expired', 'wrong-role', 'plaintext']) {
    await t.test(reason, async () => {
      navigator.onLine = true;
      const online = await confirmOnline();
      if (reason === 'missing') await invalidateVerifiedPermissions(OWNER);
      if (reason === 'expired') await cacheVerifiedPermissions({ userId: OWNER, role: 'bhw', matrix: online.matrix, now: Date.now() - PERMISSION_CACHE_TTL_MS - 1 });
      if (reason === 'wrong-role') await cacheVerifiedPermissions({ userId: OWNER, role: 'admin', matrix: online.matrix });
      if (reason === 'plaintext') {
        const row = await db.syncMeta.get(`verifiedPermissions:${OWNER}`);
        await db.syncMeta.put({ ...row, value: { enc: false, data: await decryptJson(row.value) } });
      }
      const restored = await reloadOffline(online);
      assert.equal(restored.auth.isAuthenticated, false);
      assert.equal(restored.auth.role, null);
      assert.equal(restored.permissions.can('households.view'), false);
      assert.equal(restored.calls.signOut, 0);
      await restored.unmount();
    });
  }
});

test('missing/expired/future/mismatched/revoked profile lifecycle and coverage snapshots fail closed on real reload', async (t) => {
  const changes = {
    missing: null,
    expired: (snapshot) => { snapshot.verifiedAt = Date.now() - VERIFIED_PROFILE_CACHE_TTL_MS - 1; snapshot.expiresAt = snapshot.verifiedAt + VERIFIED_PROFILE_CACHE_TTL_MS; },
    future: (snapshot) => { snapshot.verifiedAt = Date.now() + 60000; },
    'missing-lifecycle': (snapshot) => { delete snapshot.user.status; },
    revoked: (snapshot) => { snapshot.user.status = 'disabled'; snapshot.scopeKey = verifiedProfileScopeKey(snapshot.user); },
    'wrong-owner': (snapshot) => { snapshot.user.id = OTHER; },
    'wrong-role': (snapshot) => { snapshot.user.role = 'admin'; snapshot.scopeKey = verifiedProfileScopeKey(snapshot.user); },
    'wrong-scope': (snapshot) => { snapshot.user.barangayId = NEXT_BARANGAY; },
    'wrong-assigned-scope': (snapshot) => { snapshot.user.assignedBarangay = 'San Antonio'; },
    'missing-scope': (snapshot) => { snapshot.user.municipalityId = null; snapshot.scopeKey = verifiedProfileScopeKey(snapshot.user); },
  };
  for (const [reason, change] of Object.entries(changes)) {
    await t.test(reason, async () => {
      navigator.onLine = true;
      const online = await confirmOnline();
      if (change) await rewriteProfile(change); else await invalidateServerVerifiedProfile(OWNER);
      const restored = await reloadOffline(online);
      assert.equal(restored.auth.isAuthenticated, false);
      assert.equal(restored.auth.role, null);
      assert.equal(restored.auth.isOfflineProfile, false);
      assert.equal(restored.permissions.can('households.view'), false);
      await restored.unmount();
    });
  }
});

test('restored subject, exact token, expiry and anonymous session must match the prior server proof', async (t) => {
  for (const reason of ['owner', 'token', 'expiry', 'expired-session', 'anonymous']) {
    await t.test(reason, async () => {
      navigator.onLine = true;
      const online = await confirmOnline();
      const original = online.sdkSession;
      const session = { ...original, user: { ...original.user } };
      if (reason === 'owner') session.user.id = OTHER;
      if (reason === 'token') session.access_token = 'synthetic-unverified-token';
      if (reason === 'expiry') session.expires_at += 3600;
      if (reason === 'expired-session') session.expires_at = Math.floor(Date.now() / 1000) - 1;
      if (reason === 'anonymous') session.user.is_anonymous = true;
      const restored = await reloadOffline(online, { initial: session });
      assert.equal(restored.auth.isAuthenticated, false);
      assert.equal(restored.auth.role, null);
      assert.equal(restored.permissions.can('households.view'), false);
      await restored.unmount();
    });
  }
});

test('explicit password sign-in and new registration sessions never gain offline access from an old cache', async () => {
  const online = await confirmOnline();
  const restored = await reloadOffline(online, { passwordSession: online.sdkSession });
  assert.equal(restored.auth.isAuthenticated, true);
  await act(async () => {
    await assert.rejects(restored.auth.login({ email: 'synthetic@example.test', password: 'synthetic-password' }), /account profile/i);
  });
  assert.equal(restored.auth.isAuthenticated, false);
  assert.equal(restored.auth.role, null);
  assert.equal((await db.syncMeta.get(CACHE_KEY)).value, null);
  await act(async () => { restored.emit('SIGNED_IN', sessionFor(OTHER, 'synthetic-new-registration-session')); });
  await until(() => !restored.auth.isResolvingProfile);
  assert.equal(restored.auth.isAuthenticated, false);
  assert.equal(restored.auth.role, null);
  assert.equal(restored.permissions.can('households.view'), false);
});

test('an anonymous startup and recovery flow cannot consume cached application access or perform offline sign-in', async () => {
  const online = await confirmOnline();
  const anonymous = await reloadOffline(online, { initial: null, passwordError: { name: 'AuthRetryableFetchError', status: 0 } });
  assert.equal(anonymous.auth.isAuthenticated, false);
  await act(async () => { await assert.rejects(anonymous.auth.login({ email: 'synthetic@example.test', password: 'synthetic-password' }), /internet connection|cannot connect|network/i); });
  assert.equal(anonymous.auth.isAuthenticated, false);
  await anonymous.unmount();
  navigator.onLine = true;
  const confirmed = await confirmOnline();
  window.location.pathname = '/reset-password';
  const recovery = await reloadOffline(confirmed);
  assert.equal(recovery.auth.isAuthenticated, false);
  assert.equal(recovery.calls.profile, 0);
  assert.equal(recovery.calls.signOut, 0, 'password-recovery SDK session must survive');
});

test('server account rejection on reload overrides old cached profiles and invalidates both snapshots', async (t) => {
  for (const status of [401, 403]) {
    await t.test(String(status), async () => {
      navigator.onLine = true;
      const online = await confirmOnline();
      const restored = await reloadOffline(online, { profile: async () => { throw Object.assign(new Error('Account access rejected'), { status }); } });
      assert.equal(restored.auth.isAuthenticated, false);
      assert.equal(restored.auth.role, null);
      assert.equal(restored.calls.signOut, 1);
      assert.equal((await db.syncMeta.get(CACHE_KEY)).value, null);
      assert.equal(await db.syncMeta.get(`verifiedPermissions:${OWNER}`), undefined);
      await restored.unmount();
    });
  }
});

test('reconnection refreshes the server profile and known same-owner scope changes fence stale reads while retaining pending data', async () => {
  const online = await confirmOnline();
  await cacheRecord({ entity: 'household', remoteId: 'HH-OLD-SCOPE', ownerId: OWNER, data: { id: 'HH-OLD-SCOPE', barangay: 'San Isidro' } });
  const pending = await queueCreate({ entity: 'household', ownerId: OWNER, data: { headName: 'Preserved synthetic draft', barangay: 'San Isidro' }, mutationType: MUTATION_TIER.SAFE_SYNC });
  const staleGuard = captureOwnerGuard(OWNER);
  const nextProfile = { ...profileFor(), barangay: 'San Antonio', barangayId: NEXT_BARANGAY };
  online.setProfile(async () => nextProfile);
  await act(async () => { assert.equal(await online.auth.refreshProfile(), 'bhw'); });
  await until(() => online.permissions.matrixLoadState.status === 'ready' && online.permissions.matrixLoadState.source === 'server');
  assert.equal(staleGuard(), false);
  assert.equal(online.auth.user.barangayId, NEXT_BARANGAY);
  assert.equal(await db.records.where('remoteId').equals('HH-OLD-SCOPE').count(), 0);
  assert.equal((await db.outbox.get(pending.operation.opId)).status, 'pending');
  assert.equal((await db.outbox.get(pending.operation.opId)).payload.enc, true);
  const restored = await reloadOffline(online);
  assert.equal(restored.auth.user.barangay, 'San Antonio');
  assert.equal(restored.auth.user.barangayId, NEXT_BARANGAY);
  navigator.onLine = true;
  restored.setProfile(async () => nextProfile);
  await act(async () => { window.dispatchEvent(new Event('online')); });
  await until(() => restored.auth.profileSource === 'server' && !restored.auth.isResolvingProfile);
  assert.equal(restored.auth.isOfflineProfile, false);
  assert.equal(restored.auth.authNotice, null);
  assert.equal(restored.calls.password, 0);
});

test('logout and known rejected permissions invalidate cached access without deleting pending work', async () => {
  const online = await confirmOnline();
  const pending = await queueCreate({ entity: 'household', ownerId: OWNER, data: { headName: 'Preserved synthetic draft' }, mutationType: MUTATION_TIER.SAFE_SYNC });
  const restored = await reloadOffline(online);
  await act(async () => { window.dispatchEvent(new CustomEvent('kalusagap:permissions-invalidated', { detail: { userId: OWNER, status: 403 } })); });
  await until(() => !restored.auth.isAuthenticated);
  assert.equal(restored.auth.role, null);
  assert.equal(restored.permissions.can('households.view'), false);
  await act(async () => { await restored.auth.logout(false); });
  assert.equal((await db.syncMeta.get(CACHE_KEY)).value, null);
  assert.equal(await db.syncMeta.get(`verifiedPermissions:${OWNER}`), undefined);
  assert.equal((await db.outbox.get(pending.operation.opId)).status, 'pending');
});

test('permission expiry bounds offline Auth access during the mounted session, not just at the next reload', async () => {
  const online = await confirmOnline();
  await cacheVerifiedPermissions({ userId: OWNER, role: 'bhw', matrix: online.matrix, now: Date.now() - PERMISSION_CACHE_TTL_MS + 1500 });
  const restored = await reloadOffline(online);
  assert.equal(restored.auth.isAuthenticated, true);
  await until(() => !restored.auth.isAuthenticated);
  assert.equal(restored.auth.role, null);
  assert.equal(restored.auth.session.user.id, OWNER, 'the still-valid SDK session is retained');
  assert.match(restored.auth.authNotice, /cached account access expired/i);
});

test('revocation tombstones prevent a delayed encrypted write from resurrecting a cached lifecycle', async (t) => {
  const online = await confirmOnline();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const crypto = globalThis.crypto;
  const began = deferred();
  const release = deferred();
  const subtle = new Proxy(crypto.subtle, { get(target, name) {
    if (name === 'encrypt') return async (...args) => { began.resolve(); await release.promise; return target.encrypt(...args); };
    const value = Reflect.get(target, name, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle, getRandomValues: crypto.getRandomValues.bind(crypto) } });
  t.after(() => { release.resolve(); Object.defineProperty(globalThis, 'crypto', original); });
  const write = cacheServerVerifiedProfile({ user: online.auth.user, session: online.sdkSession });
  await began.promise;
  await invalidateServerVerifiedProfile(OWNER);
  release.resolve();
  assert.equal(await write, null);
  assert.equal((await db.syncMeta.get(CACHE_KEY)).value, null);
  assert.equal(await readServerVerifiedProfile({ session: online.sdkSession }), null);
});

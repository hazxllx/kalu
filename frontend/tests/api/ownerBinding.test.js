import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { setOfflineOwnerResolver, invalidateOfflineOwner } from '../../src/services/offline/db.js';

const clientUrl = new URL('../../src/services/api/apiClient.js', import.meta.url);
const originalFetch = globalThis.fetch;
let owner;
let identity;
let calls;
let serial = 0;

const loadClient = async (getSession = async () => ({ data: { session: identity } })) => {
  globalThis.__ownerBindingTest = {
    supabase: { auth: { getSession } }, isSupabaseConfigured: true, supabaseConfigurationError: null,
  };
  // Substitute only the SDK dependency; exercise the real request/guard code.
  const source = (await readFile(clientUrl, 'utf8'))
    .replace(/import\s+\{[^}]*\bsupabase\b[^}]*\}\s+from\s+'[^']+';/,
      'const { supabase, isSupabaseConfigured, supabaseConfigurationError } = globalThis.__ownerBindingTest;')
    .replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_match, _quote, path) => `from '${new URL(path, clientUrl).href}'`);
  assert.ok(source.includes('= globalThis.__ownerBindingTest;'), 'The test replaces the SDK import, not the request implementation');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#owner-${serial++}`);
};

beforeEach(() => {
  owner = 'owner-a';
  setOfflineOwnerResolver(() => owner);
  identity = { user: { id: owner }, access_token: 'unit-test-token', expires_at: Math.floor(Date.now() / 1000) + 3600 };
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ data: { id: 'authorized-test-record' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; setOfflineOwnerResolver(null); delete globalThis.__ownerBindingTest; });

test('authorized requests bind the token owner and never pass owner metadata as Fetch options', async () => {
  const { api } = await loadClient();
  assert.deepEqual(await api.get('/residents/test', { ownerId: owner }), { id: 'authorized-test-record' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer unit-test-token');
  assert.equal('ownerId' in calls[0].options, false);
});

test('implicit private requests bind to the active account before awaiting a Supabase token', async () => {
  const { api } = await loadClient(async () => {
    owner = 'owner-b';
    return { data: { session: { ...identity, user: { id: 'owner-b' } } } };
  });
  await assert.rejects(api.get('/reports'), { status: 401 });
  assert.equal(calls.length, 0);
});

test('a queued operation cannot borrow another account token even when UI auth state is stale', async () => {
  identity.user.id = 'owner-b';
  const { api } = await loadClient();
  await assert.rejects(api.post('/consultations', { consultation: {} }, { ownerId: 'owner-a' }), { status: 401 });
  assert.equal(calls.length, 0);
});

test('explicit wrong owner is rejected before the SDK session is read', async () => {
  let sdkReads = 0;
  const { api } = await loadClient(async () => { sdkReads += 1; return { data: { session: identity } }; });
  await assert.rejects(api.get('/residents/test', { ownerId: 'other-account' }), { status: 401 });
  assert.equal(sdkReads, 0);
  assert.equal(calls.length, 0);
});

test('expired session never uploads pending clinical information', async () => {
  identity.expires_at = Math.floor(Date.now() / 1000) - 1;
  const { api } = await loadClient();
  await assert.rejects(api.post('/consultations', { consultation: {} }, { ownerId: owner }), { status: 401 });
  assert.equal(calls.length, 0);
});

test('late JSON response after an account switch cannot enter the next account UI/cache', async () => {
  let releaseBody;
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  globalThis.fetch = async () => ({
    ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => { started(); return new Promise((resolve) => { releaseBody = resolve; }); },
  });
  const { api } = await loadClient();
  const response = api.get('/residents/test', { ownerId: owner });
  await began;
  owner = 'owner-b';
  invalidateOfflineOwner('owner-a');
  releaseBody({ data: { id: 'old-owner-record' } });
  await assert.rejects(response, { status: 401 });
});

test('sign-out and sign-in to the same account still invalidate an already-started request', async () => {
  let release;
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  globalThis.fetch = async () => {
    started();
    await new Promise((resolve) => { release = resolve; });
    return new Response(JSON.stringify({ data: { id: 'old-session-record' } }), { headers: { 'content-type': 'application/json' } });
  };
  const { api } = await loadClient();
  const response = api.get('/residents/test');
  await began;
  invalidateOfflineOwner(owner);
  release();
  await assert.rejects(response, { status: 401 });
});

test('multipart uploads use the same identity fence without forcing JSON content type', async () => {
  const { postFormData } = await loadClient();
  const body = new FormData();
  body.append('field', 'test');
  await postFormData('/documents', body, { ownerId: owner });
  assert.equal(calls[0].options.body, body);
  assert.equal(calls[0].options.headers['Content-Type'], undefined);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const middlewareUrl = new URL('../src/middleware/authenticate.js', import.meta.url);
let serial = 0;
const loadMiddleware = async (
  getUser,
  loadProfile = async () => { throw new Error('Unexpected profile lookup'); },
  request = {},
) => {
  globalThis.__authMiddlewareConnectivity = { getUser, loadProfile };
  const source = (await readFile(middlewareUrl, 'utf8'))
    .replace(/import env from '[^']+';/, 'const env = { isSupabaseConfigured: true };')
    .replace(/import \{ getServiceClient \} from '[^']+';/,
      'const getServiceClient = () => ({ auth: { getUser: globalThis.__authMiddlewareConnectivity.getUser } });')
    .replace(/import \{ loadSessionProfile, profileToSessionUser \} from '[^']+';/,
      'const loadSessionProfile = globalThis.__authMiddlewareConnectivity.loadProfile; const profileToSessionUser = (profile) => profile;')
    .replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_match, _quote, path) => `from '${new URL(path, middlewareUrl).href}'`);
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#auth-middleware-${serial++}`);
  return async () => {
    const req = {
      headers: { authorization: 'Bearer test-session-token' },
      method: 'GET',
      originalUrl: '/api/auth/me',
      ...request,
    };
    let failure;
    await new Promise((resolve) => { module.authenticate(req, {}, (error) => { failure = error; resolve(); }); });
    return { failure, user: req.user };
  };
};

test('persistent Supabase transport failures are 503 and never masquerade as expired credentials', async () => {
  let attempts = 0;
  const verify = await loadMiddleware(async () => {
    attempts += 1;
    return { data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' } };
  });
  const { failure } = await verify();
  assert.equal(attempts, 2);
  assert.equal(failure.statusCode, 503);
  assert.equal(failure.code, 'AUTH_SERVICE_UNAVAILABLE');
});

test('thrown transport failures receive one retry and remain service errors, not 401', async () => {
  let attempts = 0;
  const verify = await loadMiddleware(async () => { attempts += 1; throw new TypeError('Failed to fetch'); });
  const { failure } = await verify();
  assert.equal(attempts, 2);
  assert.equal(failure.statusCode, 503);
});

test('genuine invalid JWT and rate limiting retain distinct statuses without retrying or loading profiles', async () => {
  for (const [status, expected] of [[401, 401], [429, 429]]) {
    let attempts = 0;
    const verify = await loadMiddleware(async () => { attempts += 1; return { data: { user: null }, error: { status, message: 'Authentication rejected' } }; });
    assert.equal((await verify()).failure.statusCode, expected);
    assert.equal(attempts, 1);
  }
});

test('a malformed successful auth response is unavailable verification, not proof that a valid session expired', async () => {
  const verify = await loadMiddleware(async () => ({ data: { user: null }, error: null }));
  assert.equal((await verify()).failure.statusCode, 503);
});

test('successful token verification still requires the authoritative active server profile', async () => {
  const verify = await loadMiddleware(async () => ({ data: { user: { id: 'verified-account' } }, error: null }),
    async () => { throw Object.assign(new Error('Account awaiting verification'), { statusCode: 403 }); });
  assert.equal((await verify()).failure.statusCode, 403);
});

test('temporary-password sessions may resolve their profile but cannot access protected API routes', async () => {
  const verify = await loadMiddleware(
    async () => ({ data: { user: { id: 'temporary-account' } }, error: null }),
    async () => ({
      profile: { id: 'temporary-account', role: 'phn', status: 'disabled' },
      passwordStatus: { mustChangePassword: true },
    }),
    { method: 'GET', originalUrl: '/api/residents' },
  );
  const result = await verify();
  assert.equal(result.failure.statusCode, 403);
  assert.equal(result.failure.code, 'PASSWORD_CHANGE_REQUIRED');
});

test('temporary-password sessions retain access to session verification and logout only', async () => {
  const loadProfile = async () => ({
    profile: { id: 'temporary-account', role: 'phn', status: 'disabled' },
    passwordStatus: { mustChangePassword: true },
  });
  const verifyMe = await loadMiddleware(
    async () => ({ data: { user: { id: 'temporary-account' } }, error: null }),
    loadProfile,
  );
  const me = await verifyMe();
  assert.equal(me.failure, undefined);
  assert.equal(me.user.mustChangePassword, true);

  const verifyLogout = await loadMiddleware(
    async () => ({ data: { user: { id: 'temporary-account' } }, error: null }),
    loadProfile,
    { method: 'POST', originalUrl: '/api/auth/logout' },
  );
  assert.equal((await verifyLogout()).failure, undefined);
});

test('expired temporary-password sessions cannot use even the password challenge or session endpoint', async () => {
  const verify = await loadMiddleware(
    async () => ({ data: { user: { id: 'expired-temporary-account' } }, error: null }),
    async () => ({
      profile: { id: 'expired-temporary-account', role: 'phn', status: 'disabled' },
      passwordStatus: { mustChangePassword: true, temporaryPasswordExpired: true },
    }),
    { method: 'GET', originalUrl: '/api/auth/me' },
  );
  const result = await verify();
  assert.equal(result.failure.statusCode, 403);
  assert.equal(result.failure.code, 'TEMPORARY_PASSWORD_EXPIRED');
  assert.match(result.failure.message, /expired/i);
});

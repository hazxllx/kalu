import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadLocalEnvironment, localContentSecurityPolicy } from '../../config/localDevelopment.js';
import { requireLocalUrl, validateLocalEnvironment } from '../../src/lib/localSafety.js';
import { resolveApiBaseUrl } from '../../src/services/api/apiBaseUrl.js';

const frontend = fileURLToPath(new URL('../../', import.meta.url));
const local = {
  VITE_APP_BASE_URL: 'http://localhost:5173',
  VITE_API_URL: 'http://localhost:5000/api',
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_ANON_KEY: '',
};
const jwt = (claims) => `test.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test`;

test('blank local auth is safe, and only local anon JWT claims are accepted', () => {
  assert.doesNotThrow(() => validateLocalEnvironment(local));
  assert.doesNotThrow(() => validateLocalEnvironment({ ...local, VITE_SUPABASE_ANON_KEY: jwt({ iss: 'supabase-demo', role: 'anon' }) }));
  for (const key of [
    'sb_secret_do-not-use', 'sb_publishable_hosted', 'malformed',
    jwt({ iss: 'supabase', role: 'anon', ref: 'hosted-project' }),
    jwt({ iss: 'supabase', role: 'anon' }),
    jwt({ iss: 'http://127.0.0.1:54321/auth/v1', role: 'anon' }),
    jwt({ iss: 'supabase-demo', role: 'service_role' }),
    jwt({ iss: 'supabase-demo', role: 'authenticated' }),
    jwt({ iss: 'https://auth.example.test', role: 'anon' }),
  ]) {
    assert.throws(() => validateLocalEnvironment({ ...local, VITE_SUPABASE_ANON_KEY: key }));
  }
});

test('application endpoints reject hosted targets, URL tricks and embedded credentials', () => {
  for (const value of [
    'https://project.supabase.co', 'https://api.example.test', 'http://localhost.evil.test',
    'http://127.0.0.1.evil.test', 'http://db.local', 'http://0.0.0.0:5000',
    'http://localhost@evil.test', 'http://user:password@localhost', '//localhost/api',
    'file:///localhost', 'http://localhost?remote=1', 'http://localhost/#fragment',
    'http://localhost\\@evil.test', 'http://local\nhost',
  ]) {
    for (const name of ['VITE_APP_BASE_URL', 'VITE_API_URL', 'VITE_SUPABASE_URL']) {
      assert.throws(() => validateLocalEnvironment({ ...local, [name]: value }), undefined, name);
    }
  }
  assert.doesNotThrow(() => requireLocalUrl('http://[::1]:5000/api', 'test'));
  assert.throws(() => resolveApiBaseUrl('https://api.example.test', false));
  assert.equal(resolveApiBaseUrl('https://api.example.test', true), 'https://api.example.test/api');
  assert.throws(() => validateLocalEnvironment({ ...local, VITE_OTHER_API_URL: 'https://api.example.test' }));
  assert.throws(() => validateLocalEnvironment({ ...local, VITE_SERVICE_ROLE_KEY: 'never-expose' }));
});

test('mode loader ignores legacy files and never expands shell or legacy values', () => {
  const directory = mkdtempSync(resolve(frontend, 'tests/safety/.local-env-'));
  try {
    writeFileSync(resolve(directory, '.env'), 'VITE_API_URL=https://production.example.test\nVITE_LEAKED_KEY=must-not-leak\n');
    writeFileSync(resolve(directory, '.env.local'), 'VITE_API_URL=https://other.example.test\n');
    writeFileSync(resolve(directory, '.env.production'), 'VITE_API_URL=https://production.example.test\n');
    writeFileSync(resolve(directory, '.env.development'), Object.entries(local).map(([key, value]) => `${key}=${value}`).join('\n'));
    writeFileSync(resolve(directory, '.env.development.local'), 'VITE_API_URL=http://127.0.0.1:5001/api\n');
    const env = loadLocalEnvironment('development', directory, { NODE_ENV: 'production' });
    assert.equal(env.VITE_API_URL, 'http://127.0.0.1:5001/api');
    assert.equal(env.VITE_LEAKED_KEY, undefined);
    assert.throws(() => loadLocalEnvironment('development', directory, { VITE_API_URL: 'https://hosted.example.test' }), /exclusively from mode files/);
    writeFileSync(resolve(directory, '.env.development.local'), 'VITE_API_URL=${PRODUCTION_API}\n');
    assert.throws(() => loadLocalEnvironment('development', directory, { PRODUCTION_API: 'http://localhost:5000/api' }));
    assert.throws(() => loadLocalEnvironment('production', directory, {}));
    assert.throws(() => loadLocalEnvironment('../production', directory, {}));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CSP has exact local application origins and only the intentional public map exception', () => {
  const policy = localContentSecurityPolicy(local);
  assert.match(policy, /connect-src 'self' http:\/\/localhost:5173 http:\/\/localhost:5000 http:\/\/127\.0\.0\.1:54321/);
  assert.match(policy, /ws:\/\/localhost:5173/);
  assert.match(policy, /https:\/\/tiles\.openfreemap\.org/);
  assert.match(policy, /frame-src 'self' blob: http:\/\/localhost:5173 http:\/\/localhost:5000 http:\/\/127\.0\.0\.1:54321/);
  assert.match(policy, /object-src 'none'/);
  assert.doesNotMatch(policy, /\*|supabase\.co|fonts\.google|spline/);
  assert.doesNotThrow(() => validateLocalEnvironment({ ...local, VITE_MAP_STYLE_URL: 'http://localhost:5173/maps/style.json' }));
  assert.throws(() => validateLocalEnvironment({ ...local, VITE_MAP_STYLE_URL: 'https://production.example.test/style.json' }));
});

test('actual Vite startup rejects malicious inherited environments before opening a server', () => {
  for (const overrides of [
    { VITE_API_URL: 'https://production.example.test' },
    { NODE_ENV: 'production', VITE_SUPABASE_URL: 'https://project.supabase.co' },
    { VITE_SUPABASE_ANON_KEY: 'sb_secret_never-print-this-value' },
  ]) {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('VITE_')));
    const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'development'], {
      cwd: frontend, env: { ...clean, ...overrides }, encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exclusively from mode files/);
    assert.doesNotMatch(result.stdout + result.stderr, /sb_secret_never-print-this-value/);
  }
});

test('Vite CLI cannot serve production mode, stale preview bundles or non-loopback hosts', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('VITE_')));
  for (const [args, reason] of [
    [['--mode', 'production'], /reserved for deployment builds/],
    [['preview', '--mode', 'development'], /stale production bundle/],
    [['--host', '0.0.0.0'], /configured loopback host/],
    [['--base', 'https://production.example.test/'], /relative asset base/],
  ]) {
    const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', ...args], {
      cwd: frontend, env, encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, reason);
  }
});

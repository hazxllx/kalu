import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertLocalEnvironment, assertLocalKey, assertLocalUrl, localServiceFetch } from '../src/config/localSafety.js';

test('local service endpoints reject hosted, misleading and credential-bearing URLs', () => {
  for (const value of ['https://project.supabase.co', 'http://localhost.evil.test',
    'http://user:secret@localhost:5000', 'file:///tmp/db', 'http://0.0.0.0:5000']) {
    assert.throws(() => assertLocalUrl(value, 'API_URL'));
  }
  for (const value of ['http://localhost:5000/api', 'http://127.0.0.1:54321', 'http://[::1]:5000']) {
    assert.doesNotThrow(() => assertLocalUrl(value, 'API_URL'));
  }
});

test('database, SMTP, API overrides and external credentials fail closed', () => {
  for (const values of [{ DATABASE_URL: 'postgresql://user:secret@db.example.test/db' },
    { SMTP_HOST: 'smtp.gmail.com' }, { SMTP_PASSWORD: 'secret' }, { OPENAI_API_KEY: 'secret' },
    { TEST_SUPABASE_URL: 'https://project.supabase.co' }, { CORS_ORIGIN: 'https://app.example.test' }]) {
    assert.throws(() => assertLocalEnvironment(values));
  }
  assert.doesNotThrow(() => assertLocalEnvironment({ DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', SMTP_HOST: '127.0.0.1' }));
});

test('hosted Supabase credentials cannot be reused against a local endpoint', () => {
  const key = (payload) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
  assert.doesNotThrow(() => assertLocalKey(key({ iss: 'supabase-demo', role: 'anon' }), 'KEY'));
  for (const value of ['sb_secret_hosted', key({ iss: 'supabase', role: 'service_role', ref: 'hosted' })]) {
    assert.throws(() => assertLocalKey(value, 'KEY'));
  }
});

test('development startup rejects deployment targets without logging their credentials', () => {
  const secret = 'DO_NOT_LOG_TEST_CREDENTIAL';
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/dev.js', import.meta.url))], {
    env: { ...process.env, NODE_ENV: 'production', SUPABASE_URL: `https://user:${secret}@project.supabase.co`,
      SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SUPABASE_URL must point to a loopback service/);
  assert.equal(result.stderr.includes(secret), false);
});

test('local SDK requests keep query filters and cannot follow redirects off-host', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return new Response('{}'); });
  await localServiceFetch('http://127.0.0.1:54321/rest/v1/profiles?select=id', { method: 'GET' });
  assert.equal(calls[0].options.redirect, 'error');
  assert.throws(() => localServiceFetch('https://project.supabase.co/rest/v1/profiles'));
  assert.equal(calls.length, 1);
});

test('local email capture requires neither hosted SMTP credentials nor TLS', async () => {
  const { getEmailTransporter } = await import('../src/services/email.service.js');
  const { options } = getEmailTransporter();
  assert.equal(options.host, '127.0.0.1');
  assert.equal(options.port, 54325);
  assert.equal(options.requireTLS, false);
  assert.equal(options.ignoreTLS, true);
  assert.equal(options.auth, undefined);
});

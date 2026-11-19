import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertDevelopmentEnvironment,
  assertLocalEnvironment,
  assertLocalKey,
  assertLocalUrl,
  hostedSupabaseDevelopmentFetch,
  localServiceFetch,
} from '../src/config/localSafety.js';

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

test('hosted development requires explicit mode and matching project keys', () => {
  const projectRef = 'abcdefghijklmnopqrst';
  const key = (payload) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
  const values = {
    SUPABASE_MODE: 'hosted-development',
    SUPABASE_URL: `https://${projectRef}.supabase.co`,
    SUPABASE_ANON_KEY: key({ iss: 'supabase', role: 'anon', ref: projectRef }),
    SUPABASE_SERVICE_ROLE_KEY: key({ iss: 'supabase', role: 'service_role', ref: projectRef }),
    CLIENT_URL: 'http://localhost:5173',
    SMTP_HOST: '127.0.0.1',
  };
  assert.doesNotThrow(() => assertDevelopmentEnvironment(values));
  assert.doesNotThrow(() => assertDevelopmentEnvironment({
    ...values,
    SUPABASE_ANON_KEY: 'sb_publishable_development',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_development',
  }));
  const remoteSmtp = {
    ...values,
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '2525',
    SMTP_USER: 'dev-user',
    SMTP_PASSWORD: 'dev-password',
  };
  assert.doesNotThrow(() => assertDevelopmentEnvironment(remoteSmtp));
  assert.throws(() => assertDevelopmentEnvironment({ ...remoteSmtp, SMTP_PASSWORD: '' }), /requires SMTP_USER and SMTP_PASSWORD/);
  assert.throws(() => assertDevelopmentEnvironment({ ...remoteSmtp, SMTP_PORT: '70000' }), /valid port/);
  assert.throws(() => assertDevelopmentEnvironment({ ...remoteSmtp, SMTP_HOST: 'smtp.example.test:2525' }), /hostname without credentials/);
  assert.throws(() => assertDevelopmentEnvironment({ ...values, SUPABASE_MODE: 'local' }), /loopback service/);
  assert.throws(() => assertDevelopmentEnvironment({
    ...values, SUPABASE_SERVICE_ROLE_KEY: key({ iss: 'supabase', role: 'service_role', ref: 'other-project' }),
  }), /does not match/);
  assert.throws(() => assertDevelopmentEnvironment({
    ...values, DATABASE_URL: 'postgresql://db.example.test/app',
  }), /loopback service/);
  assert.throws(() => assertDevelopmentEnvironment({
    ...values, SUPABASE_URL: 'http://project.supabase.co',
  }), /HTTPS Supabase project URL/);
});

test('development startup rejects deployment targets without logging their credentials', () => {
  const secret = 'DO_NOT_LOG_TEST_CREDENTIAL';
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/dev.js', import.meta.url))], {
    env: { ...process.env, NODE_ENV: 'production', SUPABASE_URL: `https://user:${secret}@project.supabase.co`,
      SUPABASE_MODE: 'local', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SUPABASE_URL must point to a loopback service/);
  assert.equal(result.stderr.includes(secret), false);
});

test('hosted development fetch is restricted to the configured project and does not follow redirects', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return new Response('{}');
  });
  const request = hostedSupabaseDevelopmentFetch('https://project.supabase.co');
  await request('https://project.supabase.co/rest/v1/profiles?select=id');
  assert.equal(calls[0].options.redirect, 'error');
  assert.throws(() => request('https://other-project.supabase.co/rest/v1/profiles'), /configured project origin/);
  assert.equal(calls.length, 1);
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
  const localValues = {
    NODE_ENV: 'test',
    SUPABASE_MODE: 'local',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '54325',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    CLIENT_URL: 'http://localhost:5173',
    CORS_ORIGIN: '',
  };
  const previous = Object.fromEntries(Object.keys(localValues).map((name) => [name, process.env[name]]));
  Object.assign(process.env, localValues);
  try {
    const { getEmailTransporter } = await import('../src/services/email.service.js');
    const { options } = getEmailTransporter();
    assert.equal(options.host, '127.0.0.1');
    assert.equal(options.port, 54325);
    assert.equal(options.requireTLS, false);
    assert.equal(options.ignoreTLS, true);
    assert.equal(options.auth, undefined);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('hosted-development SMTP requires authentication and mandatory TLS', () => {
  const projectRef = 'abcdefghijklmnopqrst';
  const key = (payload) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
  const script = `
    const { getEmailTransporter } = await import(${JSON.stringify(
      new URL('../src/services/email.service.js', import.meta.url).href,
    )});
    const { secure, requireTLS, ignoreTLS, auth } = getEmailTransporter().options;
    console.log(JSON.stringify({ secure, requireTLS, ignoreTLS, hasAuth: Boolean(auth) }));
  `;
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => ![
    'NODE_ENV', 'SUPABASE_MODE', 'SUPABASE_URL', 'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'SMTP_HOST', 'SMTP_PORT',
    'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'OTP_PEPPER',
  ].includes(name)));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...cleanEnv,
      NODE_ENV: 'development',
      SUPABASE_MODE: 'hosted-development',
      SUPABASE_URL: `https://${projectRef}.supabase.co`,
      SUPABASE_ANON_KEY: key({ iss: 'supabase', role: 'anon', ref: projectRef }),
      SUPABASE_SERVICE_ROLE_KEY: key({ iss: 'supabase', role: 'service_role', ref: projectRef }),
      DATABASE_URL: '',
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '2525',
      SMTP_USER: 'dev-user',
      SMTP_PASSWORD: 'dev-password',
      SMTP_FROM: 'noreply@example.test',
      OTP_PEPPER: 'test-pepper',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    secure: false,
    requireTLS: true,
    ignoreTLS: false,
    hasAuth: true,
  });
});

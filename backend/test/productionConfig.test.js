import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const envModule = fileURLToPath(new URL('../src/config/env.js', import.meta.url));

const loadEnv = (variables) => spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `import(${JSON.stringify(pathToFileURL(envModule).href)}).then(({ default: env }) => console.log(JSON.stringify({ clientUrl: env.clientUrl, clientUrls: env.clientUrls })))`,
  ],
  {
    env: {
      ...process.env,
      SUPABASE_MODE: 'local',
      SMTP_HOST: '127.0.0.1',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      ...variables,
    },
    encoding: 'utf8',
  },
);

test('production fails fast when required configuration is missing', () => {
  const result = loadEnv({
    NODE_ENV: 'production',
    CLIENT_URL: '',
    CORS_ORIGIN: '',
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Production configuration is incomplete/);
  assert.match(result.stderr, /CLIENT_URL/);
  assert.match(result.stderr, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('development allows both localhost and 127.0.0.1 frontend origins', () => {
  const result = loadEnv({
    NODE_ENV: 'development',
    CLIENT_URL: 'http://localhost:5173',
    CORS_ORIGIN: '',
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    clientUrl: 'http://localhost:5173',
    clientUrls: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  });
});

test('hosted development allows only matching Supabase project credentials with explicit mode', () => {
  const projectRef = 'abcdefghijklmnopqrst';
  const key = (payload) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
  const result = loadEnv({
    NODE_ENV: 'development',
    SUPABASE_MODE: 'hosted-development',
    CLIENT_URL: 'http://localhost:5173',
    CORS_ORIGIN: '',
    SUPABASE_URL: `https://${projectRef}.supabase.co`,
    SUPABASE_ANON_KEY: key({ iss: 'supabase', role: 'anon', ref: projectRef }),
    SUPABASE_SERVICE_ROLE_KEY: key({ iss: 'supabase', role: 'service_role', ref: projectRef }),
    DATABASE_URL: '',
    SMTP_HOST: '127.0.0.1',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    clientUrl: 'http://localhost:5173',
    clientUrls: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  });
});

test('production normalizes the canonical HTTPS URL and keeps extra CORS origins separate', () => {
  const result = loadEnv({
    NODE_ENV: 'production',
    CLIENT_URL: 'https://kalusagap.vercel.app/',
    CORS_ORIGIN: 'https://preview.example.test',
    SUPABASE_URL: 'https://project.example.test',
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    clientUrl: 'https://kalusagap.vercel.app',
    clientUrls: ['https://kalusagap.vercel.app', 'https://preview.example.test'],
  });
});

test('production requires CLIENT_URL even when CORS_ORIGIN is configured', () => {
  const result = loadEnv({
    NODE_ENV: 'production',
    CLIENT_URL: '',
    CORS_ORIGIN: 'https://app.example.test',
    SUPABASE_URL: 'https://project.example.test',
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CLIENT_URL/);
});

test('production rejects insecure and loopback canonical frontend URLs', () => {
  for (const CLIENT_URL of [
    'http://kalusagap.vercel.app',
    'https://localhost:5173',
    'https://127.0.0.1:5173',
    'https://[::1]:5173',
    'https://[::ffff:7f00:1]',
  ]) {
    const result = loadEnv({
      NODE_ENV: 'production', CLIENT_URL, CORS_ORIGIN: 'https://kalusagap.vercel.app',
      SUPABASE_URL: 'https://project.example.test',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    });
    assert.notEqual(result.status, 0, CLIENT_URL);
    assert.match(result.stderr, /Production CLIENT_URL must use HTTPS/);
  }
});

test('origin configuration rejects paths, credentials, and non-http protocols', () => {
  for (const CLIENT_URL of [
    'https://app.example.test/path',
    'https://user:secret@app.example.test',
    'file:///tmp/app',
  ]) {
    const result = loadEnv({
      NODE_ENV: 'development',
      CLIENT_URL,
      CORS_ORIGIN: '',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CLIENT_URL must/);
  }
});

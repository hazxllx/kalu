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
    `import(${JSON.stringify(pathToFileURL(envModule).href)}).then(({ default: env }) => console.log(JSON.stringify(env.clientUrls)))`,
  ],
  { env: { ...process.env, ...variables }, encoding: 'utf8' },
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
  assert.match(result.stderr, /CLIENT_URL or CORS_ORIGIN/);
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
  assert.deepEqual(JSON.parse(result.stdout.trim()), [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
});

test('production accepts CLIENT_URL alone and does not add development origins', () => {
  const result = loadEnv({
    NODE_ENV: 'production',
    CLIENT_URL: 'https://app.example.test',
    CORS_ORIGIN: '',
    SUPABASE_URL: 'https://project.example.test',
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), ['https://app.example.test']);
});

test('production accepts CORS_ORIGIN as the documented fallback alias', () => {
  const result = loadEnv({
    NODE_ENV: 'production',
    CLIENT_URL: '',
    CORS_ORIGIN: 'https://app.example.test',
    SUPABASE_URL: 'https://project.example.test',
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), ['https://app.example.test']);
});

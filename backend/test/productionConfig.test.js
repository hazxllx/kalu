import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const envModule = fileURLToPath(new URL('../src/config/env.js', import.meta.url));

const loadEnv = (variables) => spawnSync(
  process.execPath,
  ['--input-type=module', '-e', `import(${JSON.stringify(pathToFileURL(envModule).href)})`],
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
  assert.match(result.stderr, /CLIENT_URL/);
  assert.match(result.stderr, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('development retains localhost defaults', () => {
  const result = loadEnv({
    NODE_ENV: 'development',
    CLIENT_URL: '',
    CORS_ORIGIN: '',
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  });
  assert.equal(result.status, 0, result.stderr);
});

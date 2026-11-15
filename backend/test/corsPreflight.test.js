import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

process.env.NODE_ENV = 'development';
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.CORS_ORIGIN = '';

const { default: app } = await import('../src/app.js');

for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
test(`the permission endpoint preflight allows ${origin}`, async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/roles/permissions`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key,if-match',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.match(response.headers.get('access-control-allow-headers') || '', /authorization/i);
  assert.match(response.headers.get('access-control-allow-headers') || '', /idempotency-key/i);
  assert.match(response.headers.get('access-control-allow-methods') || '', /post/i);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
});
}

test('the permission endpoint remains protected after CORS succeeds', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/roles/permissions`, {
    headers: { Origin: 'http://127.0.0.1:5173' },
  });

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
});

test('an untrusted origin receives no allow-origin header', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/roles/permissions`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://attacker.example',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization',
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

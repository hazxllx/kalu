import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { authEmailRedirectTo } from '../../src/lib/authEmailRedirect.js';

test('auth email callbacks follow the active local or deployed frontend origin', () => {
  assert.equal(authEmailRedirectTo('/', 'http://localhost:5173', false), 'http://localhost:5173/');
  assert.equal(authEmailRedirectTo('/reset-password', 'https://kalusagap.vercel.app', true), 'https://kalusagap.vercel.app/reset-password');
});

test('production callbacks reject localhost and non-HTTPS origins', () => {
  assert.throws(() => authEmailRedirectTo('/', 'http://kalusagap.vercel.app', true), /require the public HTTPS frontend/);
  assert.throws(() => authEmailRedirectTo('/', 'https://localhost:5173', true), /require the public HTTPS frontend/);
});

test('resident signup and resend explicitly pass an app-owned email callback', async () => {
  const activation = await readFile(new URL('../../src/features/registration/pages/ExistingResidentActivation.jsx', import.meta.url), 'utf8');
  const registration = await readFile(new URL('../../src/features/registration/pages/NewResidentRegistration.jsx', import.meta.url), 'utf8');
  assert.match(activation, /resend\(\{[\s\S]*?emailRedirectTo: authEmailRedirectTo\("\/"\)/);
  assert.match(activation, /signUp\(\{[\s\S]*?emailRedirectTo: authEmailRedirectTo\("\/"\)/);
  assert.match(registration, /resend\(\{[\s\S]*?emailRedirectTo: authEmailRedirectTo\("\/"\)/);
  assert.match(registration, /emailRedirectTo: authEmailRedirectTo\("\/"\)/);
});

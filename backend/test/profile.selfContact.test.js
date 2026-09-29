import test from 'node:test';
import assert from 'node:assert/strict';

import { updateOwnContact } from '../src/services/profile.service.js';

/**
 * Self-service contact-number update (staff + resident share this endpoint via
 * PATCH /api/auth/me). These cover the guard branches that run BEFORE any
 * database call — identity is taken from the verified session, and an invalid
 * PH mobile number is rejected — so they need no Supabase connection.
 */

test('rejects when there is no authenticated user (401)', async () => {
  await assert.rejects(
    () => updateOwnContact({ user: null, contact: '09171234567' }),
    (err) => err.statusCode === 401,
  );
});

test('rejects an invalid PH mobile number (400) before touching the database', async () => {
  await assert.rejects(
    () => updateOwnContact({ user: { id: 'auth-1' }, contact: '12345' }),
    (err) => err.statusCode === 400,
  );
});

test('rejects a number with letters (400)', async () => {
  await assert.rejects(
    () => updateOwnContact({ user: { id: 'auth-1' }, contact: '0917abc4567' }),
    (err) => err.statusCode === 400,
  );
});

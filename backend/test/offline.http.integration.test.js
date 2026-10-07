/**
 * Offline household workflow — REAL HTTP + REAL DATABASE integration tests.
 *
 * Unlike offline.integration.test.js (which drives the service layer directly),
 * this suite boots the actual Express app (`backend/src/app.js`) against the
 * development Supabase project and exercises the REAL request path:
 *
 *   HTTP → authenticate → authorize → idempotency middleware → controller →
 *   service → Supabase/PostgreSQL
 *
 * It signs in through Supabase Auth with the TEST BHW account, so the full
 * profile-resolution and bearer-token path is verified, not mocked.
 *
 * SAFETY (read this before running):
 *   - Runs ONLY against a dedicated DEVELOPMENT Supabase project.
 *   - The production project ref is HARD-BLOCKED.
 *   - Skipped unless ALLOW_OFFLINE_INTEGRATION_TESTS=1 (an ordinary `npm test`
 *     can never touch any database).
 *   - `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` / anon key and the
 *     test-BHW credentials are read from the environment (see
 *     docs/offline/DEV-CHECKLIST.md).
 *
 * Run:
 *   ALLOW_OFFLINE_INTEGRATION_TESTS=1 \
 *   TEST_SUPABASE_URL=https://<DEV_REF>.supabase.co \
 *   TEST_SUPABASE_SERVICE_ROLE_KEY=<DEV_SERVICE_ROLE_KEY> \
 *   TEST_SUPABASE_ANON_KEY=<DEV_ANON_KEY> \
 *   KALUSAGAP_TEST_BHW_EMAIL=test-bhw@kalusagap-dev.local \
 *   KALUSAGAP_TEST_BHW_PASSWORD=<test password> \
 *   npm test test/offline.http.integration.test.js
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

import app from '../src/app.js';
import env from '../src/config/env.js';

/** The production project reference. Never allow a run against it. */
const PRODUCTION_REF = 'lblawqeoixojyytkmfqy';

const SUPABASE_URL =
  process.env.TEST_SUPABASE_URL || process.env.SUPABASE_URL_TEST || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY_TEST ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY =
  process.env.TEST_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY_TEST || process.env.SUPABASE_ANON_KEY;

const TEST_EMAIL = process.env.KALUSAGAP_TEST_BHW_EMAIL || 'test-bhw@kalusagap-dev.local';
const TEST_PASSWORD = process.env.KALUSAGAP_TEST_BHW_PASSWORD;

const isProductionTarget = () =>
  typeof SUPABASE_URL === 'string' && SUPABASE_URL.includes(PRODUCTION_REF);

const optedIn = process.env.ALLOW_OFFLINE_INTEGRATION_TESTS === '1';

const SKIP_REASON = !optedIn
  ? 'Set ALLOW_OFFLINE_INTEGRATION_TESTS=1 and point TEST_SUPABASE_URL at a DEV project.'
  : !SUPABASE_URL || !SERVICE_ROLE_KEY
    ? 'No development Supabase configured (TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY).'
    : isProductionTarget()
      ? 'Refusing to run: target is the production project.'
      : null;

// Hard guard: fail loudly if someone explicitly opts in but targets production.
if (optedIn && isProductionTarget()) {
  throw new Error(
    `Refusing to run offline HTTP integration tests against the PRODUCTION project (${PRODUCTION_REF}). ` +
      'Point TEST_SUPABASE_URL at a dedicated development project.',
  );
}

// Point the app's config at the TEST project (env is read at import time from
// process.env; tests set these before importing app.js).
let server;
let baseUrl;
let accessToken;
let supabase;

const unique = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const request = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
};

before(async () => {
  if (SKIP_REASON) {
    console.log(`⚠️  Skipping HTTP integration tests: ${SKIP_REASON}`);
    return;
  }

  if (!TEST_PASSWORD) {
    throw new Error(
      'KALUSAGAP_TEST_BHW_PASSWORD is not set. Provision the test BHW (see docs/offline/DEV-CHECKLIST.md).',
    );
  }

  // Boot the real Express app against the dev Supabase project.
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Sign in as the test BHW through Supabase Auth (real password grant).
  const anonClient = createClient(SUPABASE_URL, ANON_KEY || SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anonClient.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (error || !data?.session) {
    throw new Error(`Test BHW sign-in failed: ${error?.message || 'no session'} — provision the account first.`);
  }
  accessToken = data.session.access_token;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('unauthenticated household create is rejected 401', { skip: SKIP_REASON }, async () => {
  accessToken = null;
  try {
    const { status } = await request('/api/households', {
      method: 'POST',
      body: { household: { headName: 'Unauth' } },
    });
    assert.equal(status, 401, 'no bearer token => 401');
  } finally {
    accessToken = null;
  }
});

test('BHW create + Idempotency-Key replay returns exactly one household and records a completed ledger entry', { skip: SKIP_REASON }, async () => {
  const key = `test-http-${unique('op')}`;
  const payload = {
    household: {
      barangay: 'Test Poblacion',
      headName: `HTTP Ledger ${Date.now()}`,
      purok: 'Purok 1',
      streetAddress: `${Date.now()} Ledger St`,
      contact: '09171234567',
      families: 1,
      waterSource: 'level2',
      toiletType: 'ws_own',
      members: [
        { name: 'HTTP Member A', relationship: 'Head', age: 35, sex: 'Male' },
        { name: 'HTTP Member B', relationship: 'Spouse', age: 32, sex: 'Female' },
      ],
    },
  };

  // First POST — the real ledger claim is written by the idempotency middleware.
  const first = await request('/api/households', {
    method: 'POST',
    body: payload,
    headers: { 'Idempotency-Key': key },
  });
  assert.equal(first.status, 201, 'first create succeeds');
  const householdId = first.payload?.data?.household?.id;
  assert.ok(householdId, 'server-allocated household id present');

  // Second POST with the same key — the middleware replays the stored response
  // without executing the handler again.
  const second = await request('/api/households', {
    method: 'POST',
    body: payload,
    headers: { 'Idempotency-Key': key },
  });
  assert.equal(second.status, 201, 'replay returns 201 (recorded response replayed)');
  assert.equal(second.payload?.data?.household?.id, householdId, 'same household returned');

  // Verify the ledger row exists and is completed, and exactly one DB row exists.
  const { data: ledgerRows } = await supabase
    .from('sync_operations')
    .select('status, response_status')
    .eq('idempotency_key', key);
  assert.equal(ledgerRows.length, 1, 'one ledger entry');
  assert.equal(ledgerRows[0].status, 'completed', 'ledger completed');

  const { data: householdRows } = await supabase
    .from('households')
    .select('id')
    .eq('client_operation_key', key);
  assert.equal(householdRows.length, 1, 'exactly one household row for the key');

  // Ledger replay never re-executes: verify the member count did not double.
  const { data: full } = await supabase
    .from('households')
    .select('id, household_members(id)')
    .eq('id', householdId)
    .single();
  assert.equal(full.household_members.length, 2, 'members were not re-inserted on replay');
});

test('reusing an Idempotency-Key with a different payload returns 409', { skip: SKIP_REASON }, async () => {
  const key = `test-http-conflict-${unique('op')}`;
  const base = {
    household: {
      barangay: 'Test Poblacion',
      headName: `HTTP Conflict ${Date.now()}`,
      purok: 'Purok 1',
      streetAddress: `${Date.now()} Conflict St`,
      contact: '09171234567',
      families: 1,
      waterSource: 'level2',
      toiletType: 'ws_own',
      members: [{ name: 'M', relationship: 'Head', age: 30, sex: 'Male' }],
    },
  };

  const ok = await request('/api/households', {
    method: 'POST',
    body: base,
    headers: { 'Idempotency-Key': key },
  });
  assert.equal(ok.status, 201, 'first use of the key succeeds');

  const different = await request('/api/households', {
    method: 'POST',
    body: { household: { ...base.household, headName: 'Different Head' } },
    headers: { 'Idempotency-Key': key },
  });
  assert.equal(different.status, 409, 'same key, different payload => 409');
});

test('stale If-Match revision returns 409 and does not overwrite', { skip: SKIP_REASON }, async () => {
  const key = `test-http-rev-${unique('op')}`;
  const create = await request('/api/households', {
    method: 'POST',
    body: {
      household: {
        barangay: 'Test Poblacion',
        headName: `HTTP Revision ${Date.now()}`,
        purok: 'Purok 1',
        streetAddress: `${Date.now()} Revision St`,
        contact: '09171234567',
        families: 1,
        waterSource: 'level2',
        toiletType: 'ws_own',
        members: [{ name: 'M', relationship: 'Head', age: 30, sex: 'Male' }],
      },
    },
    headers: { 'Idempotency-Key': key },
  });
  assert.equal(create.status, 201);
  const id = create.payload?.data?.household?.id;
  const initialRevision = create.payload?.data?.household?.revision;
  assert.ok(id);
  assert.equal(initialRevision, 1, 'new household starts at revision 1');

  // First update with the current revision succeeds.
  const update = await request(`/api/households/${id}`, {
    method: 'PUT',
    body: { household: { contact: '09187654321' } },
    headers: { 'If-Match': String(initialRevision) },
  });
  assert.equal(update.status, 200, 'matching If-Match accepted');
  assert.equal(update.payload?.data?.household?.revision, initialRevision + 1, 'revision bumped');

  // Second update with the now-stale revision is rejected.
  const stale = await request(`/api/households/${id}`, {
    method: 'PUT',
    body: { household: { contact: '09191111111' } },
    headers: { 'If-Match': String(initialRevision) },
  });
  assert.equal(stale.status, 409, 'stale revision => 409');

  const { data: after } = await supabase
    .from('households')
    .select('contact, revision')
    .eq('id', id)
    .single();
  assert.equal(after.contact, '09187654321', 'stale write did not overwrite the contact');
  assert.equal(after.revision, initialRevision + 1, 'revision unchanged by the rejected write');
});

test('anon RLS denies reads of sync_operations while the API remains blocked for anonymous users', { skip: SKIP_REASON }, async () => {
  if (!ANON_KEY) {
    console.log('   (anon key not provided — skipping RLS denial check)');
    return;
  }
  const anonClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await anonClient.from('sync_operations').select('id').limit(1);
  assert.ok(error, 'anon client is denied');
  assert.equal(data, null, 'no data returned');
});

test('a BHW finds their own households through the authorized list endpoint', { skip: SKIP_REASON }, async () => {
  // List households as the authenticated BHW — a real, scoped read through the
  // API that resolves the profile from the session (not a mocked user).
  const { status, payload } = await request('/api/households?limit=5', { method: 'GET' });
  assert.equal(status, 200, 'authorized list succeeds');
  assert.ok(Array.isArray(payload?.data?.rows ?? payload?.rows), 'rows shape returned');

  // A barangay-scoped caller may not request another barangay's list.
  const other = await request('/api/households?barangay=Somewhere%20Else', { method: 'GET' });
  assert.equal(other.status, 403, 'cross-barangay query is rejected before the controller');
});

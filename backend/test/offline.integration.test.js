/**
 * Offline household workflow — REAL DATABASE integration tests.
 *
 * These tests require an actual PostgreSQL database with the offline migration
 * applied. They verify atomic household+members creation, idempotency, revision
 * conflicts, and authorization against the real Supabase/PostgREST stack.
 *
 * SAFETY (read this before running):
 *   - These tests MUST run against a dedicated DEVELOPMENT Supabase project.
 *   - They NEVER run against production. `PRODUCTION_REF` below is hard-blocked.
 *   - They are skipped unless you opt in with ALLOW_OFFLINE_INTEGRATION_TESTS=1,
 *     so an ordinary `npm test` can never touch any database.
 *   - Configuration is read from *_TEST/TEST_* variables first; the app's
 *     `SUPABASE_URL` is only used as a fallback and is checked against the
 *     production ref.
 *
 * Prerequisites:
 *   - Development Supabase project with migrations applied (supabase db push).
 *   - Test municipality, barangay, and BHW profile seeded (see DEV-SETUP.md).
 *
 * Run:
 *   ALLOW_OFFLINE_INTEGRATION_TESTS=1 \
 *   TEST_SUPABASE_URL=https://<DEV_REF>.supabase.co \
 *   TEST_SUPABASE_SERVICE_ROLE_KEY=<DEV_SERVICE_ROLE_KEY> \
 *   TEST_SUPABASE_ANON_KEY=<DEV_ANON_KEY> \
 *   npm test test/offline.integration.test.js
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createHousehold, updateHousehold } from '../src/services/households.service.js';
import repository from '../src/repositories/index.js';

/** The production project reference. Never allow integration runs against it. */
const PRODUCTION_REF = 'lblawqeoixojyytkmfqy';

const SUPABASE_URL =
  process.env.TEST_SUPABASE_URL || process.env.SUPABASE_URL_TEST || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY_TEST ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const isProductionTarget = () =>
  typeof SUPABASE_URL === 'string' && SUPABASE_URL.includes(PRODUCTION_REF);

const optedIn = process.env.ALLOW_OFFLINE_INTEGRATION_TESTS === '1';

// Skip (not pass) unless explicitly opted in AND a non-production target exists.
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
    `Refusing to run offline integration tests against the PRODUCTION project (${PRODUCTION_REF}). ` +
      'Point TEST_SUPABASE_URL at a dedicated development project.',
  );
}

let supabase;
let testMunicipalityId;
let testBarangayId;
let testUserId;

// Test fixtures (minimal valid household). The database CHECK constraints on
// `household_members` are: sex IN ('', 'Male', 'Female') and name NOT NULL, so
// member rows must carry a valid sex and a name. The household id is a TEXT pk;
// `headName` is free text (there is no separate `name` column on households).
const makeTestHousehold = (suffix = '') => ({
  barangay: 'Test Poblacion',
  headName: `Integration Test ${suffix}`,
  purok: 'Test Purok',
  streetAddress: `${Date.now()} Test St`,
  contact: '09171234567',
  families: 1,
  waterSource: 'level2',
  toiletType: 'ws_own',
  members: [
    { name: `Member A ${suffix}`, relationship: 'Head', age: 35, sex: 'Male' },
    { name: `Member B ${suffix}`, relationship: 'Spouse', age: 32, sex: 'Female' },
  ],
});

/** Unique household TEXT id per run so parallel/CI runs cannot collide. */
const uniqueHouseholdId = (prefix = 'IT') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const testUser = {
  id: null, // set in before()
  role: 'bhw',
  barangay: 'Test Poblacion',
  status: 'active',
};

before(async () => {
  if (SKIP_REASON) {
    console.log(`⚠️  Skipping integration tests: ${SKIP_REASON}`);
    console.log('   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run.');
    return;
  }

  supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Verify migration applied: sync_operations table must exist.
  const { error: syncOpsError } = await supabase
    .from('sync_operations')
    .select('id')
    .limit(1);

  if (syncOpsError) {
    throw new Error(
      `sync_operations table not found or not accessible. Apply migration first: supabase db push  (error: ${syncOpsError.message})`,
    );
  }

  // Find or create test municipality/barangay
  const { data: muni } = await supabase
    .from('municipalities')
    .select('id')
    .eq('name', 'Taguig Test')
    .maybeSingle();

  if (!muni) {
    throw new Error(
      'Test municipality not found. Seed development data (see docs/offline/DEV-SETUP.md).',
    );
  }
  testMunicipalityId = muni.id;

  const { data: brgy } = await supabase
    .from('barangays')
    .select('id')
    .eq('municipality_id', testMunicipalityId)
    .eq('name', 'Test Poblacion')
    .maybeSingle();

  if (!brgy) {
    throw new Error('Test barangay not found. Seed development data.');
  }
  testBarangayId = brgy.id;

  // Find test BHW user
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'bhw')
    .eq('barangay_id', testBarangayId)
    .maybeSingle();

  if (!profile) {
    throw new Error('Test BHW profile not found. Create test user (see DEV-SETUP.md).');
  }
  testUserId = profile.id;
  testUser.id = testUserId;

  console.log('✓ Integration test prerequisites met:');
  console.log(`  Municipality: ${testMunicipalityId}`);
  console.log(`  Barangay: ${testBarangayId}`);
  console.log(`  BHW User: ${testUserId}`);
});

after(async () => {
  if (supabase) {
    // Optional: Clean up test data
    // await supabase.from('households').delete().ilike('head_name', 'Integration Test%');
  }
});

test('atomic create inserts household and all members in one transaction', { skip: SKIP_REASON }, async () => {
  const payload = makeTestHousehold('Atomic');
  const idempotencyKey = `test-atomic-${Date.now()}`;

  const household = await createHousehold({ user: testUser, payload, idempotencyKey, repo: repository });

  assert.ok(household.id, 'household has an ID');
  assert.equal(household.members.length, 2, 'both members were inserted');
  assert.equal(household.clientOperationKey, idempotencyKey, 'operation key stored');

  // Verify in database
  const { data: dbHousehold, error } = await supabase
    .from('households')
    .select('id, head_name, client_operation_key, household_members(id, name)')
    .eq('id', household.id)
    .single();

  assert.ifError(error);
  assert.equal(dbHousehold.household_members.length, 2, 'members persisted');
  assert.equal(dbHousehold.client_operation_key, idempotencyKey);
});

test('retrying the same operation returns the existing household (exactly one row)', { skip: SKIP_REASON }, async () => {
  const payload = makeTestHousehold('Dedup');
  const idempotencyKey = `test-dedup-${Date.now()}`;

  const first = await createHousehold({ user: testUser, payload, idempotencyKey, repo: repository });
  const second = await createHousehold({ user: testUser, payload, idempotencyKey, repo: repository });

  assert.equal(first.id, second.id, 'same household returned');

  // Verify exactly one row in database
  const { data: rows, error } = await supabase
    .from('households')
    .select('id')
    .eq('client_operation_key', idempotencyKey);

  assert.ifError(error);
  assert.equal(rows.length, 1, 'exactly one household row exists');
});

test('reusing an idempotency key with a different payload returns 409', { skip: SKIP_REASON }, async () => {
  const payload1 = makeTestHousehold('Conflict1');
  const idempotencyKey = `test-conflict-${Date.now()}`;

  await createHousehold({ user: testUser, payload: payload1, idempotencyKey, repo: repository });

  const payload2 = { ...payload1, headName: 'Different Head Name' };

  await assert.rejects(
    async () => createHousehold({ user: testUser, payload: payload2, idempotencyKey, repo: repository }),
    (err) => err.statusCode === 409,
    'different payload with same key should return 409',
  );
});

test('concurrent revision updates cannot silently overwrite (conditional update)', { skip: SKIP_REASON }, async () => {
  const payload = makeTestHousehold('Revision');
  const household = await createHousehold({ user: testUser, payload, repo: repository });

  // Simulate concurrent edits with stale revision
  const patch = { contact: '09187654321' };
  const currentRevision = household.revision;

  // First update succeeds
  const updated = await updateHousehold({
    id: household.id,
    user: testUser,
    patch,
    expectedRevision: currentRevision,
    repo: repository,
  });

  assert.equal(updated.revision, currentRevision + 1, 'revision incremented');

  // Second update with stale revision fails
  await assert.rejects(
    async () =>
      updateHousehold({
        id: household.id,
        user: testUser,
        patch: { contact: '09191111111' },
        expectedRevision: currentRevision, // stale
        repo: repository,
      }),
    (err) => err.statusCode === 409,
    'stale revision update should return 409',
  );
});

test('unauthorized user outside their barangay is denied (scope enforcement)', { skip: SKIP_REASON }, async () => {
  const payload = makeTestHousehold('Scope');
  const household = await createHousehold({ user: testUser, payload, repo: repository });

  // Different barangay user
  const outsideUser = {
    ...testUser,
    barangay: 'Different Barangay',
    barangayId: '99999999-9999-9999-9999-999999999999',
  };

  await assert.rejects(
    async () => updateHousehold({
      id: household.id,
      user: outsideUser,
      patch: { contact: '09199999999' },
      repo: repository,
    }),
    (err) => err.statusCode === 403 || err.statusCode === 404,
    'out-of-scope user should be denied',
  );
});

test('RLS denies anon/authenticated access to sync_operations', { skip: SKIP_REASON }, async (t) => {
  // Create anon client
  const anonKey = process.env.TEST_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!anonKey) {
    t.skip('TEST_SUPABASE_ANON_KEY not set — RLS denial not verified.');
    return;
  }

  const anonClient = createClient(SUPABASE_URL, anonKey);

  const { data, error } = await anonClient.from('sync_operations').select('id').limit(1);

  assert.ok(error, 'anon client should be denied');
  assert.ok(
    error.message.includes('policy') || error.code === 'PGRST301',
    'RLS policy denial',
  );
  assert.equal(data, null, 'no data returned');
});

test('create_household_with_members function exists and is callable', { skip: SKIP_REASON }, async () => {
  const householdRow = {
    id: uniqueHouseholdId('RPC'),
    municipality_id: testMunicipalityId,
    barangay_id: testBarangayId,
    head_name: 'RPC Test',
    purok: 'P1',
    street_address: 'S1',
    contact: '09171234567',
    families: 1,
    water_source: 'level2',
    toilet_type: 'ws_own',
    created_by: testUserId,
    client_operation_key: `test-rpc-${Date.now()}`,
  };

  const memberRows = [
    { name: 'RPC Member', relationship: 'Head', age: 40, sex: 'Male' },
  ];

  const { data, error } = await supabase.rpc('create_household_with_members', {
    p_household: householdRow,
    p_members: memberRows,
    p_client_operation_key: householdRow.client_operation_key,
  });

  assert.ifError(error, 'RPC call should succeed');
  assert.ok(data, 'RPC should return data');

  const result = Array.isArray(data) ? data[0] : data;
  assert.ok(result.household, 'result contains household');
  assert.equal(result.deduplicated, false, 'first insert is not deduplicated');

  // Verify household exists
  const { data: dbRow } = await supabase
    .from('households')
    .select('id')
    .eq('id', householdRow.id)
    .single();

  assert.ok(dbRow, 'household persisted');
});

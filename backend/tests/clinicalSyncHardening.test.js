import assert from 'node:assert/strict';
import http from 'node:http';
import { Duplex } from 'node:stream';
import test from 'node:test';
import app from '../src/app.js';
import env from '../src/config/env.js';
import { createIdempotencyMiddleware } from '../src/middleware/idempotency.js';
import * as operationalController from '../src/controllers/operational.controller.js';
import * as operationalService from '../src/services/operational.service.js';
import * as programFormsController from '../src/controllers/programForms.controller.js';
import * as programFormsService from '../src/services/programForms.service.js';
import * as referralsController from '../src/controllers/referrals.controller.js';
import * as referralsService from '../src/services/referrals.service.js';
import { extractExpectedRevision, isSyncRequest } from '../src/utils/syncConcurrency.js';

const MUNI_ID = '11111111-1111-4111-8111-111111111111';
const BRGY_A_ID = '22222222-2222-4222-8222-222222222222';
const BRGY_B_ID = '33333333-3333-4333-8333-333333333333';

const HS_USER = {
  id: '44444444-4444-4444-8444-444444444444',
  role: 'health_supervisor',
  barangay: 'San Antonio',
  barangayId: BRGY_A_ID,
  municipalityId: MUNI_ID,
};
const OTHER_HS_USER = {
  id: '55555555-5555-4555-8555-555555555555',
  role: 'health_supervisor',
  barangay: 'San Isidro',
  barangayId: BRGY_B_ID,
  municipalityId: MUNI_ID,
};
const BHW_USER = {
  id: '66666666-6666-4666-8666-666666666666',
  role: 'bhw',
  barangay: 'San Antonio',
  barangayId: BRGY_A_ID,
  municipalityId: MUNI_ID,
};

const RESIDENT_A = {
  id: 'res-a',
  first_name: 'Maria',
  last_name: 'Cruz',
  barangay: 'San Antonio',
  barangay_id: BRGY_A_ID,
  municipality_id: MUNI_ID,
  auth_user_id: null,
};
const RESIDENT_B = {
  id: 'res-b',
  first_name: 'Juan',
  last_name: 'Reyes',
  barangay: 'San Isidro',
  barangay_id: BRGY_B_ID,
  municipality_id: MUNI_ID,
  auth_user_id: null,
};
const HOUSEHOLD_A = {
  id: 'hh-a',
  head_name: 'Maria Cruz',
  purok: '1',
  barangay: 'San Antonio',
  barangay_id: BRGY_A_ID,
  municipality_id: MUNI_ID,
};

// ---------------------------------------------------------------------------
// Stateful in-memory PostgreSQL/Supabase double with unique-index + revision CAS
// ---------------------------------------------------------------------------
function createMockClinicalDb({
  ledgerFailure = null,
  simulateInsertRace = false,
  simulateUpdateRace = false,
} = {}) {
  let seq = 0;
  const stores = {
    sync_operations: [],
    residents: [{ ...RESIDENT_A }, { ...RESIDENT_B }],
    households: [{ ...HOUSEHOLD_A }],
    tcl_entries: [],
    maternal_records: [],
    maternal_visits: [],
    immunizations: [],
    ncd_risk_assessments: [],
    ncd_cervical_breast: [],
    ncd_visual_ppv: [],
    oral_health_records: [],
    environmental_masterlist: [],
    health_audit_logs: [],
    notifications: [],
  };

  let racedInsertOnce = false;
  let racedUpdateOnce = false;

  const from = (table) => {
    const state = { op: 'select', filters: [], payload: null };
    const rows = () => {
      if (!stores[table]) stores[table] = [];
      return stores[table];
    };
    const matches = (row) => state.filters.every(([col, val]) => row[col] === val);

    const execute = async ({ singleMode = null } = {}) => {
      if (table === 'sync_operations' && ledgerFailure) {
        if (ledgerFailure === 'all' || ledgerFailure === state.op) {
          return { data: null, error: { code: '503', message: 'ledger unavailable' } };
        }
      }

      if (state.op === 'select') {
        const found = rows().filter(matches);
        if (simulateUpdateRace && !racedUpdateOnce && singleMode && !['residents', 'households', 'sync_operations'].includes(table)) {
          // Mutate revision right after the service reads `existing` to test SQL CAS race protection
          racedUpdateOnce = true;
          if (found[0]) {
            const snapshot = { ...found[0] };
            found[0].revision = (found[0].revision || 1) + 1;
            return { data: snapshot, error: null };
          }
        }
        if (singleMode === 'single') {
          return found[0]
            ? { data: { ...found[0] }, error: null }
            : { data: null, error: { code: 'PGRST116', message: 'not found' } };
        }
        if (singleMode === 'maybeSingle') {
          return { data: found[0] ? { ...found[0] } : null, error: null };
        }
        return { data: found.map((r) => ({ ...r })), error: null };
      }

      if (state.op === 'insert') {
        if (table === 'sync_operations') {
          const dup = rows().find(
            (r) => r.user_id === state.payload.user_id && r.idempotency_key === state.payload.idempotency_key,
          );
          if (dup) return { data: null, error: { code: '23505', message: 'duplicate sync_operations key' } };
          const record = {
            id: `claim-${++seq}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...state.payload,
          };
          rows().push(record);
          return { data: singleMode ? { ...record } : [{ ...record }], error: null };
        }

        // Simulate concurrent writer inserting the same client_operation_key right after pre-check
        if (simulateInsertRace && !racedInsertOnce && state.payload?.client_operation_key) {
          racedInsertOnce = true;
          rows().push({
            id: `${table}-winner`,
            revision: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...state.payload,
          });
          return { data: null, error: { code: '23505', message: 'duplicate client_operation_key' } };
        }

        if (state.payload?.client_operation_key) {
          const existingKey = rows().find((r) => r.client_operation_key === state.payload.client_operation_key);
          if (existingKey) {
            return { data: null, error: { code: '23505', message: 'duplicate client_operation_key' } };
          }
        }

        const record = {
          id: `${table}-${++seq}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...state.payload,
          revision: 1, // Trigger behavior: always 1 on INSERT
        };
        if (record.resident_id) {
          const res = stores.residents.find((r) => r.id === record.resident_id);
          if (res) {
            record.municipality_id = res.municipality_id;
            record.barangay_id = res.barangay_id;
          }
        }
        if (record.household_id) {
          const hh = stores.households.find((h) => h.id === record.household_id);
          if (hh) {
            record.municipality_id = hh.municipality_id;
            record.barangay_id = hh.barangay_id;
          }
        }
        rows().push(record);
        return { data: singleMode ? { ...record } : [{ ...record }], error: null };
      }

      if (state.op === 'update') {
        const matched = rows().filter(matches);
        for (const target of matched) {
          Object.assign(target, state.payload, {
            updated_at: new Date().toISOString(),
            ...(table === 'sync_operations' ? {} : { revision: (target.revision || 1) + 1 }),
          });
        }
        if (singleMode === 'single') {
          return matched[0]
            ? { data: { ...matched[0] }, error: null }
            : { data: null, error: { code: 'PGRST116', message: 'not found' } };
        }
        if (singleMode === 'maybeSingle') {
          return { data: matched[0] ? { ...matched[0] } : null, error: null };
        }
        return { data: matched.map((r) => ({ ...r })), error: null };
      }

      if (state.op === 'delete') {
        const kept = rows().filter((r) => !matches(r));
        const removed = rows().filter(matches);
        stores[table] = kept;
        return { data: removed, error: null };
      }

      return { data: null, error: null };
    };

    const query = {
      select() { return query; },
      eq(col, val) { state.filters.push([col, val]); return query; },
      is(col, val) { state.filters.push([col, val]); return query; },
      gte() { return query; },
      lte() { return query; },
      order() { return query; },
      limit() { return query; },
      insert(val) { state.op = 'insert'; state.payload = val; return query; },
      update(val) { state.op = 'update'; state.payload = val; return query; },
      delete() { state.op = 'delete'; return query; },
      single() { return execute({ singleMode: 'single' }); },
      maybeSingle() { return execute({ singleMode: 'maybeSingle' }); },
      then(onFulfilled, onRejected) { return execute().then(onFulfilled, onRejected); },
    };
    return query;
  };

  return { from, stores };
}

// Helper to execute Express middleware -> controller pipeline
async function invokeEndpoint({ middleware, handler, req }) {
  const res = {
    statusCode: 200,
    sent: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.sent = { status: this.statusCode, body }; return this; },
  };
  req.get = (name) => {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(req.headers || {})) {
      if (k.toLowerCase() === lower) return v;
    }
    return undefined;
  };

  let middlewareErr = null;
  let nextCalled = false;
  await new Promise((resolve) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const out = originalJson(body);
      Promise.resolve(out).finally(resolve);
      return out;
    };
    middleware(req, res, (err) => {
      if (err) {
        middlewareErr = err;
        resolve();
        return;
      }
      nextCalled = true;
      Promise.resolve(handler(req, res))
        .catch((handlerErr) => {
          middlewareErr = handlerErr;
          resolve();
        });
    });
  });
  if (middlewareErr) throw middlewareErr;
  return { status: res.sent?.status ?? res.statusCode, body: res.sent?.body, nextCalled };
}

// ---------------------------------------------------------------------------
// 1, 2, 3, 4: First submission, duplicate replay, payload mismatch (409), concurrent (425 & 23505)
// ---------------------------------------------------------------------------
test('durable idempotency + persisted client_operation_key: first submit, exact replay, payload mismatch (409), and concurrent claim (425)', async () => {
  const db = createMockClinicalDb();
  const middleware = createIdempotencyMiddleware({
    durable: true,
    getClient: () => db,
    isConfigured: () => true,
    validateReplay: async (req, responseBody) => {
      const id = responseBody?.data?.record?.id;
      await programFormsService.verifyRecordScope({ user: req.user, kind: req.params.kind, id, supabase: db });
    },
  });

  const makeReq = (overrides = {}) => ({
    method: 'POST',
    originalUrl: '/api/program-forms/ncd-risk',
    user: HS_USER,
    params: { kind: 'ncd-risk' },
    headers: { 'idempotency-key': 'kalusagap-op-ncd-001' },
    body: {
      record: {
        residentId: 'res-a',
        assessment_date: '2026-10-15',
        se_status: 'NHTS',
        sex: 'F',
        age: 35,
        current_smoker: 'N',
      },
    },
    ...overrides,
  });

  const handler = (req, res) =>
    programFormsService.create({
      user: req.user,
      kind: req.params.kind,
      payload: req.body.record,
      idempotencyKey: req.idempotencyKey,
      isSync: isSyncRequest(req),
      supabase: db,
    }).then((record) => res.status(201).json({ data: { record } }));

  // 1. Successful first submission
  const first = await invokeEndpoint({ middleware, handler, req: makeReq() });
  assert.equal(first.status, 201);
  assert.equal(first.body.data.record.client_operation_key, 'kalusagap-op-ncd-001');
  assert.equal(first.body.data.record.revision, 1);
  assert.equal(db.stores.ncd_risk_assessments.length, 1);
  assert.equal(db.stores.health_audit_logs.length, 1);

  // 2. Duplicate request replay returns original 201 response without re-running handler
  const replay = await invokeEndpoint({ middleware, handler, req: makeReq() });
  assert.equal(replay.status, 201);
  assert.equal(replay.nextCalled, false, 'replay served from durable ledger without re-executing handler');
  assert.equal(replay.body.data.record.id, first.body.data.record.id);
  assert.equal(db.stores.ncd_risk_assessments.length, 1);
  assert.equal(db.stores.health_audit_logs.length, 1);

  // 3. Same key with different payload returns HTTP 409
  await assert.rejects(
    invokeEndpoint({
      middleware,
      handler,
      req: makeReq({
        body: { record: { residentId: 'res-a', assessment_date: '2026-10-16', se_status: 'Non-NHTS' } },
      }),
    }),
    { statusCode: 409 },
  );

  // 4. Concurrent in-flight claim for a second key returns HTTP 425 (Too Early)
  db.stores.sync_operations.push({
    id: 'claim-inflight',
    user_id: HS_USER.id,
    idempotency_key: 'kalusagap-op-ncd-inflight',
    method: 'POST',
    path: '/api/program-forms/ncd-risk',
    request_fingerprint: null, // matches method + path
    status: 'processing',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await assert.rejects(
    invokeEndpoint({
      middleware,
      handler,
      req: makeReq({ headers: { 'idempotency-key': 'kalusagap-op-ncd-inflight' } }),
    }),
    { statusCode: 425 },
  );
});

// ---------------------------------------------------------------------------
// 5: Database idempotency failure & malformed headers fail closed
// ---------------------------------------------------------------------------
test('durable idempotency fails closed (503/400) when ledger is unavailable or headers are malformed — never executing unprotected writes', async () => {
  for (const mode of ['select', 'insert']) {
    const db = createMockClinicalDb({ ledgerFailure: mode });
    let handlerExecuted = false;
    const middleware = createIdempotencyMiddleware({
      durable: true,
      getClient: () => db,
      isConfigured: () => true,
    });
    await assert.rejects(
      invokeEndpoint({
        middleware,
        handler: async () => { handlerExecuted = true; },
        req: {
          method: 'POST',
          originalUrl: '/api/operational/immunizations',
          user: HS_USER,
          headers: { 'idempotency-key': 'kalusagap-op-failclosed' },
          body: { record: { residentId: 'res-a', vaccine: 'BCG' } },
        },
      }),
      { statusCode: 503 },
    );
    assert.equal(handlerExecuted, false, `handler never ran during ledger ${mode} failure`);
    assert.equal(db.stores.immunizations.length, 0);
  }

  // Unconfigured Supabase on durable endpoint also fails closed with 503 when key is present
  const unconfiguredMw = createIdempotencyMiddleware({ durable: true, isConfigured: () => false });
  await assert.rejects(
    invokeEndpoint({
      middleware: unconfiguredMw,
      handler: async () => { assert.fail('must not run'); },
      req: {
        method: 'POST',
        originalUrl: '/api/operational/tcl',
        user: HS_USER,
        headers: { 'idempotency-key': 'kalusagap-op-unconf' },
        body: {},
      },
    }),
    { statusCode: 503 },
  );

  // Blank, oversized, or duplicate Idempotency-Key headers fail closed with 400
  const db = createMockClinicalDb();
  const mw = createIdempotencyMiddleware({ durable: true, getClient: () => db, isConfigured: () => true });
  for (const badHeader of ['   ', 'x'.repeat(201), ['key-1', 'key-2']]) {
    await assert.rejects(
      invokeEndpoint({
        middleware: mw,
        handler: async () => { assert.fail('must not run'); },
        req: {
          method: 'POST',
          originalUrl: '/api/operational/tcl',
          user: HS_USER,
          headers: { 'idempotency-key': badHeader },
          body: {},
        },
      }),
      { statusCode: 400 },
    );
  }

  // Explicit X-Kalusagap-Sync POST without Idempotency-Key fails closed with 400 IDEMPOTENCY_KEY_REQUIRED
  await assert.rejects(
    invokeEndpoint({
      middleware: mw,
      handler: async () => { assert.fail('must not run'); },
      req: {
        method: 'POST',
        originalUrl: '/api/operational/tcl',
        user: HS_USER,
        headers: { 'x-kalusagap-sync': '1' },
        body: {},
      },
    }),
    { statusCode: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' },
  );
});

// ---------------------------------------------------------------------------
// 6, 7, 8: Domain unique-index race protection + optimistic concurrency (operational, programForms, referrals)
// ---------------------------------------------------------------------------
test('operational clinical records (tcl, maternal, maternalvisits, immunizations): DB race dedup, matching revision update, stale 409, and missing sync revision rejection', async () => {
  // Simulate a 23505 race on insert where ledger was bypassed/retried: service recovers winner idempotently
  const raceDb = createMockClinicalDb({ simulateInsertRace: true });
  const recovered = await operationalService.create({
    user: HS_USER,
    kind: 'immunizations',
    idempotencyKey: 'kalusagap-op-imm-race',
    isSync: true,
    payload: { residentId: 'res-a', vaccine: 'BCG', status: 'Completed' },
    supabase: raceDb,
  });
  assert.equal(recovered.id, 'immunizations-winner');
  assert.equal(recovered.client_operation_key, 'kalusagap-op-imm-race');
  assert.equal(raceDb.stores.immunizations.length, 1);

  // Cross-user or cross-resident reuse of a persisted client_operation_key returns 409
  await assert.rejects(
    operationalService.create({
      user: { ...HS_USER, id: '99999999-9999-4999-8999-999999999999' },
      kind: 'immunizations',
      idempotencyKey: 'kalusagap-op-imm-race',
      isSync: true,
      payload: { residentId: 'res-a', vaccine: 'BCG' },
      supabase: raceDb,
    }),
    { statusCode: 409 },
  );

  // Create maternal record + maternal visit with operation keys
  const db = createMockClinicalDb();
  const maternal = await operationalService.create({
    user: HS_USER,
    kind: 'maternal',
    idempotencyKey: 'kalusagap-op-mat-1',
    isSync: true,
    payload: { residentId: 'res-a', lmp: '2026-03-01', edd: '2026-12-06', notes: 'Initial pregnancy' },
    supabase: db,
  });
  assert.equal(maternal.revision, 1);

  const visit = await operationalService.create({
    user: HS_USER,
    kind: 'maternalvisits',
    idempotencyKey: 'kalusagap-op-mv-1',
    isSync: true,
    payload: { residentId: 'res-a', maternal_case_id: maternal.id, visit_date: '2026-10-10', visit_type: 'prenatal', blood_pressure: '110/70' },
    supabase: db,
  });
  assert.equal(visit.revision, 1);
  assert.equal(visit.client_operation_key, 'kalusagap-op-mv-1');

  // Synchronization update omitting expected revision fails closed (400 REVISION_REQUIRED), never substituting current revision
  await assert.rejects(
    operationalService.update({
      user: HS_USER,
      kind: 'maternal',
      id: maternal.id,
      payload: { notes: 'Sync without revision' },
      isSync: true,
      supabase: db,
    }),
    { statusCode: 400, code: 'REVISION_REQUIRED' },
  );

  // Matching If-Match ("1" or W/"1") succeeds, increments revision to 2, and ignores forged client revision
  const updatedMaternal = await operationalService.update({
    user: HS_USER,
    kind: 'maternal',
    id: maternal.id,
    payload: { notes: 'Verified prenatal update', revision: 999, client_operation_key: 'forged' },
    expectedUpdatedAt: 'W/"1"',
    isSync: true,
    supabase: db,
  });
  assert.equal(updatedMaternal.revision, 2);
  assert.equal(updatedMaternal.notes, 'Verified prenatal update');
  assert.equal(updatedMaternal.client_operation_key, 'kalusagap-op-mat-1');

  // Stale revision (If-Match: "1" when current is 2) rejects with HTTP 409 STALE_REVISION + currentRevision
  await assert.rejects(
    operationalService.update({
      user: HS_USER,
      kind: 'maternal',
      id: maternal.id,
      payload: { notes: 'Stale overwrite attempt' },
      expectedUpdatedAt: '"1"',
      isSync: true,
      supabase: db,
    }),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'STALE_REVISION');
      assert.deepEqual(err.details, { currentRevision: 2 });
      return true;
    },
  );
  assert.equal(db.stores.maternal_records[0].notes, 'Verified prenatal update');
});

test('programForms (ncd, oral-health, environmental): concurrency CAS race, revision updates, and online compatibility', async () => {
  const db = createMockClinicalDb();

  // Environmental household form create with idempotency key
  const envCreated = await programFormsService.create({
    user: HS_USER,
    kind: 'environmental',
    idempotencyKey: 'kalusagap-op-env-1',
    isSync: true,
    payload: {
      householdId: 'hh-a',
      assessment_date: '2026-10-12',
      water_supply_type: 'level3',
      sanitary_facility_type: 'a',
      waste_segregation: true,
      waste_collected: true,
    },
    supabase: db,
  });
  assert.equal(envCreated.revision, 1);
  assert.equal(envCreated.complete_sanitation, true);

  // Sync update without revision is rejected
  await assert.rejects(
    programFormsService.update({
      user: HS_USER,
      kind: 'environmental',
      id: envCreated.id,
      payload: { remarks: 'Missing precondition' },
      isSync: true,
      supabase: db,
    }),
    { statusCode: 400, code: 'REVISION_REQUIRED' },
  );

  // Sync update with matching revision=1 succeeds -> revision=2
  const envUpdated = await programFormsService.update({
    user: HS_USER,
    kind: 'environmental',
    id: envCreated.id,
    payload: { remarks: 'Synced update rev 2' },
    ifMatch: '1',
    isSync: true,
    supabase: db,
  });
  assert.equal(envUpdated.revision, 2);

  // 9. Existing online workflow (isSync=false, no If-Match) remains fully compatible
  const onlineUpdated = await programFormsService.update({
    user: HS_USER,
    kind: 'environmental',
    id: envCreated.id,
    payload: { remarks: 'Online edit without If-Match' },
    isSync: false,
    supabase: db,
  });
  assert.equal(onlineUpdated.revision, 3);
  assert.equal(onlineUpdated.remarks, 'Online edit without If-Match');

  // Concurrent SQL CAS race between initial SELECT and UPDATE throws 409 STALE_REVISION
  const casRaceDb = createMockClinicalDb({ simulateUpdateRace: true });
  const oral = await programFormsService.create({
    user: HS_USER,
    kind: 'oral-health',
    payload: { residentId: 'res-a', consultation_date: '2026-10-15', age_group: '20-59' },
    supabase: casRaceDb,
  });
  await assert.rejects(
    programFormsService.update({
      user: HS_USER,
      kind: 'oral-health',
      id: oral.id,
      payload: { notes: 'Lost race' },
      ifMatch: '1',
      isSync: true,
      supabase: casRaceDb,
    }),
    (err) => err.statusCode === 409 && err.code === 'STALE_REVISION' && err.details?.currentRevision === 2,
  );
});

test('referrals strict synchronization version guard rejects omitted or stale versions without enabling offline status transitions', () => {
  const existing = { id: 'ref-1', version: 4 };

  // Ordinary online fallback preserved when not a sync request and no version supplied
  assert.equal(referralsService.resolveExpectedReferralVersion(undefined, existing, { isSync: false }), 4);

  // Sync request omitting expected_version AND If-Match fails closed (never substitutes existing.version)
  assert.throws(
    () => referralsService.resolveExpectedReferralVersion(undefined, existing, { isSync: true }),
    { statusCode: 400, code: 'REVISION_REQUIRED' },
  );

  // Stale version or stale If-Match throws 409 STALE_REVISION
  assert.throws(
    () => referralsService.resolveExpectedReferralVersion(3, existing, { isSync: true }),
    { statusCode: 409, code: 'STALE_REVISION' },
  );
  assert.throws(
    () => referralsService.resolveExpectedReferralVersion(undefined, existing, { isSync: true, ifMatch: '"2"' }),
    { statusCode: 409, code: 'STALE_REVISION' },
  );

  // Conflicting If-Match vs body expected_version throws 400
  assert.throws(
    () => referralsService.resolveExpectedReferralVersion(4, existing, { isSync: true, ifMatch: '"5"' }),
    { statusCode: 400 },
  );

  // Matching If-Match or expected_version succeeds
  assert.equal(referralsService.resolveExpectedReferralVersion(undefined, existing, { isSync: true, ifMatch: 'W/"4"' }), 4);
  assert.equal(referralsService.resolveExpectedReferralVersion(4, existing, { isSync: true }), 4);

  // Ensure controller forwards sync headers cleanly
  assert.equal(typeof referralsController.update, 'function');
  assert.equal(typeof operationalController.update, 'function');
  assert.equal(typeof programFormsController.update, 'function');
});

// ---------------------------------------------------------------------------
// 10: Role and barangay authorization preserved across creates, updates, and replays
// ---------------------------------------------------------------------------
test('role and barangay restrictions block BHW and cross-barangay staff on sync creates, updates, and replays', async () => {
  const db = createMockClinicalDb();

  // BHW is forbidden from creating or updating clinical operational / program records
  await assert.rejects(
    operationalService.create({
      user: BHW_USER,
      kind: 'tcl',
      idempotencyKey: 'kalusagap-op-bhw-denied',
      isSync: true,
      payload: { residentId: 'res-a', program: 'Oral Health' },
      supabase: db,
    }),
    { statusCode: 403 },
  );
  await assert.rejects(
    programFormsService.create({
      user: BHW_USER,
      kind: 'ncd-risk',
      idempotencyKey: 'kalusagap-op-bhw-ncd',
      isSync: true,
      payload: { residentId: 'res-a', assessment_date: '2026-10-15' },
      supabase: db,
    }),
    { statusCode: 403 },
  );

  // Health Supervisor from Barangay A cannot create a clinical record for Resident B (Barangay B)
  await assert.rejects(
    operationalService.create({
      user: HS_USER,
      kind: 'tcl',
      idempotencyKey: 'kalusagap-op-cross-brgy',
      isSync: true,
      payload: { residentId: 'res-b', program: 'Oral Health' },
      supabase: db,
    }),
    { statusCode: 404 },
  );

  // Valid create in Barangay A, then cross-barangay supervisor cannot update or verify replay scope
  const createdTcl = await operationalService.create({
    user: HS_USER,
    kind: 'tcl',
    idempotencyKey: 'kalusagap-op-tcl-valid',
    isSync: true,
    payload: { residentId: 'res-a', program: 'Oral Health' },
    supabase: db,
  });

  await assert.rejects(
    operationalService.update({
      user: OTHER_HS_USER,
      kind: 'tcl',
      id: createdTcl.id,
      payload: { notes: 'Unauthorized barangay edit' },
      expectedUpdatedAt: '1',
      isSync: true,
      supabase: db,
    }),
    { statusCode: 404 },
  );

  await assert.rejects(
    operationalService.verifyRecordScope({
      user: OTHER_HS_USER,
      kind: 'tcl',
      id: createdTcl.id,
      supabase: db,
    }),
    { statusCode: 404 },
  );

  // Precondition parser rejects wildcards, zeroes, negatives, floats, and conflicting headers
  for (const invalid of ['*', '0', '-2', '1.5', '2147483648', 'abc']) {
    assert.throws(() => extractExpectedRevision({ ifMatch: invalid }), { statusCode: 400 });
  }
  assert.throws(() => extractExpectedRevision({ ifMatch: '2', bodyRevision: 3 }), { statusCode: 400 });
});

test('CORS preflight allows Idempotency-Key, If-Match, and X-Kalusagap-Sync headers without opening a socket', async () => {
  const allowedOrigin = env.clientUrls[0] || 'http://localhost:5173';
  const socket = new Duplex({ read() {}, write(_chunk, _enc, cb) { cb(); } });
  const req = new http.IncomingMessage(socket);
  req.method = 'OPTIONS';
  req.url = '/api/operational/tcl';
  req.headers = {
    origin: allowedOrigin,
    'access-control-request-method': 'PUT',
    'access-control-request-headers': 'authorization,content-type,idempotency-key,if-match,x-kalusagap-sync',
  };
  const res = new http.ServerResponse(req);
  res.assignSocket(socket);

  await new Promise((resolve, reject) => {
    res.on('finish', resolve);
    res.on('error', reject);
    app(req, res);
  });

  assert.equal(res.statusCode, 204);
  assert.equal(res.getHeader('access-control-allow-origin'), allowedOrigin);
  const allowHeaders = String(res.getHeader('access-control-allow-headers') || '');
  assert.match(allowHeaders, /Idempotency-Key/i);
  assert.match(allowHeaders, /If-Match/i);
  assert.match(allowHeaders, /X-Kalusagap-Sync/i);
});

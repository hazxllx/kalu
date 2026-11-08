import assert from 'node:assert/strict';
import test from 'node:test';

import ApiError from '../src/utils/apiError.js';
import errorHandler from '../src/middleware/errorHandler.js';
import { create, update } from '../src/services/operational.service.js';
import * as residentsService from '../src/services/residents.service.js';
import repository from '../src/repositories/index.js';
import { ROLES } from '../src/config/roles.js';

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

const render = (err) => {
  let status = null;
  let body = null;
  const res = {
    status(code) { status = code; return res; },
    json(value) { body = value; return res; },
  };
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    errorHandler(err, { method: 'POST', path: '/x', requestId: 't' }, res, () => {});
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
  return { status, body };
};

test('errorHandler exposes machine-readable DUPLICATE_RECORD / STALE_REVISION codes', () => {
  const duplicate = render(ApiError.duplicate('dup message'));
  assert.equal(duplicate.status, 409);
  assert.deepEqual(duplicate.body, { error: { message: 'dup message', code: 'DUPLICATE_RECORD' } });

  const stale = render(ApiError.staleRevision('stale message'));
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body, { error: { message: 'stale message', code: 'STALE_REVISION' } });

  assert.equal(ApiError.duplicate().message, 'A matching record already exists');
  assert.equal(ApiError.staleRevision().message, 'This record changed on the server');
});

test('errorHandler omits codes that are not app-level machine codes', () => {
  assert.deepEqual(render(ApiError.conflict('plain')).body, { error: { message: 'plain' } });

  const postgres = Object.assign(new Error('pg'), { statusCode: 409, code: '23505' });
  assert.deepEqual(render(postgres).body, { error: { message: 'pg' } });

  const lowercase = Object.assign(new Error('x'), { statusCode: 400, code: 'pgrst116' });
  assert.equal('code' in render(lowercase).body.error, false);
});

// ---------------------------------------------------------------------------
// Follow-ups (fake supabase client)
// ---------------------------------------------------------------------------

const USER = { id: 'phn-1', role: 'phn' };
const RESIDENT = { id: 'resident-1', municipality_id: null, barangay_id: null, auth_user_id: null };

const makeSupabase = ({ followUps = [] } = {}) => {
  const rows = followUps.map((row) => ({ ...row }));
  let inserts = 0;
  let clock = 0;
  const nextStamp = () => `2026-10-20T02:00:0${(clock += 1)}.000000+00:00`;

  const supabase = {
    rows,
    get inserts() { return inserts; },
    // Simulates a concurrent writer touching the row between our read and write.
    raceOnNextRead: false,
    from(table) {
      const filters = [];
      let op = 'select';
      let payload = null;
      const matches = (row) => filters.every(([column, value]) => row[column] === value);
      const run = () => {
        if (table === 'residents') {
          const id = filters.find(([c]) => c === 'id')?.[1];
          return { rows: id === RESIDENT.id ? [RESIDENT] : [] };
        }
        if (table === 'follow_ups') {
          if (op === 'insert') {
            inserts += 1;
            const row = { ...payload, id: `follow-up-${rows.length + 1}`, updated_at: nextStamp() };
            rows.push(row);
            return { rows: [row] };
          }
          const found = rows.filter(matches);
          if (op === 'update') {
            for (const row of found) Object.assign(row, payload, { updated_at: nextStamp() });
          }
          return { rows: found.map((row) => ({ ...row })) };
        }
        return { rows: [] };
      };
      const query = {
        select() { return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        insert(value) { op = 'insert'; payload = value; return query; },
        update(value) { op = 'update'; payload = value; return query; },
        maybeSingle() {
          const { rows: found } = run();
          if (supabase.raceOnNextRead && table === 'follow_ups' && op === 'select') {
            supabase.raceOnNextRead = false;
            for (const row of rows) row.updated_at = nextStamp();
          }
          return Promise.resolve({ data: found[0] ?? null, error: null });
        },
        single() {
          const { rows: found } = run();
          return Promise.resolve(found[0]
            ? { data: found[0], error: null }
            : { data: null, error: { code: 'PGRST116', message: 'no rows' } });
        },
        then(resolve, reject) {
          const { rows: found } = run();
          return Promise.resolve({ data: found, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return supabase;
};

const followUpInput = (supabase, overrides = {}) => ({
  user: USER,
  kind: 'followups',
  idempotencyKey: 'op-1',
  supabase,
  ...overrides,
  payload: {
    residentId: RESIDENT.id,
    purpose: 'Check-up',
    scheduled_date: '2026-10-20',
    scheduled_time: '09:00',
    status: 'Scheduled',
    ...(overrides.payload || {}),
  },
});

test('a matching open follow-up is rejected with 409 DUPLICATE_RECORD', async () => {
  const supabase = makeSupabase();
  await create(followUpInput(supabase));

  await assert.rejects(
    create(followUpInput(supabase, {
      idempotencyKey: 'op-2',
      payload: { purpose: '  CHECK-UP ', scheduled_time: '09:00:00' },
    })),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'DUPLICATE_RECORD');
      assert.equal(
        err.message,
        'A matching follow-up is already scheduled for this resident at that date and time.',
      );
      return true;
    },
  );
  assert.equal(supabase.inserts, 1);
});

test('an idempotent replay of the same key still returns the existing follow-up', async () => {
  const supabase = makeSupabase();
  const first = await create(followUpInput(supabase));
  const replay = await create(followUpInput(supabase));

  assert.equal(replay.id, first.id);
  assert.equal(supabase.inserts, 1);
});

test('different time, different purpose or a closed follow-up does not count as a duplicate', async () => {
  const supabase = makeSupabase({
    followUps: [
      { id: 'old-1', resident_id: RESIDENT.id, purpose: 'Check-up', scheduled_date: '2026-10-20', scheduled_time: '09:00:00', status: 'Cancelled' },
      { id: 'old-2', resident_id: RESIDENT.id, purpose: 'Check-up', scheduled_date: '2026-10-20', scheduled_time: '13:00:00', status: 'Scheduled' },
    ],
  });

  // Same slot as a Cancelled one, different slot from the open one.
  await create(followUpInput(supabase, { idempotencyKey: 'op-a' }));
  // Different purpose.
  await create(followUpInput(supabase, { idempotencyKey: 'op-b', payload: { purpose: 'Vaccination' } }));
  assert.equal(supabase.inserts, 2);

  // Both blank times count as equal.
  await create(followUpInput(supabase, { idempotencyKey: 'op-c', payload: { scheduled_time: '', purpose: 'Lab review' } }));
  await assert.rejects(
    create(followUpInput(supabase, { idempotencyKey: 'op-d', payload: { scheduled_time: null, purpose: 'lab review' } })),
    { statusCode: 409, code: 'DUPLICATE_RECORD' },
  );
});

const seededFollowUp = () => ({
  id: 'fu-1',
  resident_id: RESIDENT.id,
  purpose: 'Check-up',
  scheduled_date: '2026-10-20',
  scheduled_time: '09:00:00',
  status: 'Scheduled',
  notes: '',
  updated_at: '2026-10-20T01:02:03.123456+00:00',
});

const updateInput = (supabase, expectedUpdatedAt) => ({
  user: USER,
  kind: 'followups',
  id: 'fu-1',
  payload: { notes: 'queued note' },
  expectedUpdatedAt,
  supabase,
});

test('a follow-up update with a stale If-Match is rejected with 409 STALE_REVISION', async () => {
  const supabase = makeSupabase({ followUps: [seededFollowUp()] });

  await assert.rejects(
    update(updateInput(supabase, '"2026-10-19T00:00:00.000Z"')),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'STALE_REVISION');
      assert.equal(
        err.message,
        'This follow-up changed on the server. Reload it before applying the queued changes.',
      );
      return true;
    },
  );
  assert.equal(supabase.rows[0].notes, '');
});

test('a follow-up update with a matching If-Match succeeds (quotes and W/ are stripped)', async () => {
  const supabase = makeSupabase({ followUps: [seededFollowUp()] });
  const updated = await update(updateInput(supabase, 'W/"2026-10-20T01:02:03.123Z"'));

  assert.equal(updated.notes, 'queued note');
  assert.equal(supabase.rows[0].notes, 'queued note');
});

test('a follow-up update without If-Match keeps working', async () => {
  const supabase = makeSupabase({ followUps: [seededFollowUp()] });
  const updated = await update(updateInput(supabase, null));
  assert.equal(updated.notes, 'queued note');
});

test('an unparseable follow-up If-Match is a 400', async () => {
  const supabase = makeSupabase({ followUps: [seededFollowUp()] });
  await assert.rejects(
    update(updateInput(supabase, 'not-a-date')),
    { statusCode: 400, message: 'The follow-up revision is invalid.' },
  );
});

test('a concurrent write between read and update raises STALE_REVISION instead of overwriting', async () => {
  const supabase = makeSupabase({ followUps: [seededFollowUp()] });
  supabase.raceOnNextRead = true;

  await assert.rejects(
    update(updateInput(supabase, '2026-10-20T01:02:03.123Z')),
    { statusCode: 409, code: 'STALE_REVISION' },
  );
  assert.equal(supabase.rows[0].notes, '');
});

// ---------------------------------------------------------------------------
// Residents (repository doubles)
// ---------------------------------------------------------------------------

const municipalityId = 'm-1';
const userHS = { id: 'hs-1', role: ROLES.HEALTH_SUPERVISOR, barangay: 'San Isidro', municipalityId };
const userPHN = { id: 'phn-1', role: ROLES.PHN, municipalityId };

const residentPayload = {
  firstName: 'Maria',
  lastName: 'Dela Cruz',
  birthDate: '2000-09-02',
  sex: 'Female',
  barangay: 'San Isidro',
};

const makeExisting = (overrides = {}) => ({
  id: 'res-existing',
  firstName: 'Maria',
  lastName: 'Dela Cruz',
  birthDate: '2000-09-02',
  sex: 'Female',
  barangay: 'San Isidro',
  municipalityId: userHS.municipalityId,
  barangayId: userHS.barangayId,
  healthRecordNo: 'HR-001',
  ...overrides,
});

const installResidentDoubles = ({ existingByKey = null, insertError = null } = {}) => {
  const calls = { inserts: [], keyLookups: [], identityLookups: 0 };
  repository.findBarangayByName = async (name) => (name === 'San Isidro' ? { name, status: 'Active' } : null);
  repository.findResidentByIdentity = async () => {
    calls.identityLookups += 1;
    // Would trip the duplicate guard if a replay ever reached it.
    return makeExisting();
  };
  repository.nextResidentIds = async () => ({ id: 'res-new', healthRecordNo: 'HR-999' });
  repository.findResidentByOperationKey = async (key) => {
    calls.keyLookups.push(key);
    return existingByKey;
  };
  repository.insertResident = async (row) => {
    calls.inserts.push(row);
    if (insertError) throw insertError;
    return { ...row };
  };
  return calls;
};

test('a replayed resident create returns the existing resident without inserting', async () => {
  const existing = makeExisting();
  const calls = installResidentDoubles({ existingByKey: existing });

  const result = await residentsService.createResident({
    user: userHS,
    payload: residentPayload,
    idempotencyKey: 'res-op-1',
  });

  assert.equal(result, existing);
  assert.deepEqual(calls.keyLookups, ['res-op-1']);
  assert.equal(calls.inserts.length, 0);
  assert.equal(calls.identityLookups, 0);
});

test('a resident replay cannot bypass the caller\'s current barangay scope', async () => {
  const calls = installResidentDoubles({ existingByKey: makeExisting({ barangay: 'Other Barangay' }) });

  await assert.rejects(
    residentsService.createResident({ user: userHS, payload: residentPayload, idempotencyKey: 'res-op-1' }),
    { statusCode: 404 },
  );
  assert.equal(calls.inserts.length, 0);
});

test('a resident replay still fails validation before the key is looked up', async () => {
  const calls = installResidentDoubles({ existingByKey: makeExisting() });

  await assert.rejects(
    residentsService.createResident({
      user: userHS,
      payload: { ...residentPayload, firstName: '' },
      idempotencyKey: 'res-op-1',
    }),
    { statusCode: 422 },
  );
  assert.equal(calls.keyLookups.length, 0);
});

test('the first resident create carries the operation key into the insert', async () => {
  const calls = installResidentDoubles();
  // The identity double always reports a duplicate; use a different barangay row
  // so only the key path is exercised here.
  repository.findResidentByIdentity = async () => null;

  const result = await residentsService.createResident({
    user: userPHN,
    payload: residentPayload,
    idempotencyKey: 'res-op-2',
  });

  assert.equal(calls.inserts.length, 1);
  assert.equal(calls.inserts[0].clientOperationKey, 'res-op-2');
  assert.equal(result.clientOperationKey, 'res-op-2');
});

test('a resident create without a key does not use the operation key path', async () => {
  const calls = installResidentDoubles();
  repository.findResidentByIdentity = async () => null;

  await residentsService.createResident({ user: userPHN, payload: residentPayload });

  assert.equal(calls.keyLookups.length, 0);
  assert.equal('clientOperationKey' in calls.inserts[0], false);
});

test('a 23505 operation-key collision on insert returns the row that operation created', async () => {
  const existing = makeExisting();
  const collision = Object.assign(new Error('A resident for this operation already exists.'), {
    code: '23505',
    statusCode: 409,
  });
  const calls = installResidentDoubles({ insertError: collision });
  repository.findResidentByIdentity = async () => null;
  // Not visible on the first lookup (race), visible after the collision.
  let lookups = 0;
  repository.findResidentByOperationKey = async () => {
    lookups += 1;
    return lookups === 1 ? null : existing;
  };

  const result = await residentsService.createResident({
    user: userHS,
    payload: residentPayload,
    idempotencyKey: 'res-op-3',
  });

  assert.equal(result, existing);
  assert.equal(calls.inserts.length, 1);
  assert.equal(lookups, 2);
});

test('residents duplicate identity and stale revision carry machine codes', async () => {
  installResidentDoubles();
  await assert.rejects(
    residentsService.createResident({ user: userHS, payload: residentPayload }),
    { statusCode: 409, code: 'DUPLICATE_RECORD' },
  );

  repository.getResident = async (id) => makeExisting({ id });
  repository.updateResident = async () => null;
  await assert.rejects(
    residentsService.updateResident({
      id: 'res-existing',
      user: { id: 'phn-1', role: ROLES.PHN, municipalityId },
      patch: {},
      expectedUpdatedAt: '2026-10-20T01:02:03.123Z',
    }),
    { statusCode: 409, code: 'STALE_REVISION' },
  );
});

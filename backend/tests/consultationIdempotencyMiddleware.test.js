import assert from 'node:assert/strict';
import test from 'node:test';
import { createIdempotencyMiddleware } from '../src/middleware/idempotency.js';

const KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const request = (overrides = {}) => ({ user: { id: 'test-author' }, headers: { 'idempotency-key': KEY },
  method: 'POST', originalUrl: '/api/consultations', body: { clientOperationKey: KEY, residentId: 'RES-TEST' }, ...overrides });
const response = () => ({ statusCode: 200, sent: [], status(status) { this.statusCode = status; return this; },
  json(body) { this.sent.push({ status: this.statusCode, body }); return this; } });
const success = { data: { consultation: { id: 'SUB-TEST', resident: { id: 'RES-TEST' }, clientOperationKey: KEY } } };

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const makeLedger = (options = {}) => {
  const rows = new Map();
  let sequence = 0;
  const ledger = {
    rows,
    from(table) {
      assert.equal(table, 'sync_operations');
      const filters = {};
      let action = 'select';
      let value;
      const execute = async () => {
        const matches = Array.from(rows.values()).filter((row) => Object.entries(filters).every(([key, expected]) => row[key] === expected));
        if (action === 'select') return options.readFailure ? { error: { code: '503' } } : { data: matches[0] || null, error: null };
        if (action === 'insert') {
          if (options.claimFailure) return { error: { code: '503' } };
          const key = `${value.user_id}:${value.idempotency_key}`;
          if (rows.has(key)) return { error: { code: '23505' } };
          const row = { id: `claim-${++sequence}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...value };
          rows.set(key, row);
          return { data: { id: row.id }, error: null };
        }
        if (action === 'delete') {
          if (options.releaseFailure) return { error: { code: '503' } };
          for (const row of matches) rows.delete(`${row.user_id}:${row.idempotency_key}`);
          return { data: matches, error: null };
        }
        if (options.updateEntered) options.updateEntered.resolve();
        if (options.updateGate) await options.updateGate.promise;
        if (options.completionFailure) return { error: { code: '503' } };
        for (const row of matches) Object.assign(row, value);
        return { data: matches.map((row) => ({ id: row.id })), error: null };
      };
      const query = {
        select() { return query; }, eq(key, expected) { filters[key] = expected; return query; },
        insert(data) { action = 'insert'; value = data; return query; },
        update(data) { action = 'update'; value = data; return query; },
        delete() { action = 'delete'; return query; },
        single() { return execute(); }, maybeSingle() { return execute(); },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      return query;
    },
  };
  return ledger;
};
const middlewareFor = (ledger, options = {}) => createIdempotencyMiddleware({
  durable: true, getClient: () => ledger, isConfigured: () => true, ...options,
});

const mount = async (middleware, req = request(), res = response()) => {
  const calls = [];
  const ready = deferred();
  const originalJson = res.json.bind(res);
  res.json = (body) => { const result = originalJson(body); ready.resolve({ kind: 'response' }); return result; };
  const next = (error) => { calls.push(error || null); ready.resolve({ kind: 'next', error }); };
  middleware(req, res, next);
  const outcome = await ready.promise;
  return { ...outcome, req, res, calls };
};

test('success is sent only after the completed idempotency outcome is durably acknowledged', async () => {
  const updateGate = deferred();
  const updateEntered = deferred();
  const ledger = makeLedger({ updateGate, updateEntered });
  const mounted = await mount(middlewareFor(ledger));
  assert.equal(mounted.kind, 'next');
  assert.equal(mounted.req.idempotencyKey, KEY);
  const pending = mounted.res.status(201).json(success);
  await updateEntered.promise;
  assert.equal(mounted.res.sent.length, 0, 'no response while ledger completion is pending');
  assert.equal(Array.from(ledger.rows.values())[0].status, 'processing');
  updateGate.resolve();
  await pending;
  assert.equal(mounted.res.sent[0].status, 201);
  assert.equal(Array.from(ledger.rows.values())[0].status, 'completed');
  const replay = await mount(middlewareFor(ledger));
  assert.equal(replay.kind, 'response');
  assert.deepEqual(replay.res.sent[0].body, success);
  assert.equal(replay.calls.length, 0, 'replay never executes another clinical handler');
});

test('a returned ledger error cannot be swallowed as a successful consultation response', async () => {
  const ledger = makeLedger({ completionFailure: true });
  const mounted = await mount(middlewareFor(ledger));
  await mounted.res.status(201).json(success);
  assert.equal(mounted.res.sent.length, 0);
  assert.equal(mounted.calls.at(-1).statusCode, 503);
  assert.equal(ledger.rows.size, 0, 'failed outcome releases its exact claim for resumable domain replay');
});

test('durable creates fail closed before the domain handler if ledger read or claim is unavailable', async () => {
  for (const options of [{ readFailure: true }, { claimFailure: true }]) {
    const mounted = await mount(middlewareFor(makeLedger(options)));
    assert.equal(mounted.error.statusCode, 503);
    assert.equal(mounted.res.sent.length, 0);
    assert.equal(mounted.calls.length, 1);
  }
});

test('concurrent duplicates return retryable 425 and a different payload returns 409', async () => {
  const ledger = makeLedger();
  const middleware = middlewareFor(ledger);
  const [first, second] = await Promise.all([mount(middleware), mount(middleware)]);
  const winner = first.error ? second : first;
  const loser = first.error ? first : second;
  assert.equal(loser.error.statusCode, 425);
  assert.equal(ledger.rows.size, 1);
  await winner.res.status(201).json(success);
  const altered = await mount(middleware, request({ body: { residentId: 'RES-OTHER', clientOperationKey: KEY } }));
  assert.equal(altered.error.statusCode, 409);
  assert.equal(altered.res.sent.length, 0);
});

test('completed replays still revalidate current clinical authorization and resident scope', async () => {
  const ledger = makeLedger();
  const first = await mount(middlewareFor(ledger));
  await first.res.status(201).json(success);
  let validations = 0;
  const denied = await mount(middlewareFor(ledger, { validateReplay: async () => {
    validations += 1;
    throw Object.assign(new Error('Scope changed'), { statusCode: 404 });
  } }));
  assert.equal(validations, 1);
  assert.equal(denied.error.statusCode, 404);
  assert.equal(denied.res.sent.length, 0);
  const otherUser = await mount(middlewareFor(ledger), request({ user: { id: 'other-author' } }));
  assert.equal(otherUser.kind, 'next', 'the ledger never replays another user response; domain ownership guard then applies');
  assert.equal(otherUser.res.sent.length, 0);
});

test('an expired old worker cannot complete or delete a newer claim for the same consultation key', async () => {
  const ledger = makeLedger();
  const middleware = middlewareFor(ledger);
  const old = await mount(middleware);
  const oldRow = Array.from(ledger.rows.values())[0];
  oldRow.updated_at = new Date(Date.now() - 120_000).toISOString();
  const current = await mount(middleware);
  const newRow = Array.from(ledger.rows.values())[0];
  assert.notEqual(newRow.id, oldRow.id);
  await old.res.status(201).json(success);
  assert.equal(old.res.sent.length, 0);
  assert.equal(old.calls.at(-1).statusCode, 503);
  assert.equal(Array.from(ledger.rows.values())[0].id, newRow.id);
  assert.equal(newRow.status, 'processing');
  await current.res.status(201).json(success);
  assert.equal(current.res.sent[0].status, 201);
  assert.equal(newRow.status, 'completed');
});

test('clinical validation failures retain their true response even if claim release fails', async () => {
  const ledger = makeLedger({ releaseFailure: true });
  const mounted = await mount(middlewareFor(ledger));
  const rejection = { error: { message: 'Test validation failure' } };
  await mounted.res.status(422).json(rejection);
  assert.deepEqual(mounted.res.sent, [{ status: 422, body: rejection }]);
  assert.equal(Array.from(ledger.rows.values())[0].status, 'processing');
});

test('response transport failure never erases an already committed ledger outcome', async () => {
  const ledger = makeLedger();
  const res = response();
  res.json = () => { throw new Error('Response transport closed'); };
  const mounted = await mount(middlewareFor(ledger), request(), res);
  res.destroyed = true;
  await mounted.res.status(201).json(success);
  assert.equal(ledger.rows.size, 1);
  assert.equal(Array.from(ledger.rows.values())[0].status, 'completed');
  const replay = await mount(middlewareFor(ledger));
  assert.equal(replay.kind, 'response');
  assert.deepEqual(replay.res.sent[0].body, success);
});

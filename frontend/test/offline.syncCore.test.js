import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SYNC_STATE,
  computeBackoffMs,
  dependenciesSatisfied,
  orderOperations,
  summarizeOperations,
} from '../src/services/offline/syncCore.js';
import { SYNC_ERROR, classifySyncError } from '../src/services/offline/errors.js';

// Deterministic jitter: random() === 0.5 makes the symmetric jitter term zero.
const noJitter = { random: () => 0.5 };

test('backoff grows exponentially and is capped', () => {
  assert.equal(computeBackoffMs(1, { baseMs: 1000, maxMs: 60000, ...noJitter }), 1000);
  assert.equal(computeBackoffMs(2, { baseMs: 1000, maxMs: 60000, ...noJitter }), 2000);
  assert.equal(computeBackoffMs(3, { baseMs: 1000, maxMs: 60000, ...noJitter }), 4000);
  assert.equal(computeBackoffMs(9, { baseMs: 1000, maxMs: 60000, ...noJitter }), 60000);
});

test('backoff jitter stays within +/- 25%', () => {
  const low = computeBackoffMs(3, { baseMs: 1000, maxMs: 60000, random: () => 0 });
  const high = computeBackoffMs(3, { baseMs: 1000, maxMs: 60000, random: () => 1 });
  assert.equal(low, 3000);
  assert.equal(high, 5000);
});

test('operations are ordered so a dependency is processed before its dependent', () => {
  const a = { opId: 'a', dependsOn: [], createdAt: 1 };
  const b = { opId: 'b', dependsOn: ['a'], createdAt: 2 };
  const c = { opId: 'c', dependsOn: [], createdAt: 3 };
  const all = new Map([a, b, c].map((op) => [op.opId, op]));
  const { ordered, deferred } = orderOperations([b, a, c], all);
  assert.deepEqual(
    ordered.map((op) => op.opId),
    ['a', 'b', 'c'],
  );
  assert.equal(deferred.length, 0);
});

test('a dependency cycle is deferred, never silently processed out of order', () => {
  const x = { opId: 'x', dependsOn: ['y'], createdAt: 1 };
  const y = { opId: 'y', dependsOn: ['x'], createdAt: 2 };
  const all = new Map([x, y].map((op) => [op.opId, op]));
  const { ordered, deferred } = orderOperations([x, y], all);
  assert.equal(ordered.length, 0);
  assert.equal(deferred.length, 2);
});

test('dependenciesSatisfied only passes once the dependency is synced', () => {
  const dependent = { opId: 'b', dependsOn: ['a'] };
  assert.equal(dependenciesSatisfied(dependent, new Map()), true); // missing => satisfied
  assert.equal(
    dependenciesSatisfied(dependent, new Map([['a', { opId: 'a', status: SYNC_STATE.PENDING }]])),
    false,
  );
  assert.equal(
    dependenciesSatisfied(dependent, new Map([['a', { opId: 'a', status: SYNC_STATE.SYNCED }]])),
    true,
  );
});

test('summarizeOperations reports counts plus failed and conflict detail', () => {
  const ops = [
    { opId: '1', entity: 'household', opType: 'create', status: 'pending' },
    { opId: '2', entity: 'household', opType: 'create', status: 'synced' },
    { opId: '3', entity: 'household', opType: 'update', status: 'failed', attempts: 2, lastError: { code: 'server', message: 'boom' } },
    { opId: '4', entity: 'household', opType: 'update', status: 'conflict', lastError: { code: 'conflict', message: 'stale' } },
  ];
  const summary = summarizeOperations(ops);
  assert.deepEqual(summary.counts, { pending: 1, syncing: 0, synced: 1, failed: 1, conflict: 1, total: 4 });
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.failed[0].message, 'boom');
  assert.equal(summary.conflicts.length, 1);
  assert.equal(summary.conflicts[0].message, 'stale');
});

test('sync errors are classified by HTTP status and transport failure', () => {
  assert.equal(classifySyncError({ status: 401 }).code, SYNC_ERROR.AUTH);
  assert.equal(classifySyncError({ status: 403 }).code, SYNC_ERROR.FORBIDDEN);
  assert.equal(classifySyncError({ status: 409 }).code, SYNC_ERROR.CONFLICT);
  assert.equal(classifySyncError({ status: 422 }).code, SYNC_ERROR.VALIDATION);
  assert.equal(classifySyncError({ status: 400 }).code, SYNC_ERROR.VALIDATION);
  assert.equal(classifySyncError({ status: 503 }).code, SYNC_ERROR.SERVER);
  assert.equal(classifySyncError(new TypeError('Failed to fetch')).code, SYNC_ERROR.NETWORK);
  assert.equal(classifySyncError(new Error('random')).code, SYNC_ERROR.UNKNOWN);
});

test('only network/server/unknown errors are retryable', () => {
  assert.equal(classifySyncError({ status: 503 }).retryable, true);
  assert.equal(classifySyncError(new TypeError('Failed to fetch')).retryable, true);
  assert.equal(classifySyncError({ status: 422 }).retryable, false);
  assert.equal(classifySyncError({ status: 409 }).retryable, false);
  assert.equal(classifySyncError({ status: 403 }).retryable, false);
});

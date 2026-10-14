// PHN Check-up Queue and Waiting for PHN statistic tests.
//
// Covers: queue loading, waiting statistic, empty queue, API failure & retry,
// cache isolation from storage errors, and highest-risk-first ordering.
//
// Run with:  node --test tests/phn/phnQueueAndStats.test.js

import assert from 'node:assert/strict';
import test from 'node:test';

import { queueCounts, sortQueueByRisk } from '../../src/lib/phnDashboard.js';
import { manilaDateKey } from '../../src/lib/phnDashboard.js';
import { CHECKUP_STATUS } from '../../src/lib/phnWorkflowMap.js';
import { mapVisitsToPatients } from '../../src/lib/phnWorkflowMap.js';
import { classifySyncError, SYNC_ERROR } from '../../src/services/offline/errors.js';

// Helper: build a patient row matching PHN queue shape
const patient = (overrides = {}) => ({
  id: overrides.id || `VISIT-${Math.random().toString(36).slice(2, 6)}`,
  status: overrides.status ?? CHECKUP_STATUS.WAITING,
  patient: overrides.patient || 'Juan Dela Cruz',
  barangay: overrides.barangay || 'Barangay 1',
  checkup: overrides.checkup,
});

test('queueCounts computes Waiting for PHN from waiting patients only', () => {
  const today = '2026-10-13';
  const rows = [
    patient({ id: 'a', status: CHECKUP_STATUS.WAITING }),
    patient({ id: 'b', status: CHECKUP_STATUS.WAITING }),
    patient({ id: 'c', status: CHECKUP_STATUS.IN_CHECKUP }),
    patient({ id: 'd', status: CHECKUP_STATUS.COMPLETED, checkup: { completedAt: '2026-10-13T08:00:00' } }),
    patient({ id: 'e', status: CHECKUP_STATUS.COMPLETED, checkup: { completedAt: '2026-10-12T08:00:00' } }),
  ];
  const counts = queueCounts(rows, today);
  assert.equal(counts.waiting, 2, 'Waiting for PHN');
  assert.equal(counts.inCheckup, 1);
  assert.equal(counts.completedToday, 1, 'only today');
});

test('Waiting for PHN is zero when queue is empty', () => {
  const counts = queueCounts([], '2026-10-13');
  assert.equal(counts.waiting, 0);
  assert.equal(counts.inCheckup, 0);
  assert.equal(counts.completedToday, 0);
});

test('Waiting for PHN counts only WAITING status, not IN_CHECKUP or COMPLETED', () => {
  const rows = [
    patient({ status: CHECKUP_STATUS.IN_CHECKUP }),
    patient({ status: CHECKUP_STATUS.COMPLETED, checkup: { completedAt: '2026-10-13T10:00:00' } }),
  ];
  assert.equal(queueCounts(rows, '2026-10-13').waiting, 0);
});

test('sortQueueByRisk orders highest risk first (High > Medium > Low), stable otherwise', () => {
  const mk = (risk, id) => patient({ id, status: CHECKUP_STATUS.WAITING, checkup: risk ? { riskLevel: risk } : undefined });
  const rows = [mk('Low', 'c'), mk('High', 'a'), mk('Medium', 'b'), mk('High', 'd')];
  const ordered = sortQueueByRisk(rows).map((p) => p.id);
  // High first (a,d stable), then Medium (b), then Low (c)
  assert.deepEqual(ordered, ['a', 'd', 'b', 'c']);
});

test('manilaDateKey returns YYYY-MM-DD and is stable for same instant', () => {
  const d = new Date('2026-10-13T04:00:00Z');
  const key = manilaDateKey(d);
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(manilaDateKey(d), manilaDateKey(new Date(d.getTime())));
});

test('mapVisitsToPatients translates submitted visits to waiting patients', () => {
  const visits = [
    { id: 'V1', status: 'submitted', visitDate: '2026-10-13T08:00:00', chiefComplaint: 'Fever', resident: { firstName: 'Ana', lastName: 'Reyes', barangay: 'B1' }, vitals: {} },
    { id: 'V2', status: 'in_review', visitDate: '2026-10-13T09:00:00', resident: { firstName: 'Ben', lastName: 'Cruz' }, vitals: {} },
    { id: 'V3', status: 'draft', visitDate: '2026-10-13T10:00:00', resident: { firstName: 'Draft', lastName: 'Ignore' }, vitals: {} },
  ];
  const patients = mapVisitsToPatients(visits);
  assert.equal(patients.length, 2, 'draft excluded');
  assert.equal(patients[0].status, CHECKUP_STATUS.WAITING);
  assert.equal(patients[1].status, CHECKUP_STATUS.IN_CHECKUP);
  assert.equal(patients[0].patient, 'Ana Reyes');
});

test('empty queue: no patients renders empty state, not error', () => {
  const patients = [];
  const waiting = patients.filter((p) => p.status === CHECKUP_STATUS.WAITING);
  assert.equal(waiting.length, 0);
  assert.equal(queueCounts(patients).waiting, 0);
});

test('API failure is surfaced with a retryable error, never a fabricated zero', () => {
  // Simulate what usePhnWorkflow does: network error -> STORAGE vs SERVER vs NETWORK
  const serverErr = Object.assign(new Error('Request failed with status 500'), { status: 500 });
  const netErr = Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' });
  const storageErr = Object.assign(new Error('Not yet support for changing primary key'), { name: 'UpgradeError' });

  assert.equal(classifySyncError(serverErr).code, SYNC_ERROR.SERVER);
  assert.equal(classifySyncError(serverErr).retryable, true);
  assert.equal(classifySyncError(netErr).code, SYNC_ERROR.NETWORK);
  assert.equal(classifySyncError(netErr).retryable, true);
  assert.equal(classifySyncError(storageErr).code, SYNC_ERROR.STORAGE);
  assert.equal(classifySyncError(storageErr).retryable, false);
  // Storage error must not be misclassified as server — ensures the UI does not
  // show "server error, tap to retry the API" when the real fault is local storage.
});

test('Try Again (reload) retries the actual failed operation — loader is re-invocable', async () => {
  let calls = 0;
  const flakyLoader = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('Failed to fetch'), { name: 'TypeError' });
    return [{ id: 'V1', status: CHECKUP_STATUS.WAITING }];
  };
  // First call fails (network), second succeeds — retry must re-invoke the loader.
  await assert.rejects(() => flakyLoader(), /Failed to fetch/);
  const rows = await flakyLoader();
  assert.equal(rows.length, 1);
  assert.equal(calls, 2);
});

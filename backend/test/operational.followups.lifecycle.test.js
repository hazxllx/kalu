import test from 'node:test';
import assert from 'node:assert/strict';

import { assertFollowUpTransition, manilaDateString } from '../src/services/operational.service.js';

/**
 * Follow-up lifecycle guard tests (issue #2 / #3).
 *
 * These exercise the pure, server-authoritative transition guard that blocks
 * the impossible statuses seen in the evidence: a future-dated follow-up being
 * marked Completed, and Pending/Rejected/Cancelled/Missed follow-ups jumping to
 * Completed. The date comparison is anchored on the Philippine calendar date.
 */

// A fixed "today" so the tests are deterministic regardless of the run clock.
const TODAY = '2026-09-27';
const at = (status, over = {}) => ({ status, scheduled_date: '2026-09-27', ...over });

test('manilaDateString returns the Asia/Manila (UTC+8) calendar date', () => {
  // 2026-09-27T18:00:00Z is already 2026-09-28 02:00 in Manila.
  assert.equal(manilaDateString(new Date('2026-09-27T18:00:00Z')), '2026-09-28');
  // 2026-09-27T10:00:00Z is 2026-09-27 18:00 in Manila (same day).
  assert.equal(manilaDateString(new Date('2026-09-27T10:00:00Z')), '2026-09-27');
});

test('a no-op (same status or no status) always passes', () => {
  assert.doesNotThrow(() => assertFollowUpTransition(at('Scheduled'), 'Scheduled', { today: TODAY }));
  assert.doesNotThrow(() => assertFollowUpTransition(at('Completed'), undefined, { today: TODAY }));
  assert.doesNotThrow(() => assertFollowUpTransition(at('Completed'), '', { today: TODAY }));
});

test('a follow-up scheduled in the FUTURE cannot be completed (the core bug)', () => {
  const future = at('Scheduled', { scheduled_date: '2026-10-22' });
  assert.throws(
    () => assertFollowUpTransition(future, 'Completed', { today: TODAY }),
    (e) => e.statusCode === 422 && /cannot be marked Completed before/i.test(e.message),
  );
});

test('a follow-up scheduled today or in the past may be completed', () => {
  assert.doesNotThrow(() => assertFollowUpTransition(at('Scheduled', { scheduled_date: TODAY }), 'Completed', { today: TODAY }));
  assert.doesNotThrow(() => assertFollowUpTransition(at('Scheduled', { scheduled_date: '2026-09-01' }), 'Completed', { today: TODAY }));
  // 'Today' / 'Upcoming' are legacy scheduled-like statuses; past-dated ones complete fine.
  assert.doesNotThrow(() => assertFollowUpTransition(at('Today', { scheduled_date: '2026-09-20' }), 'Completed', { today: TODAY }));
});

test('Pending -> Completed is blocked (409)', () => {
  assert.throws(
    () => assertFollowUpTransition(at('Pending', { scheduled_date: '2026-09-01' }), 'Completed', { today: TODAY }),
    (e) => e.statusCode === 409,
  );
});

test('Rejected / Cancelled -> Completed is blocked (terminal)', () => {
  assert.throws(
    () => assertFollowUpTransition(at('Cancelled', { scheduled_date: '2026-09-01' }), 'Completed', { today: TODAY }),
    (e) => e.statusCode === 409,
  );
  assert.throws(
    () => assertFollowUpTransition(at('Rejected', { scheduled_date: '2026-09-01' }), 'Completed', { today: TODAY }),
    (e) => e.statusCode === 409,
  );
});

test('Missed -> Completed is blocked; a missed follow-up must be rescheduled first', () => {
  assert.throws(
    () => assertFollowUpTransition(at('Missed', { scheduled_date: '2026-09-01' }), 'Completed', { today: TODAY }),
    (e) => e.statusCode === 409,
  );
  // But a Missed follow-up can be rescheduled.
  assert.doesNotThrow(() => assertFollowUpTransition(at('Missed'), 'Scheduled', { today: TODAY }));
});

test('a follow-up awaiting resident confirmation cannot be completed even if past-dated', () => {
  const awaiting = at('Scheduled', {
    scheduled_date: '2026-09-01',
    requires_resident_response: true,
    resident_decision: 'pending',
  });
  assert.throws(
    () => assertFollowUpTransition(awaiting, 'Completed', { today: TODAY }),
    (e) => e.statusCode === 409 && /awaiting/i.test(e.message),
  );
});

test('an approved (resident-confirmed) past-dated follow-up can be completed', () => {
  const approved = at('Scheduled', {
    scheduled_date: '2026-09-01',
    requires_resident_response: true,
    resident_decision: 'approved',
  });
  assert.doesNotThrow(() => assertFollowUpTransition(approved, 'Completed', { today: TODAY }));
});

test('a terminal (Completed) follow-up cannot be moved to another status', () => {
  assert.throws(
    () => assertFollowUpTransition(at('Completed'), 'Missed', { today: TODAY }),
    (e) => e.statusCode === 409,
  );
});

test('non-completion transitions from a scheduled state are allowed', () => {
  assert.doesNotThrow(() => assertFollowUpTransition(at('Scheduled'), 'Missed', { today: TODAY }));
  assert.doesNotThrow(() => assertFollowUpTransition(at('Scheduled'), 'Cancelled', { today: TODAY }));
  assert.doesNotThrow(() => assertFollowUpTransition(at('Scheduled'), 'Ongoing', { today: TODAY }));
});

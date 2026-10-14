import assert from 'node:assert/strict';
import test from 'node:test';

import { assertFollowUpTransition } from '../src/services/operational.service.js';

const TODAY = '2026-10-15';

test('a future follow-up cannot be marked Missed', () => {
  assert.throws(
    () => assertFollowUpTransition(
      { status: 'Scheduled', scheduled_date: '2026-10-16' },
      'Missed',
      { today: TODAY },
    ),
    { statusCode: 422 },
  );
});

test('due follow-ups can be marked Missed but pending confirmations cannot', () => {
  assert.doesNotThrow(() => assertFollowUpTransition(
    { status: 'Ongoing', scheduled_date: TODAY },
    'Missed',
    { today: TODAY },
  ));
  assert.throws(
    () => assertFollowUpTransition(
      { status: 'Pending', scheduled_date: TODAY },
      'Missed',
      { today: TODAY },
    ),
    { statusCode: 409 },
  );
});

test('completed and cancelled follow-ups remain terminal', () => {
  for (const status of ['Completed', 'Cancelled']) {
    assert.throws(
      () => assertFollowUpTransition(
        { status, scheduled_date: TODAY },
        'Missed',
        { today: TODAY },
      ),
      { statusCode: 409 },
    );
  }
});

test('a missed follow-up must be rescheduled before it can be marked ongoing', () => {
  assert.throws(
    () => assertFollowUpTransition(
      { status: 'Missed', scheduled_date: TODAY },
      'Ongoing',
      { today: TODAY },
    ),
    { statusCode: 409 },
  );
  assert.doesNotThrow(() => assertFollowUpTransition(
    { status: 'Missed', scheduled_date: TODAY },
    'Scheduled',
    { today: TODAY },
  ));
});

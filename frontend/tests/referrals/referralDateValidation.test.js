import assert from 'node:assert/strict';
import test from 'node:test';
import {
  localDateKey,
  localDateTimeToIso,
  referralDateErrors,
  referralDateTimeMinimum,
  toLocalDateTimeInput,
} from "../../src/features/referrals/lib/referralDateValidation.js";

test("referral dates use the Asia/Manila calendar day and reject future referral dates", () => {
  const now = new Date('2026-10-20T02:00:00.000Z'); // 10:00 in Manila
  assert.equal(localDateKey(now), '2026-10-20');
  assert.deepEqual(referralDateErrors({ referralDate: '2026-10-19', scheduledAt: '' }, { now }), {});
  assert.deepEqual(referralDateErrors({ referralDate: '2026-10-20', scheduledAt: '' }, { now }), {});
  assert.equal(referralDateErrors({ referralDate: '2026-10-21', scheduledAt: '' }, { now }).referralDate,
    'Referral date cannot be later than today.');
});

test("scheduled referral times reject yesterday, past time and the current time", () => {
  const now = new Date('2026-10-20T02:00:00.000Z'); // 10:00 in Manila
  for (const scheduledAt of ['2026-10-19T10:00', '2026-10-20T09:59', '2026-10-20T10:00']) {
    assert.equal(referralDateErrors({ referralDate: '2026-10-20', scheduledAt }, { now }).scheduledAt,
      'Scheduled date and time cannot be in the past.');
  }
});

test("a future time today and future date are valid and convert using +08:00", () => {
  const now = new Date('2026-10-20T02:00:00.000Z');
  assert.deepEqual(referralDateErrors({ referralDate: '2026-10-20', scheduledAt: '2026-10-20T10:01' }, { now }), {});
  assert.deepEqual(referralDateErrors({ referralDate: '2026-10-20', scheduledAt: '2026-10-21T09:00' }, { now }), {});
  assert.equal(localDateTimeToIso('2026-10-20T10:01'), '2026-10-20T10:01:00+08:00');
  assert.equal(toLocalDateTimeInput('2026-10-20T02:00:00.000Z'), '2026-10-20T10:00');
  assert.equal(referralDateTimeMinimum(new Date('2026-10-20T02:00:59.000Z')), '2026-10-20T10:01');
});

test("unchanged historical schedules remain editable but changed past schedules do not", () => {
  const now = new Date('2026-10-20T02:00:00.000Z');
  const historical = '2026-10-19T10:00';
  assert.deepEqual(referralDateErrors(
    { referralDate: '2026-10-19', scheduledAt: historical },
    { now, originalScheduledAt: historical },
  ), {});
  assert.equal(referralDateErrors(
    { referralDate: '2026-10-19', scheduledAt: '2026-10-19T10:01' },
    { now, originalScheduledAt: historical },
  ).scheduledAt, 'Scheduled date and time cannot be in the past.');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertReferralDates } from '../src/services/referrals.service.js';

const now = new Date('2026-10-15T04:30:00.000Z');

test('backend referral date validation compares the referral date in the user timezone', () => {
  assert.doesNotThrow(() => assertReferralDates({
    referral_date: '2026-10-15',
    client_time_zone: 'Asia/Manila',
  }, { now }));
  assert.throws(() => assertReferralDates({
    referral_date: '2026-10-16',
    client_time_zone: 'Asia/Manila',
  }, { now }), /Referral date cannot be later than today/);
  assert.throws(() => assertReferralDates({
    referral_date: '2026-10-16',
    client_time_zone: 'UTC',
  }, { now }), /Referral date cannot be later than today/);
});

test('backend rejects yesterday, earlier today and the exact current time', () => {
  for (const scheduledAt of [
    '2026-10-14T05:00:00.000Z',
    '2026-10-15T04:29:00.000Z',
    '2026-10-15T04:30:00.000Z',
  ]) {
    assert.throws(() => assertReferralDates({ scheduled_at: scheduledAt }, { now }), /Scheduled date and time cannot be in the past/);
  }
});

test('backend accepts a future time today or a future date', () => {
  assert.doesNotThrow(() => assertReferralDates({ scheduled_at: '2026-10-15T04:31:00.000Z' }, { now }));
  assert.doesNotThrow(() => assertReferralDates({ scheduled_at: '2026-10-16T00:00:00.000Z' }, { now }));
});

test('an unchanged historical schedule is allowed on edit, but malformed timestamps are rejected', () => {
  const saved = { scheduled_at: '2026-10-14T05:00:00.000Z' };
  assert.doesNotThrow(() => assertReferralDates(
    { scheduled_at: '2026-10-14T05:00:00.000Z' },
    { existing: saved, now },
  ));
  assert.throws(() => assertReferralDates({ scheduled_at: '2026-10-15T04:29' }, { now }), /valid scheduled date and time/);
  assert.throws(() => assertReferralDates({ scheduled_at: '2026-02-31T04:29:00.000Z' }, { now }), /valid scheduled date and time/);
});

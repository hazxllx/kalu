import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toLocalISODate,
  todayISODate,
  startOfYearISODate,
  currentYear,
  formatLongDate,
  formatShortDate,
  formatDateRange,
} from '../src/lib/dateUtils.js';
import { followUpDisplayStatus, isCalendarVisibleFollowUp } from '../src/features/follow-ups/lib/scheduleDates.js';

// These tests lock the date-only behaviour that the PHN analytics screens rely
// on. The core guarantee is that a LOCAL calendar day is never shifted to the
// previous day (or previous year) by a UTC conversion — the defect that made
// the Health Heatmap default start date render as "2025-12-31" while the app
// was operating in 2026.

test('toLocalISODate uses local calendar components, not UTC', () => {
  // Local Jan 1, 2026 must serialise to 2026-01-01 in EVERY timezone. The old
  // implementation (toISOString().slice(0,10)) returned "2025-12-31" east of
  // UTC because local midnight is the previous day in UTC.
  assert.equal(toLocalISODate(new Date(2026, 0, 1)), '2026-01-01');
});

test('current-year default start date is January 1 of the current year', () => {
  // Mirror the heatmap "This Year" preset: start = local Jan 1 of this year.
  const start = toLocalISODate(new Date(new Date().getFullYear(), 0, 1));
  assert.equal(start, startOfYearISODate());
  assert.match(start, /-01-01$/);
});

test('the default start date never lands on the previous year', () => {
  const year = new Date().getFullYear();
  const start = toLocalISODate(new Date(year, 0, 1));
  assert.equal(start.slice(0, 4), String(year));
  assert.notEqual(start.slice(0, 4), String(year - 1));
});

test('todayISODate returns the local calendar day', () => {
  const now = new Date();
  const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.equal(todayISODate(now), expected);
});

test('startOfYearISODate and currentYear are dynamic (not hardcoded)', () => {
  const y2026 = new Date(2026, 5, 15);
  assert.equal(startOfYearISODate(y2026), '2026-01-01');
  assert.equal(currentYear(y2026), 2026);
  const y2031 = new Date(2031, 0, 2);
  assert.equal(startOfYearISODate(y2031), '2031-01-01');
  assert.equal(currentYear(y2031), 2031);
});

test('formatLongDate produces a readable label', () => {
  assert.equal(formatLongDate('2026-09-27'), 'September 27, 2026');
  assert.equal(formatLongDate('2026-01-01'), 'January 1, 2026');
});

test('formatShortDate produces a compact label', () => {
  assert.equal(formatShortDate('2026-09-27'), 'Sep 27, 2026');
  assert.equal(formatShortDate('2026-01-01'), 'Jan 1, 2026');
});

test('date-only strings are not shifted a day by parsing', () => {
  // "YYYY-MM-DD" is parsed from components as a local day, so the displayed day
  // matches the stored day regardless of timezone.
  assert.equal(formatShortDate('2026-09-27'), 'Sep 27, 2026');
  assert.equal(formatLongDate('2026-09-27'), 'September 27, 2026');
});

test('formatDateRange renders a compact range with an en dash', () => {
  assert.equal(formatDateRange('2026-01-01', '2026-09-27'), 'Jan 1, 2026 \u2013 Sep 27, 2026');
});

test('formatDateRange degrades gracefully with a single bound', () => {
  assert.equal(formatDateRange('2026-01-01', ''), 'From Jan 1, 2026');
  assert.equal(formatDateRange('', '2026-09-27'), 'Until Sep 27, 2026');
  assert.equal(formatDateRange('', ''), '');
});

test('legitimate historical dates are preserved unchanged', () => {
  // A genuine 2025 record must still render as 2025 — the fix must not rewrite
  // historical data.
  assert.equal(formatShortDate('2025-03-15'), 'Mar 15, 2025');
  assert.equal(formatLongDate('2025-12-31'), 'December 31, 2025');
  assert.equal(toLocalISODate(new Date(2025, 11, 31)), '2025-12-31');
});

test('follow-up display status uses the Philippine date without UTC day shifts', () => {
  const justAfterPhilippineMidnight = new Date('2026-09-29T18:00:00.000Z');
  assert.equal(followUpDisplayStatus('Scheduled', '2026-09-27', justAfterPhilippineMidnight), 'Overdue');
  assert.equal(followUpDisplayStatus('Scheduled', '2026-09-30', justAfterPhilippineMidnight), 'Today');
  assert.equal(followUpDisplayStatus('Scheduled', '2026-10-01', justAfterPhilippineMidnight), 'Scheduled');
  assert.equal(followUpDisplayStatus('Completed', '2026-09-27', justAfterPhilippineMidnight), 'Completed');
  assert.equal(followUpDisplayStatus('Cancelled', '2026-09-27', justAfterPhilippineMidnight), 'Cancelled');
});

test('only confirmed response-required follow-ups appear on the resident calendar', () => {
  assert.equal(isCalendarVisibleFollowUp({ requiresResidentResponse: true, confirmationStatus: 'Awaiting Confirmation' }), false);
  assert.equal(isCalendarVisibleFollowUp({ requiresResidentResponse: true, confirmationStatus: 'Confirmed' }), true);
  assert.equal(isCalendarVisibleFollowUp({ requiresResidentResponse: false, confirmationStatus: null }), true);
});

test('invalid or empty input yields an empty string', () => {
  assert.equal(formatLongDate(''), '');
  assert.equal(formatShortDate(null), '');
  assert.equal(formatLongDate('not-a-date'), '');
});

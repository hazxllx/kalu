import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('P0-4: FollowUpStatusBadge and PriorityBadge define status/priority badge components and tone maps', () => {
  const statusSrc = fs.readFileSync(
    path.resolve('src/features/follow-ups/components/FollowUpStatusBadge.jsx'),
    'utf8',
  );
  const prioritySrc = fs.readFileSync(
    path.resolve('src/features/follow-ups/components/PriorityBadge.jsx'),
    'utf8',
  );

  for (const status of ['Scheduled', 'Pending', 'Completed', 'Cancelled', 'Overdue', 'Today', 'Upcoming', 'Ongoing', 'Missed']) {
    assert.match(statusSrc, new RegExp(`\\b${status}:`), `Missing status tone/dot entry for ${status}`);
  }
  assert.match(statusSrc, /export const STATUS_TONES\b/);
  assert.match(statusSrc, /export const STATUS_DOTS\b/);
  for (const priority of ['Low', 'Medium', 'High']) {
    assert.match(prioritySrc, new RegExp(`\\b${priority}:`), `Missing priority tone/dot entry for ${priority}`);
  }
});

test('P0-4: MidwifeFollowUp has no undefined STATUS_COLORS or PRIORITY_COLORS references and uses badge components', () => {
  const src = fs.readFileSync(
    path.resolve('src/features/follow-ups/pages/MidwifeFollowUp.jsx'),
    'utf8',
  );
  assert.doesNotMatch(src, /\bSTATUS_COLORS\b/);
  assert.doesNotMatch(src, /\bPRIORITY_COLORS\b/);
  assert.match(src, /import FollowUpStatusBadge, \{ STATUS_DOTS \} from/);
  assert.match(src, /<FollowUpStatusBadge\s+value=\{deriveStatus\(scheduleForm\.date\)\}/);
  assert.match(src, /<PriorityBadge\s+value=\{selectedFollowUp\.priority\}\s*\/>/);
  assert.match(src, /<FollowUpStatusBadge\s+value=\{selectedFollowUp\.status\}\s*\/>/);
  assert.match(src, /STATUS_DOTS\[status\]/);
});

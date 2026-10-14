import assert from 'node:assert/strict';
import test from 'node:test';

import { followUpPermission } from '../src/routes/operational.routes.js';

const requestFor = (body) => ({
  params: { kind: 'followups' },
  body,
});

test('wrapped Completed and Missed updates require follow-up completion permission', () => {
  const permission = followUpPermission('PUT');

  assert.deepEqual(permission(requestFor({ record: { status: 'Completed' } })), ['followups.complete']);
  assert.deepEqual(permission(requestFor({ record: { status: 'Missed' } })), ['followups.complete']);
});

test('nonterminal follow-up edits continue to require edit permission', () => {
  const permission = followUpPermission('PUT');

  assert.deepEqual(permission(requestFor({ record: { status: 'Ongoing' } })), ['followups.edit']);
  assert.deepEqual(permission(requestFor({ record: { notes: 'Visit recorded' } })), ['followups.edit']);
});

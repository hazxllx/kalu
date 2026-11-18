import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { completePhnHealthRecordCheckup } from '../../src/features/health-records/lib/phnRecords.js';

test('P0-6: completePhnHealthRecordCheckup persists recorded checkup and refreshes records and queue', async () => {
  const calls = [];
  const recorded = {
    assessment: 'Controlled hypertension',
    healthConcern: 'Hypertension',
    clinicalNotes: 'BP 125/80',
    recommendations: 'Continue maintenance',
    medications: [],
  };

  await completePhnHealthRecordCheckup({
    checkup: { id: 'sub-777' },
    recorded,
    completeCheckup: async (id, payload) => {
      calls.push(['complete', id, payload]);
    },
    refreshRecords: async () => {
      calls.push(['refreshRecords']);
    },
    refreshQueue: async () => {
      calls.push(['refreshQueue']);
    },
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], ['complete', 'sub-777', recorded]);
  assert.deepEqual(calls[1], ['refreshRecords']);
  assert.deepEqual(calls[2], ['refreshQueue']);
});

test('P0-6: completePhnHealthRecordCheckup propagates server failures without silently calling refreshes', async () => {
  let refreshed = false;
  await assert.rejects(
    () => completePhnHealthRecordCheckup({
      checkup: { id: 'sub-777' },
      recorded: { assessment: 'x' },
      completeCheckup: async () => {
        throw new Error('500 Server Error');
      },
      refreshRecords: async () => { refreshed = true; },
      refreshQueue: async () => { refreshed = true; },
    }),
    /500 Server Error/,
  );
  assert.equal(refreshed, false);
});

test('P0-6: PhnHealthRecords passes onComplete (never nonexistent onSaved) to PhnCheckupWorkbench', () => {
  const src = fs.readFileSync(
    path.resolve('src/features/health-records/pages/PhnHealthRecords.jsx'),
    'utf8',
  );
  assert.doesNotMatch(src, /<PhnCheckupWorkbench[\s\S]*?onSaved=/);
  assert.doesNotMatch(src, /<PhnCheckupWorkbench[\s\S]*?patientId=/);
  assert.match(src, /<PhnCheckupWorkbench[\s\S]*?onComplete=\{handleCompleteCheckup\}/);
});

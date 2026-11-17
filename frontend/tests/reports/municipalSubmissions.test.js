import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  canReviewSubmission,
  reportGroup,
  requiresReviewRemarks,
  reviewPersistedReport,
  submissionFromReport,
} from '../../src/features/submissions/lib/municipalReports.js';

test('P0-5: submissionFromReport maps reportPeriod, senderName, and classifies Other category cleanly', () => {
  const row = submissionFromReport({
    id: 'rep-100',
    reportType: 'Sanitation Inspection Summary',
    reportPeriod: '2026-06',
    senderName: 'BHW Santos',
    createdBy: 'uid-bhw-1',
    submittedAt: '2026-06-30T10:00:00Z',
    status: 'Submitted',
  });
  assert.equal(row.period, '2026-06');
  assert.equal(row.creator, 'BHW Santos');
  assert.equal(row.group, 'Other');
  assert.equal(reportGroup('FHSIS M1 Monthly Report'), 'M1');
  assert.equal(reportGroup('Target Client List'), 'TCL');
});

test('P0-5: MHO recipient review permission checks reports.view (not nonexistent reports.review) and self-review is blocked', () => {
  const report = {
    id: 'rep-101',
    recipientRole: 'mho',
    createdBy: 'uid-phn-1',
    status: 'Received',
  };
  const mhoUser = { id: 'uid-mho-1', role: 'mho' };
  const can = (perm) => perm === 'reports.view';

  assert.equal(
    canReviewSubmission({ report, user: mhoUser, can, transitions: ['Reviewed', 'Needs Revision', 'Rejected'] }),
    true,
  );
  // Same user as creator -> denied
  assert.equal(
    canReviewSubmission({ report, user: { id: 'uid-phn-1', role: 'mho' }, can, transitions: ['Reviewed'] }),
    false,
  );
  // Different recipient role (PHN viewing an MHO report) -> oversight only
  assert.equal(
    canReviewSubmission({ report, user: { id: 'uid-phn-2', role: 'phn' }, can, transitions: ['Reviewed'] }),
    false,
  );
  // Terminal status (no transitions) -> denied
  assert.equal(
    canReviewSubmission({ report, user: mhoUser, can, transitions: [] }),
    false,
  );
});

test('P0-5: reviewPersistedReport persists MHO review and rejection decisions and requires remarks for Needs Revision / Rejected', async () => {
  assert.equal(requiresReviewRemarks('Received'), false);
  assert.equal(requiresReviewRemarks('Reviewed'), false);
  assert.equal(requiresReviewRemarks('Needs Revision'), true);
  assert.equal(requiresReviewRemarks('Rejected'), true);

  const calls = [];
  const fakeReview = async (id, payload) => {
    calls.push({ id, payload });
    return { record: { id, status: payload.status, remarks: payload.remarks } };
  };

  const reviewed = await reviewPersistedReport({
    report: { id: 'rep-200' },
    status: 'Reviewed',
    remarks: 'Verified complete',
    review: fakeReview,
  });
  assert.equal(reviewed.status, 'Reviewed');

  const rejected = await reviewPersistedReport({
    report: { id: 'rep-200' },
    status: 'Rejected',
    remarks: 'Missing barangay signature',
    review: fakeReview,
  });
  assert.equal(rejected.status, 'Rejected');
  assert.equal(calls.length, 2);
});

test('P0-5: MunicipalSubmissions renders Reviewed stat, Other tab, event.explanation, and removes reports.review & Accepted', () => {
  const src = fs.readFileSync(
    path.resolve('src/features/submissions/pages/MunicipalSubmissions.jsx'),
    'utf8',
  );
  assert.doesNotMatch(src, /reports\.review/);
  assert.doesNotMatch(src, /"Accepted"/);
  assert.match(src, /"Reviewed"/);
  assert.match(src, /"Other"/);
  assert.match(src, /event\.explanation/);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import * as submissions from '../src/services/municipalSubmissions.service.js';

/**
 * BUG-010 — MHO municipal submission review decisions are persisted in the
 * database, MHO-only, and municipality-bound from the authenticated profile.
 * Uses an in-memory stub of public.municipal_submission_reviews.
 */

const makeStub = () => {
  const rows = [];
  return {
    _rows: rows,
    from() {
      const q = {
        _eq: {},
        _row: null,
        select() { return this; },
        eq(col, val) { this._eq[col] = val; return this; },
        order() {
          const filtered = rows.filter((r) => Object.entries(this._eq).every(([k, v]) => r[k] === v));
          return Promise.resolve({ data: filtered, error: null });
        },
        maybeSingle() {
          const found = rows.find((r) => Object.entries(this._eq).every(([k, v]) => r[k] === v));
          return Promise.resolve({ data: found || null, error: null });
        },
        upsert(row) {
          const i = rows.findIndex((r) => r.municipality_id === row.municipality_id && r.submission_ref === row.submission_ref);
          const merged = { id: row.id || `rev-${rows.length + 1}`, ...(i >= 0 ? rows[i] : {}), ...row };
          if (i >= 0) rows[i] = merged; else rows.push(merged);
          this._row = merged;
          return this;
        },
        single() { return Promise.resolve({ data: this._row, error: null }); },
      };
      return q;
    },
  };
};

const MHO = { id: 'mho-1', role: 'mho', name: 'Dr MHO', municipalityId: 'mun-1' };
const MHO2 = { id: 'mho-2', role: 'mho', name: 'Dr Other', municipalityId: 'mun-2' };
const PHN = { id: 'phn-1', role: 'phn', municipalityId: 'mun-1' };

test('BUG-010: an MHO can persist a review decision (municipality bound from session)', async () => {
  const supabase = makeStub();
  const review = await submissions.reviewSubmission({
    user: MHO, supabase,
    submissionRef: 'TCL-2026-001', submissionType: 'TCL', period: 'September 2026',
    decision: 'reviewed', notes: 'Looks complete',
    // A malicious client municipality is irrelevant — it is never read.
  });
  assert.equal(review.status, 'Reviewed');
  assert.equal(review.reviewStatus, 'Reviewed');
  assert.equal(review.audit.length, 1);
  assert.equal(supabase._rows[0].municipality_id, 'mun-1');
});

test('BUG-010: a non-MHO cannot review (403)', async () => {
  const supabase = makeStub();
  await assert.rejects(
    () => submissions.reviewSubmission({ user: PHN, supabase, submissionRef: 'TCL-1', decision: 'reviewed' }),
    (e) => e.statusCode === 403,
  );
});

test('BUG-010: an unknown decision is rejected (400)', async () => {
  const supabase = makeStub();
  await assert.rejects(
    () => submissions.reviewSubmission({ user: MHO, supabase, submissionRef: 'TCL-1', decision: 'nonsense' }),
    (e) => e.statusCode === 400,
  );
});

test('BUG-010: re-reviewing appends to the audit trail and updates status', async () => {
  const supabase = makeStub();
  await submissions.reviewSubmission({ user: MHO, supabase, submissionRef: 'M1-1', decision: 'under-review' });
  const second = await submissions.reviewSubmission({ user: MHO, supabase, submissionRef: 'M1-1', decision: 'returned', notes: 'Fix totals' });
  assert.equal(second.status, 'Returned');
  assert.equal(second.audit.length, 2);
});

test('BUG-010: reviews are listed only for the caller municipality', async () => {
  const supabase = makeStub();
  await submissions.reviewSubmission({ user: MHO, supabase, submissionRef: 'TCL-A', decision: 'reviewed' });
  await submissions.reviewSubmission({ user: MHO2, supabase, submissionRef: 'TCL-B', decision: 'reviewed' });
  const forMun1 = await submissions.listReviews({ user: MHO, supabase });
  assert.equal(forMun1.length, 1);
  assert.equal(forMun1[0].submissionRef, 'TCL-A');
});

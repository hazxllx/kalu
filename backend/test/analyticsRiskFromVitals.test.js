import assert from 'node:assert/strict';
import test from 'node:test';

import { riskFromVitals } from '../src/services/analytics.service.js';

// Issue 12A — Early-Warning analytics must NOT count a visit with missing /
// insufficient vitals as Low Risk. riskFromVitals returns null (Unassessed) so
// callers can bucket it separately, consistent with the resident service.

test('empty vitals are UNASSESSED (null), not Low', () => {
  assert.equal(riskFromVitals({}), null);
  assert.equal(riskFromVitals(undefined), null);
  assert.equal(riskFromVitals({ bp: '', o2sat: null, temperature: null }), null);
});

test('a valid elevated reading classifies normally', () => {
  // systolic 145 → High per the default resident-risk criteria.
  assert.equal(riskFromVitals({ bp: '145/95' }), 'High');
});

test('a partially populated but assessable record is classified, not null', () => {
  // Only O2 sat present and low → assessable (High by default criteria).
  assert.equal(riskFromVitals({ o2sat: 90 }), 'High');
});

test('a normal low-risk reading classifies as Low (not null)', () => {
  // Normal systolic + normal O2 → score 0 → Low (this IS assessable).
  assert.equal(riskFromVitals({ bp: '118/76', o2sat: 98 }), 'Low');
});

test('an invalid/garbage BP with no other vitals is UNASSESSED (null)', () => {
  assert.equal(riskFromVitals({ bp: 'not-a-reading' }), null);
});

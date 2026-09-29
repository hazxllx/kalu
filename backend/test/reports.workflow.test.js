import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as reports from '../src/services/reports.service.js';

/**
 * Report submission workflow tests.
 *
 * Reports are ROLE-ROUTED and persisted: a PHN report reaches the MHO, a Health
 * Supervisor report reaches the RHU, the sender cannot review their own report,
 * and reports never leak across municipalities/roles. The Supabase client is an
 * in-memory stub so no live database is required.
 */

const PHN = { id: 'phn-1', role: 'phn', municipalityId: 'mun-1' };
const MHO = { id: 'mho-1', role: 'mho', municipalityId: 'mun-1' };
const MHO_OTHER = { id: 'mho-2', role: 'mho', municipalityId: 'mun-2' };
const RHU = { id: 'rhu-1', role: 'rhu_personnel', municipalityId: 'mun-1' };
const HS = { id: 'hs-1', role: 'health_supervisor', municipalityId: 'mun-1', barangayId: 'brgy-1' };

let store; // reports rows
let profiles;

const matches = (row, filters) =>
  filters.eq.every(([c, v]) => row[c] === v) && filters.neq.every(([c, v]) => row[c] !== v);

const makeBuilder = (table) => {
  const state = { table, op: 'select', payload: null, filters: { eq: [], neq: [] } };
  const rowsFor = () => (table === 'reports' ? store : table === 'profiles' ? profiles : []);
  const applied = () => rowsFor().filter((r) => matches(r, state.filters));
  const builder = {
    select() { return this; },
    insert(payload) { state.op = 'insert'; state.payload = payload; return this; },
    update(payload) { state.op = 'update'; state.payload = payload; return this; },
    eq(c, v) { state.filters.eq.push([c, v]); return this; },
    neq(c, v) { state.filters.neq.push([c, v]); return this; },
    order() { return this; },
    limit() { return this; },
    like() { return this; },
    maybeSingle() { return Promise.resolve({ data: applied()[0] || null, error: null }); },
    single() {
      if (state.op === 'insert') {
        const row = { id: `rep-${store.length + 1}`, created_at: new Date().toISOString(), ...state.payload };
        store.push(row);
        return Promise.resolve({ data: row, error: null });
      }
      if (state.op === 'update') {
        const target = applied()[0];
        if (target) Object.assign(target, state.payload);
        return Promise.resolve({ data: target, error: null });
      }
      return Promise.resolve({ data: applied()[0] || null, error: null });
    },
    then(resolve) {
      if (state.op === 'insert') {
        const row = { id: `rep-${store.length + 1}`, created_at: new Date().toISOString(), ...state.payload };
        store.push(row);
        return resolve({ data: [row], error: null });
      }
      return resolve({ data: applied(), error: null });
    },
  };
  return builder;
};

const supabase = { from: (table) => makeBuilder(table) };

beforeEach(() => {
  store = [];
  profiles = [
    { id: 'mho-1', role: 'mho', status: 'active', municipality_id: 'mun-1' },
    { id: 'rhu-1', role: 'rhu_personnel', status: 'active', municipality_id: 'mun-1' },
  ];
});

test('resolveRecipientRole routes each sender correctly and rejects bad routes', () => {
  assert.equal(reports.resolveRecipientRole('phn'), 'mho');
  assert.equal(reports.resolveRecipientRole('health_supervisor'), 'rhu_personnel');
  assert.equal(reports.resolveRecipientRole('rhu_personnel'), 'mho');
  // A PHN cannot route a report to the RHU.
  assert.throws(() => reports.resolveRecipientRole('phn', 'rhu_personnel'), (e) => e.statusCode === 422);
  // A BHW has no report route at all.
  assert.throws(() => reports.resolveRecipientRole('bhw'), (e) => e.statusCode === 403);
});

test('PHN submits a report that the MHO receives; the PHN sees it as outgoing', async () => {
  const created = await reports.create({ user: PHN, payload: { reportType: 'Monthly Health Report', reportPeriod: 'September 2026' }, supabase });
  assert.equal(created.recipientRole, 'mho');
  assert.equal(created.senderRole, 'phn');
  assert.equal(created.status, 'Submitted');
  assert.equal(created.createdBy, 'phn-1');

  const mhoInbox = await reports.list({ user: MHO, box: 'incoming', supabase });
  assert.equal(mhoInbox.length, 1);
  assert.equal(mhoInbox[0].reportType, 'Monthly Health Report');

  const phnSent = await reports.list({ user: PHN, box: 'outgoing', supabase });
  assert.equal(phnSent.length, 1);
});

test('a report never reaches an MHO in another municipality', async () => {
  await reports.create({ user: PHN, payload: { reportType: 'Monthly Health Report' }, supabase });
  const otherInbox = await reports.list({ user: MHO_OTHER, box: 'incoming', supabase });
  assert.equal(otherInbox.length, 0);
});

test('Health Supervisor report reaches the RHU, not the PHN', async () => {
  await reports.create({ user: HS, payload: { reportType: 'Barangay Health Report' }, supabase });
  const rhuInbox = await reports.list({ user: RHU, box: 'incoming', supabase });
  assert.equal(rhuInbox.length, 1);
  assert.equal(rhuInbox[0].recipientRole, 'rhu_personnel');

  const phnInbox = await reports.list({ user: PHN, box: 'incoming', supabase });
  assert.equal(phnInbox.length, 0);
});

test('the sender cannot review their own report; the recipient can', async () => {
  const created = await reports.create({ user: PHN, payload: { reportType: 'Monthly Health Report' }, supabase });
  await assert.rejects(
    () => reports.review({ user: PHN, id: created.id, status: 'Reviewed', supabase }),
    (e) => e.statusCode === 403,
  );
  const reviewed = await reports.review({ user: MHO, id: created.id, status: 'Reviewed', supabase });
  assert.equal(reviewed.status, 'Reviewed');
  assert.equal(reviewed.reviewedByName === '' || typeof reviewed.reviewedByName === 'string', true);
});

test('getById hides a report from an unrelated recipient role', async () => {
  const created = await reports.create({ user: PHN, payload: { reportType: 'Monthly Health Report' }, supabase });
  // RHU is a valid reports role but not the recipient of a PHN->MHO report.
  await assert.rejects(
    () => reports.getById({ user: RHU, id: created.id, supabase }),
    (e) => e.statusCode === 404,
  );
});

test('BUG-013: a client-supplied municipality_id/barangay_id is ignored — the sender scope is bound from the session', async () => {
  const created = await reports.create({
    user: PHN,
    // A malicious client attempts to inject another municipality/barangay.
    payload: { reportType: 'Monthly Health Report', municipalityId: 'mun-2', municipality_id: 'mun-2', barangayId: 'brgy-9', barangay_id: 'brgy-9' },
    supabase,
  });
  assert.equal(created.municipalityId, 'mun-1', 'municipality is taken from the authenticated PHN, not the body');
  assert.equal(created.barangayId, null, 'a municipality-wide sender never sets a barangay from the body');
});


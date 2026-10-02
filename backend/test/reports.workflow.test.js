import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as reports from '../src/services/reports.service.js';

/**
 * Report submission workflow tests.
 *
 * Reports are ROLE-ROUTED and persisted: a PHN report reaches the MHO, a Health
 * Supervisor report reaches the RHU with municipality-scoped PHN/MHO oversight,
 * RHU Personnel has no report access, and reports never leak across scopes. The Supabase client is an
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
  filters.eq.every(([c, v]) => Array.isArray(v) ? v.includes(row[c]) : row[c] === v) && filters.neq.every(([c, v]) => row[c] !== v);

const makeBuilder = (table) => {
  const state = { table, op: 'select', payload: null, filters: { eq: [], neq: [] } };
  const rowsFor = () => (table === 'reports' ? store : table === 'profiles' ? profiles : []);
  const applied = () => rowsFor().filter((r) => matches(r, state.filters));
  const builder = {
    select() { return this; },
    insert(payload) { state.op = 'insert'; state.payload = payload; return this; },
    update(payload) { state.op = 'update'; state.payload = payload; return this; },
    eq(c, v) { state.filters.eq.push([c, v]); return this; },
    in(c, values) { state.filters.eq.push([c, values]); return this; },
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
    { id: 'phn-1', role: 'phn', status: 'active', municipality_id: 'mun-1' },
    { id: 'mho-1', role: 'mho', status: 'active', municipality_id: 'mun-1' },
    { id: 'rhu-1', role: 'rhu_personnel', status: 'active', municipality_id: 'mun-1' },
  ];
});

test('resolveRecipientRole routes each sender correctly and rejects bad routes', () => {
  assert.equal(reports.resolveRecipientRole('phn'), 'mho');
  assert.equal(reports.resolveRecipientRole('health_supervisor'), 'rhu_personnel');
  // A PHN cannot route a report to the RHU.
  assert.throws(() => reports.resolveRecipientRole('phn', 'rhu_personnel'), (e) => e.statusCode === 422);
  // A BHW has no report route at all.
  assert.throws(() => reports.resolveRecipientRole('bhw'), (e) => e.statusCode === 403);
  assert.throws(() => reports.resolveRecipientRole('rhu_personnel'), (e) => e.statusCode === 403);
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

test('Health Supervisor report is routed to RHU and visible to in-scope PHN/MHO', async () => {
  await reports.create({ user: HS, payload: { reportType: 'Barangay Health Report' }, supabase });
  const phnInbox = await reports.list({ user: PHN, box: 'incoming', supabase });
  assert.equal(phnInbox.length, 1);
  assert.equal(phnInbox[0].recipientRole, 'rhu_personnel');

  const mhoInbox = await reports.list({ user: MHO, box: 'incoming', supabase });
  assert.equal(mhoInbox.length, 1);

  const otherMunicipalityInbox = await reports.list({ user: MHO_OTHER, box: 'incoming', supabase });
  assert.equal(otherMunicipalityInbox.length, 0);
});

test('RHU Personnel cannot submit or list reports', async () => {
  await assert.rejects(() => reports.create({ user: RHU, payload: { reportType: 'RHU Report' }, supabase }), (e) => e.statusCode === 403);
  await assert.rejects(() => reports.list({ user: RHU, box: 'incoming', supabase }), (e) => e.statusCode === 403);
  await assert.rejects(() => reports.list({ user: RHU, box: 'outgoing', supabase }), (e) => e.statusCode === 403);
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

test('PHN and MHO can review an RHU-routed report only within their municipality', async () => {
  const created = await reports.create({ user: HS, payload: { reportType: 'Barangay Health Report' }, supabase });
  const phnVisible = await reports.getById({ user: PHN, id: created.id, supabase });
  assert.equal(phnVisible.recipientRole, 'rhu_personnel');
  const visible = await reports.getById({ user: MHO, id: created.id, supabase });
  assert.equal(visible.id, created.id);
  const reviewed = await reports.review({ user: PHN, id: created.id, status: 'Received', supabase });
  assert.equal(reviewed.status, 'Received');
  await assert.rejects(
    () => reports.getById({ user: MHO_OTHER, id: created.id, supabase }),
    (e) => e.statusCode === 404,
  );
});

test('RHU cannot retrieve a report directly by ID', async () => {
  const created = await reports.create({ user: PHN, payload: { reportType: 'Monthly Health Report' }, supabase });
  await assert.rejects(
    () => reports.getById({ user: RHU, id: created.id, supabase }),
    (e) => e.statusCode === 403,
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


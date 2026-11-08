import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as service from '../src/services/referrals.service.js';
import * as phn from '../src/services/phnQueue.service.js';
import { statusPermission } from '../src/routes/referrals.routes.js';
import fileRepository from '../src/repositories/fileRepository.js';
import supabaseRepository from '../src/repositories/supabaseRepository.js';

const ids = Object.fromEntries(['municipality', 'otherMunicipality', 'barangay', 'otherBarangay', 'rhu', 'otherRhu', 'bhs', 'sender', 'phn', 'triage', 'peer', 'consultation', 'midwife', 'bhw', 'outside'].map((key) => [key, randomUUID()]));
const barangay = (id = ids.barangay, municipality = ids.municipality) => ({ id, municipality_id: municipality, name: id === ids.barangay ? 'San Antonio' : 'San Isidro', status: 'Active' });
const resident = (id = 'RES-CANONICAL') => ({ id, first_name: 'Actual', last_name: 'Resident', barangay: 'San Antonio', barangay_id: ids.barangay, municipality_id: ids.municipality, auth_user_id: randomUUID(), barangay_scope: barangay() });
const user = (id, role, extra = {}) => ({ id, role, status: 'active', municipalityId: ids.municipality, barangayId: role === 'health_supervisor' ? ids.barangay : null, facilityId: role === 'health_supervisor' ? ids.bhs : ids.rhu, rhuStations: role === 'rhu_personnel' ? ['triage'] : [], ...extra });
const sender = user(ids.sender, 'health_supervisor');
const nurse = user(ids.phn, 'phn');
const triage = user(ids.triage, 'rhu_personnel');

// A strict injected PostgREST transport. It deliberately rejects every direct
// table mutation: all successful writes must use the actual canonical RPC
// contract (the SQL implementation is exercised separately with PGlite).
const transport = ({ referrals = [], legacy = [], rpcError = null, queryError = null } = {}) => {
  const state = {
    residents: [resident()],
    profiles: [
      { id: ids.sender, full_name: 'Actual Sender', role: 'health_supervisor', status: 'active', municipality_id: ids.municipality, barangay_id: ids.barangay, facility_id: ids.bhs, rhu_stations: [], barangay_scope: barangay() },
      { id: ids.phn, full_name: 'Actual Nurse', role: 'phn', status: 'active', municipality_id: ids.municipality, barangay_id: null, facility_id: ids.rhu, rhu_stations: [] },
      { id: ids.triage, full_name: 'Actual Triage', role: 'rhu_personnel', status: 'active', municipality_id: ids.municipality, facility_id: ids.rhu, rhu_stations: ['triage'] },
      { id: ids.peer, full_name: 'Unassigned Peer', role: 'rhu_personnel', status: 'active', municipality_id: ids.municipality, facility_id: ids.rhu, rhu_stations: ['triage'] },
      { id: ids.consultation, full_name: 'Actual Consultation', role: 'rhu_personnel', status: 'active', municipality_id: ids.municipality, facility_id: ids.rhu, rhu_stations: ['consultation'] },
      { id: ids.midwife, full_name: 'Actual Midwife', role: 'health_supervisor', status: 'active', municipality_id: ids.municipality, barangay_id: ids.barangay, facility_id: ids.bhs, rhu_stations: [], barangay_scope: barangay() },
      { id: ids.bhw, full_name: 'BHW', role: 'bhw', status: 'active', municipality_id: ids.municipality, barangay_id: ids.barangay },
      { id: ids.outside, full_name: 'Outside Recipient', role: 'rhu_personnel', status: 'active', municipality_id: ids.otherMunicipality, facility_id: ids.otherRhu, rhu_stations: ['triage'] },
    ],
    facilities: [
      { id: ids.rhu, name: 'Actual RHU', type: 'rhu', municipality_id: ids.municipality, barangay_id: null },
      { id: ids.otherRhu, name: 'Other RHU', type: 'rhu', municipality_id: ids.municipality, barangay_id: null },
      { id: ids.bhs, name: 'Actual BHS', type: 'barangay_health_station', municipality_id: ids.municipality, barangay_id: ids.barangay, barangay_scope: barangay() },
    ],
    health_referrals: referrals,
    health_referral_legacy_map: legacy,
    health_referral_history: [], visits: [],
  };
  const calls = [];
  const decorate = (table, row) => table === 'health_referrals' ? {
    ...row,
    resident: state.residents.find((r) => r.id === row.resident_id),
    recipient: state.profiles.find((p) => p.id === row.recipient_personnel_id) || null,
    recipient_facility: state.facilities.find((f) => f.id === row.recipient_facility_id) || null,
    sender: state.profiles.find((p) => p.id === row.created_by),
    legacy_links: state.health_referral_legacy_map.filter((l) => l.health_referral_id === row.id),
  } : row;
  return {
    state, calls,
    from(table) {
      assert.notEqual(table, 'referrals', 'No live endpoint may use the legacy table');
      let filters = []; let sort = []; let start = 0; let end = Infinity; let single = false;
      const builder = {
        select(columns) { calls.push({ table, columns }); return this; },
        eq(column, value) { filters.push((r) => column.split('.').reduce((v, key) => v?.[key], r) === value); return this; },
        in(column, values) { filters.push((r) => values.includes(r[column])); return this; },
        order(column, { ascending = true } = {}) { sort.push([column, ascending]); return this; },
        range(from, to) { start = from; end = to + 1; calls.push({ table, range: [from, to] }); return this; },
        limit(count) { end = count; return this; },
        maybeSingle() { single = true; return this; },
        single() { single = true; return this; },
        insert() { assert.fail('Direct table insert bypassed the transactional RPC'); },
        update() { assert.fail('Direct table update bypassed the transactional RPC'); },
        delete() { assert.fail('Referral history/FKs must never be deleted'); },
        then(resolve, reject) {
          if (queryError && table === 'health_referrals') return Promise.resolve({ data: null, error: queryError }).then(resolve, reject);
          let data = (state[table] || []).map((row) => decorate(table, row)).filter((row) => filters.every((filter) => filter(row)));
          data.sort((a, b) => { for (const [key, ascending] of sort) { const result = String(a[key]).localeCompare(String(b[key])); if (result) return ascending ? result : -result; } return 0; });
          data = data.slice(start, end);
          return Promise.resolve({ data: single ? data[0] || null : data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name, args) {
      calls.push({ rpc: name, args });
      if (rpcError) return { data: null, error: rpcError };
      assert.equal(name, 'canonical_referral_write');
      const previous = state.health_referrals.find((r) => r.id === args.p_id);
      if (previous && previous.version !== args.p_expected_version) return { data: null, error: { code: '40001', message: 'This referral changed. Refresh before trying again.' } };
      const record = { ...(previous || {}), ...args.p_record };
      record.id ||= randomUUID(); record.created_by ||= args.p_actor_id; record.version = (previous?.version || 0) + 1;
      record.status ||= 'Pending'; record.created_at ||= '2026-10-20T00:00:00Z';
      if (args.p_action === 'sync' || args.p_action.startsWith('create')) {
        record.patient_snapshot = structuredClone(state.residents.find((r) => r.id === record.resident_id));
        record.visit_snapshot = structuredClone(state.visits.find((v) => v.id === record.treatment_visit_id) || {});
        if (args.p_action === 'sync') record.snapshot_synced_at = '2026-11-06T00:00:00Z';
      }
      if (args.p_action === 'create_phn') state.visits.find((v) => v.id === record.treatment_visit_id).status = 'referred';
      if (previous) Object.assign(previous, record); else state.health_referrals.push(record);
      state.health_referral_history.push({ id: randomUUID(), referral_id: record.id, version: record.version, action: args.p_action, previous_status: previous?.status || null, new_status: record.status });
      return { data: record, error: null };
    },
  };
};
const saved = (patch = {}) => ({ id: randomUUID(), resident_id: 'RES-CANONICAL', created_by: ids.sender, reason: 'Saved reason', status: 'Pending', version: 1, recipient_personnel_id: ids.triage, recipient_facility_id: ids.rhu, recipient_role: 'rhu_personnel', recipient_station: 'triage', created_at: '2026-10-20T00:00:00Z', ...patch });
const payload = (patch = {}) => ({ residentId: 'RES-CANONICAL', reason: 'Real referral reason', recipient_personnel_id: ids.triage, recipient_facility_id: ids.rhu, recipient_role: 'rhu_personnel', recipient_station: 'triage', ...patch });

test('incoming list is an actual individually assigned, fully paginated current-scope inbox', async () => {
  const rows = Array.from({ length: 205 }, (_, i) => saved({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
  const other = saved({ recipient_personnel_id: ids.peer });
  const client = transport({ referrals: [...rows, other] });
  const result = await service.list({ user: triage, box: 'incoming', supabase: client });
  assert.equal(result.length, 205);
  assert(result.every((r) => r.capabilities.is_recipient && r.recipient_personnel_id === triage.id));
  assert.equal((await service.list({ user: user(ids.consultation, 'rhu_personnel', { rhuStations: ['consultation'] }), supabase: client })).length, 0);
  await assert.rejects(() => service.getById({ user: user(ids.peer, 'rhu_personnel'), id: rows[0].id, supabase: client }), (error) => error.statusCode === 404);
  await assert.rejects(() => service.list({ user: user(ids.bhw, 'bhw'), supabase: client }), (error) => error.statusCode === 403);
  client.state.residents[0].municipality_id = ids.otherMunicipality;
  assert.equal((await service.list({ user: triage, box: 'incoming', supabase: client })).length, 0);
  await assert.rejects(() => service.getById({ user: sender, id: rows[0].id, supabase: client }), (error) => error.statusCode === 404);
});

test('create resolves a real current recipient/facility and cannot override status, source identity, actor or scope', async () => {
  const client = transport();
  const record = await service.create({ user: sender, payload: payload({ destination_facility: 'Forged facility name' }), supabase: client });
  assert.equal(record.destination_facility, 'Actual RHU');
  assert.equal(record.recipient.full_name, 'Actual Triage');
  assert.equal(record.created_by, sender.id);
  const call = client.calls.find((c) => c.rpc);
  assert.equal(call.args.p_actor_id, sender.id);
  assert.equal(call.args.p_record.recipient_personnel_id, ids.triage);
  for (const patch of [{ status: 'Completed' }, { municipality_id: ids.otherMunicipality }, { created_by: ids.peer }, { patient_snapshot: {} }, { completed_at: '2026-01-01' }]) {
    await assert.rejects(() => service.create({ user: sender, payload: payload(patch), supabase: client }), (error) => error.statusCode === 422);
  }
  await assert.rejects(() => service.create({ user: user(ids.sender, 'health_supervisor', { barangayId: ids.otherBarangay }), payload: payload(), supabase: client }), (error) => error.statusCode === 404);
  await assert.rejects(() => service.create({ user: { ...sender, municipalityId: null }, payload: payload(), supabase: client }), (error) => error.statusCode === 403);
});

test('wrong recipient role, station, current geography/facility, suspended account and name-only routing fail before any write', async () => {
  const client = transport();
  for (const patch of [
    { recipient_personnel_id: ids.outside }, { recipient_facility_id: ids.otherRhu }, { recipient_role: 'phn' },
    { recipient_station: 'consultation' }, { recipient_personnel_id: ids.bhw, recipient_role: 'bhw' },
    { recipient_personnel_id: undefined, receivingPersonnel: 'Someone' },
  ]) await assert.rejects(() => service.create({ user: sender, payload: payload(patch), supabase: client }), (error) => error.statusCode === 422);
  client.state.profiles.find((p) => p.id === ids.triage).account = { approval_status: 'approved', setup_required: true };
  await assert.rejects(() => service.create({ user: sender, payload: payload(), supabase: client }), (error) => error.statusCode === 422);
  client.state.profiles.find((p) => p.id === ids.triage).account = null;
  client.state.residents[0].barangay_scope.status = 'Inactive';
  await assert.rejects(() => service.create({ user: sender, payload: payload(), supabase: client }), (error) => error.statusCode === 422);
  assert(!client.calls.some((c) => c.rpc));
});

test('recipient directory supplies only eligible real IDs/roles/stations, no BHW or private personnel fields', async () => {
  const client = transport();
  const routes = await service.listRecipients({ user: sender, residentId: 'RES-CANONICAL', supabase: client });
  assert(routes.some((r) => r.id === ids.consultation && r.station === 'consultation'));
  assert(routes.some((r) => r.id === ids.midwife && r.facility_id === ids.bhs));
  assert(!routes.some((r) => [ids.sender, ids.bhw, ids.outside].includes(r.id)));
  assert(routes.every((r) => Object.keys(r).sort().join(',') === 'facility_id,facility_name,id,name,role,station'));
  assert(!client.calls.some((c) => /email|license|contact_number/.test(c.columns || '')));
  const midwife = await service.create({ user: nurse, payload: payload({ recipient_personnel_id: ids.midwife, recipient_facility_id: ids.bhs, recipient_role: 'midwife', recipient_station: null }), supabase: client });
  assert.equal(midwife.recipient_role, 'health_supervisor');
});

test('row capabilities and status transitions prevent sender approval, unassigned peer decisions and completed/rejected rewrites', async () => {
  const pending = saved();
  const client = transport({ referrals: [pending] });
  await assert.rejects(() => service.updateStatus({ user: sender, id: pending.id, status: 'Accepted', supabase: client }), (error) => error.statusCode === 403);
  await assert.rejects(() => service.updateStatus({ user: triage, id: pending.id, status: 'Completed', supabase: client }), (error) => error.statusCode === 409);
  await assert.rejects(() => service.updateStatus({ user: triage, id: pending.id, status: 'Rejected', supabase: client }), (error) => error.statusCode === 422);
  let record = await service.updateStatus({ user: triage, id: pending.id, status: 'Accepted', version: 1, supabase: client });
  assert.deepEqual(record.capabilities.allowed_statuses, ['In Progress']);
  assert.equal((await service.getById({ user: sender, id: pending.id, supabase: client })).status, 'Accepted');
  record = await service.updateStatus({ user: triage, id: pending.id, status: 'In Progress', version: record.version, supabase: client });
  record = await service.updateStatus({ user: triage, id: pending.id, status: 'Completed', version: record.version, supabase: client });
  assert.equal(record.id, pending.id);
  assert.deepEqual(record.capabilities.allowed_statuses, []);
  await assert.rejects(() => service.update({ user: sender, id: pending.id, payload: { reason: 'Rewrite' }, supabase: client }), (error) => error.statusCode === 409);
});

test('incoming encounter assertion requires current individual assignment and acceptance, not municipal/RHU role access', async () => {
  const referral = saved();
  const client = transport({ referrals: [referral] });
  await assert.rejects(() => service.assertIncomingReferral({ user: triage, id: referral.id, supabase: client }), (error) => error.statusCode === 409);
  await assert.rejects(() => service.assertIncomingReferral({ user: nurse, id: referral.id, supabase: client }), (error) => error.statusCode === 404);
  referral.status = 'Accepted';
  assert.equal((await service.assertIncomingReferral({ user: triage, id: referral.id, supabase: client })).id, referral.id);
  const profile = client.state.profiles.find((p) => p.id === ids.triage);
  profile.facility_id = ids.otherRhu;
  await assert.rejects(() => service.assertIncomingReferral({ user: triage, id: referral.id, supabase: client }), (error) => error.statusCode === 404);
});

test('legacy /phn create/update/read/by-visit/snapshot endpoints bridge to canonical IDs and retain original frozen documents', async () => {
  const client = transport();
  const source = { id: 'VISIT-PHN', residentId: 'RES-CANONICAL', status: 'in_review', recordedByRole: 'health_supervisor', resident: { municipalityId: ids.municipality, barangayId: ids.barangay } };
  const repo = { getVisit: async () => source, nextReferralId: () => assert.fail('No new legacy IDs'), insertReferral: () => assert.fail('No legacy writes'), updateReferral: () => assert.fail('No legacy writes'), updateVisit: () => assert.fail('Source status must be committed atomically in the RPC') };
  client.state.visits.push({ id: source.id, resident_id: source.residentId, status: source.status });
  const created = await phn.createReferral({ visitId: source.id, draft: { reasonForReferral: 'Actual clinical reason', receivingFacility: 'Free-text spoof', recipientPersonnelId: ids.triage, recipientFacilityId: ids.rhu, recipientRole: 'rhu_personnel', recipientStation: 'triage' }, user: nurse, repo, supabase: client });
  assert.equal(created.receivingFacility, 'Actual RHU');
  assert.equal(created.receivingPersonnel, 'Actual Triage');
  assert.equal(created.status, 'Pending');
  assert.equal(client.calls.find((c) => c.rpc).args.p_action, 'create_phn');
  const originalSnapshot = { firstName: 'Original frozen identity', privateMarker: 'Preserve' };
  client.state.health_referral_legacy_map.push({ legacy_referral_id: 'REF-ORIGINAL', health_referral_id: created.canonicalId, legacy_snapshot: { id: 'REF-ORIGINAL', status: 'referred', patient_snapshot: originalSnapshot, visit_snapshot: { id: source.id, findings: 'Original clinical snapshot' }, status_history: [{ status: 'referred' }], referring_contact: 'Original contact', created_by_id: nurse.id } });
  const mapped = await phn.getReferral({ id: 'REF-ORIGINAL', user: nurse, supabase: client });
  assert.equal(mapped.id, 'REF-ORIGINAL'); assert.equal(mapped.canonicalId, created.canonicalId);
  assert.deepEqual(mapped.patientSnapshot, originalSnapshot);
  assert.deepEqual(mapped.statusHistory, [{ status: 'referred' }]);
  assert.equal((await phn.getReferralByVisitId({ visitId: source.id, user: nurse, supabase: client })).id, 'REF-ORIGINAL');
  const updated = await phn.updateReferral({ id: 'REF-ORIGINAL', patch: { reasonForReferral: 'Updated canonical clinical reason', version: mapped.version }, user: nurse, supabase: client });
  assert.equal(updated.canonicalId, mapped.canonicalId);
  assert.equal(updated.reasonForReferral, 'Updated canonical clinical reason');
  assert.deepEqual(updated.patientSnapshot, originalSnapshot);
  const synced = await phn.syncReferralSnapshots({ id: 'REF-ORIGINAL', user: nurse, version: updated.version, repo, supabase: client });
  assert.equal(synced.patientSnapshot.firstName, 'Actual');
  assert.deepEqual(client.state.health_referral_legacy_map[0].legacy_snapshot.patient_snapshot, originalSnapshot);
  const list = await phn.listReferrals({ user: nurse, supabase: client });
  assert.equal(list.rows[0].canonicalId, created.canonicalId);
  const accepted = await phn.updateReferralStatus({ id: 'REF-ORIGINAL', user: triage, status: 'Accepted', version: synced.version, supabase: client });
  assert.equal(accepted.status, 'Accepted');
  assert.equal((await phn.getReferral({ id: 'REF-ORIGINAL', user: nurse, supabase: client })).status, 'Accepted');
  source.resident.municipalityId = ids.otherMunicipality;
  await assert.rejects(() => phn.createReferral({ visitId: source.id, draft: {}, user: nurse, repo, supabase: client }), (error) => error.statusCode === 404);
  client.state.residents[0].municipality_id = ids.otherMunicipality;
  await assert.rejects(() => phn.updateReferral({ id: 'REF-ORIGINAL', patch: {}, user: nurse, supabase: client }), (error) => error.statusCode === 404);
  await assert.rejects(() => phn.syncReferralSnapshots({ id: 'REF-ORIGINAL', user: nurse, repo, supabase: client }), (error) => error.statusCode === 404);
});

test('legacy UUID IDs resolve too; sender CRUD cannot mutate resident/source identity, missing migration never falls back', async () => {
  const referral = saved();
  const oldId = randomUUID();
  const client = transport({ referrals: [referral], legacy: [{ legacy_referral_id: oldId, health_referral_id: referral.id, legacy_snapshot: {} }] });
  assert.equal((await service.getById({ user: sender, id: oldId, supabase: client })).id, referral.id);
  await assert.rejects(() => service.update({ user: sender, id: referral.id, payload: { residentId: 'RES-OTHER' }, supabase: client }), (error) => error.statusCode === 422);
  const missing = transport({ rpcError: { code: 'PGRST202', message: 'Function missing' } });
  await assert.rejects(() => service.create({ user: sender, payload: payload(), supabase: missing }), (error) => error.statusCode === 503);
  await assert.rejects(() => fileRepository.insertReferral({}), (error) => error.statusCode === 409);
  await assert.rejects(() => fileRepository.updateReferral(oldId, {}), (error) => error.statusCode === 409);
  await assert.rejects(() => supabaseRepository.insertReferral({}), (error) => error.statusCode === 409);
  await assert.rejects(() => supabaseRepository.updateReferral(oldId, {}), (error) => error.statusCode === 409);
});

test('nested status permission resolution and PHN endpoint separation preserve authentication and existing submission scope', async () => {
  assert.deepEqual(statusPermission({ body: { record: { status: 'Accepted' } } }), ['referrals.approve']);
  assert.deepEqual(statusPermission({ body: { record: { status: 'Rejected' } } }), ['referrals.reject']);
  assert.deepEqual(statusPermission({ body: { record: { status: 'Cancelled' } } }), ['referrals.status.update']);
  const routes = await readFile(new URL('../src/routes/phnQueue.routes.js', import.meta.url), 'utf8');
  assert.match(routes, /FEATURE_ROLES\.referralRecords\.filter\(\(role\) => role !== 'rhu_personnel'\)/);
  assert.match(routes, /processing\.put\('\/referrals\/:id\/status', referralStatusEditors/);
  assert.match(routes, /processing\.post\('\/referrals\/:id\/sync', referralSnapshotEditors/);
  const referralRoutes = await readFile(new URL('../src/routes/referrals.routes.js', import.meta.url), 'utf8');
  assert.match(referralRoutes, /router\.get\('\/incoming', authorize\(RECIPIENT_ROLES/);
  assert.doesNotMatch(referralRoutes, /'bhw'/);
});

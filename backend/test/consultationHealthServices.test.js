import assert from 'node:assert/strict';
import test from 'node:test';

import env from '../src/config/env.js';
env.isSupabaseConfigured = false;

import { FEATURE_ROLES } from '../src/config/roles.js';
import {
  listConsultationHealthServices,
  normalizePhnVisit,
  updateSubmissionForPhn,
} from '../src/services/phnQueue.service.js';
import { list as listConsultations, parseListFilters } from '../src/services/consultations.service.js';
import * as healthServices from '../src/services/healthServices.service.js';

const rhu = {
  id: 'rhu-user',
  role: 'rhu_personnel',
  municipalityId: 'muni-1',
  facilityId: 'facility-rhu-1',
  rhuStations: ['consultation'],
};
const phn = { id: 'phn-user', role: 'phn', municipalityId: 'muni-1' };

const catalog = [
  { id: 'rhu-wide', name: 'Municipal Health Service', category: 'Consultation', active: true, municipality_id: 'muni-1', facility_id: null, barangay_id: null },
  { id: 'rhu-local', name: 'RHU Service', category: 'Maternal', active: true, municipality_id: 'muni-1', facility_id: 'facility-rhu-1', barangay_id: null },
  { id: 'other-rhu', name: 'Other RHU Service', category: 'Consultation', active: true, municipality_id: 'muni-1', facility_id: 'facility-rhu-2', barangay_id: null },
  { id: 'bhs', name: 'Barangay Service', category: 'Immunization', active: true, municipality_id: 'muni-1', facility_id: 'facility-bhs', barangay_id: 'barangay-1' },
  { id: 'inactive', name: 'Archived Service', category: 'Other', active: false, municipality_id: 'muni-1', facility_id: null, barangay_id: null },
  { id: 'other-muni', name: 'Other Municipality Service', category: 'Consultation', active: true, municipality_id: 'muni-2', facility_id: null, barangay_id: null },
];

const makeSupabase = (rows = catalog) => ({
  from(table) {
    assert.equal(table, 'health_services');
    const predicates = [];
    const query = {
      select() { return query; },
      eq(column, value) { predicates.push((row) => row[column] === value); return query; },
      order() { return query; },
      then(resolve, reject) {
        return Promise.resolve({
          data: rows.filter((row) => predicates.every((predicate) => predicate(row))),
          error: null,
        }).then(resolve, reject);
      },
    };
    return query;
  },
});

test('consultation service endpoint returns only active services in the RHU facility scope', async () => {
  const services = await listConsultationHealthServices({ user: rhu, supabase: makeSupabase() });
  assert.deepEqual(services.map((service) => service.id), ['rhu-wide', 'rhu-local']);
  assert.ok(services.every((service) => service.active));
});

test('PHN may read active consultation services in its own municipality only', async () => {
  const services = await listConsultationHealthServices({ user: phn, supabase: makeSupabase() });
  assert.deepEqual(services.map((service) => service.id), ['rhu-wide', 'rhu-local', 'other-rhu', 'bhs']);
});

test('RHU Personnel without consultation station or facility assignment is denied', async () => {
  await assert.rejects(
    listConsultationHealthServices({
      user: { ...rhu, rhuStations: ['triage'] },
      supabase: makeSupabase(),
    }),
    { statusCode: 403 },
  );
  await assert.rejects(
    listConsultationHealthServices({
      user: { ...rhu, facilityId: null },
      supabase: makeSupabase(),
    }),
    { statusCode: 422 },
  );
});

test('service selection is normalized to an identifier and cannot be supplied as a name', () => {
  assert.deepEqual(normalizePhnVisit({ healthServiceId: 'rhu-local', healthServiceName: 'forged' }), {
    healthServiceId: 'rhu-local',
  });
  assert.deepEqual(normalizePhnVisit({ health_service_id: '' }), { healthServiceId: null });
  assert.deepEqual(normalizePhnVisit({ treatmentGiven: 'Treatment' }), { treatmentGiven: 'Treatment' });
});

test('shared consultation update persists the selected service id and authoritative name', async () => {
  let savedPatch;
  const submission = {
    id: 'visit-1',
    status: 'in_review',
    facilityId: 'facility-rhu-1',
    resident: { id: 'resident-1', municipalityId: 'muni-1', barangayId: 'barangay-1' },
    healthServiceId: null,
    healthServiceName: '',
  };
  const repo = {
    getVisit: async () => submission,
    updateVisit: async (_id, patch) => {
      savedPatch = patch;
      return { ...submission, ...patch };
    },
  };
  await updateSubmissionForPhn({
    id: submission.id,
    patch: { healthServiceId: 'rhu-local' },
    user: rhu,
    repo,
    supabase: makeSupabase(),
  });
  assert.equal(savedPatch.healthServiceId, 'rhu-local');
  assert.equal(savedPatch.healthServiceName, 'RHU Service');
});

test('shared consultation update rejects inactive and out-of-scope service ids', async () => {
  const submission = {
    id: 'visit-1',
    status: 'in_review',
    facilityId: 'facility-rhu-1',
    resident: { id: 'resident-1', municipalityId: 'muni-1', barangayId: 'barangay-1' },
    healthServiceId: null,
    healthServiceName: '',
  };
  let writes = 0;
  const repo = {
    getVisit: async () => submission,
    updateVisit: async () => { writes += 1; return submission; },
  };
  for (const healthServiceId of ['inactive', 'other-rhu', 'other-muni', 'missing']) {
    await assert.rejects(
      updateSubmissionForPhn({
        id: submission.id,
        patch: { healthServiceId },
        user: rhu,
        repo,
        supabase: makeSupabase(),
      }),
      { statusCode: 422 },
    );
  }
  assert.equal(writes, 0);
});

test('an unchanged inactive service preserves its historical name snapshot', async () => {
  let savedPatch;
  const submission = {
    id: 'visit-1',
    status: 'in_review',
    facilityId: 'facility-rhu-1',
    resident: { id: 'resident-1', municipalityId: 'muni-1', barangayId: 'barangay-1' },
    healthServiceId: 'inactive',
    healthServiceName: 'Archived Service at time of visit',
  };
  const repo = {
    getVisit: async () => submission,
    updateVisit: async (_id, patch) => { savedPatch = patch; return { ...submission, ...patch }; },
  };
  await updateSubmissionForPhn({
    id: submission.id,
    patch: { healthServiceId: 'inactive' },
    user: rhu,
    repo,
    supabase: makeSupabase(),
  });
  assert.equal(savedPatch.healthServiceId, 'inactive');
  assert.equal(savedPatch.healthServiceName, 'Archived Service at time of visit');
});

test('consultation history applies the selected health-service id in the repository query', async () => {
  const serviceId = '11111111-1111-4111-8111-111111111111';
  const parsed = parseListFilters({ serviceId });
  assert.deepEqual(parsed.errors, []);
  let query;
  await listConsultations({
    user: phn,
    filters: parsed.filters,
    repo: {
      listVisits: async (filters) => {
        query = filters;
        return { rows: [], total: 0 };
      },
    },
    supabase: {},
  });
  assert.equal(query.serviceId, serviceId);
});

test('RHU consultation access does not grant general catalog read or management permissions', async () => {
  assert.ok(!FEATURE_ROLES.healthServicesRead.includes('rhu_personnel'));
  assert.ok(!FEATURE_ROLES.healthServices.includes('rhu_personnel'));

  for (const operation of [
    () => healthServices.create({ user: rhu, payload: { name: 'Attempted service' }, supabase: makeSupabase() }),
    () => healthServices.update({ user: rhu, serviceId: 'rhu-local', payload: { active: false }, supabase: makeSupabase() }),
    () => healthServices.remove({ user: rhu, serviceId: 'rhu-local', supabase: makeSupabase() }),
  ]) {
    await assert.rejects(operation(), { statusCode: 403 });
  }
});

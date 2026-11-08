import assert from 'node:assert/strict';
import test from 'node:test';
import { getResidentForIntake, searchResidents } from '../src/services/intake.service.js';

const actor = (role = 'rhu_personnel') => ({ id: 'worker-a', role, rhuStations: role === 'rhu_personnel' ? ['triage'] : [], facilityId: role === 'rhu_personnel' ? 'facility-a' : null, municipalityId: 'municipality-a', ...(role !== 'rhu_personnel' ? { barangay: 'San Antonio', barangayId: 'barangay-a' } : {}) });
const resident = (values = {}) => ({ id: 'resident-a', firstName: 'Recorded', lastName: 'Resident', municipalityId: 'municipality-a', barangay: 'San Antonio', barangayId: 'barangay-a', ...values });
const fixture = (row, data = []) => {
  const calls = [];
  let reads = 0;
  const repo = { driver: 'supabase', getResident: async () => { reads += 1; return row; }, searchResidents: async (params) => { calls.push(['search', params]); return []; } };
  const query = {
    select: (fields) => { calls.push(['select', fields]); return query; },
    eq: (field, value) => { calls.push(['eq', field, value]); return query; },
    order: (field, options) => { calls.push(['order', field, options]); return query; },
    limit: async (value) => { calls.push(['limit', value]); return { data, error: null }; },
  };
  const supabase = { from: (table) => { calls.push(['from', table]); return query; } };
  return { repo, supabase, calls, reads: () => reads };
};

test('RHU detail rejects another municipality before any clinical history read', async () => {
  const f = fixture(resident({ municipalityId: 'municipality-b' }));
  await assert.rejects(getResidentForIntake({ id: 'resident-a', user: actor(), repo: f.repo, supabase: f.supabase }), (error) => error.statusCode === 404);
  assert.deepEqual(f.calls, []);
});

test('same-named barangays never authorize another municipality or barangay identity', async () => {
  for (const values of [{ municipalityId: 'municipality-b' }, { barangayId: 'barangay-b' }, { barangay: 'San Isidro' }]) {
    const f = fixture(resident(values));
    await assert.rejects(getResidentForIntake({ id: 'resident-a', user: actor('health_supervisor'), repo: f.repo, supabase: f.supabase }), (error) => error.statusCode === 404);
    assert.deepEqual(f.calls, []);
  }
});

test('missing municipality, barangay or RHU facility assignments fail closed before resident access', async () => {
  for (const user of [
    { ...actor(), municipalityId: null },
    { ...actor(), facilityId: null },
    { ...actor('bhw'), barangay: null },
    { ...actor('health_supervisor'), barangay: null },
  ]) {
    const f = fixture(resident());
    await assert.rejects(getResidentForIntake({ id: 'resident-a', user, repo: f.repo, supabase: f.supabase }), (error) => error.statusCode === 403);
    assert.equal(f.reads(), 0);
    assert.deepEqual(f.calls, []);
  }
});

test('unscoped resident metadata is not treated as an authorized municipality', async () => {
  const f = fixture(resident({ municipalityId: null }));
  await assert.rejects(getResidentForIntake({ id: 'resident-a', user: actor(), repo: f.repo, supabase: f.supabase }), (error) => error.statusCode === 404);
  assert.deepEqual(f.calls, []);
});

test('valid RHU prefill reads only this resident completed encounters at its assigned facility', async () => {
  const f = fixture(resident(), [{ id: 'visit-a', visit_date: '2026-11-01', height_cm: 162, weight_kg: 60, chief_complaint: 'Recorded concern', findings: 'Recorded findings', phn_assessment: 'Recorded assessment' }]);
  const result = await getResidentForIntake({ id: 'resident-a', user: actor(), repo: f.repo, supabase: f.supabase });
  assert.ok(f.calls.some((call) => call[0] === 'eq' && call[1] === 'resident_id' && call[2] === 'resident-a'));
  assert.ok(f.calls.some((call) => call[0] === 'eq' && call[1] === 'status' && call[2] === 'completed'));
  assert.ok(f.calls.some((call) => call[0] === 'eq' && call[1] === 'facility_id' && call[2] === 'facility-a'));
  assert.equal(result.latestMeasurements.heightCm, 162);
  assert.equal(result.latestMeasurements.weightKg, 60);
  assert.equal(result.recentClinicalHistory[0].chiefComplaint, 'Recorded concern');
});

test('valid BHW and supervisor prefill remains inside their resident scope without an RHU-only facility restriction', async () => {
  for (const role of ['bhw', 'health_supervisor']) {
    const f = fixture(resident());
    const result = await getResidentForIntake({ id: 'resident-a', user: actor(role), repo: f.repo, supabase: f.supabase });
    assert.equal(result.id, 'resident-a');
    assert.equal(f.calls.some((call) => call[0] === 'eq' && call[1] === 'facility_id'), false);
    assert.deepEqual(result.recentClinicalHistory, []);
  }
});

test('malformed history responses are errors rather than successful empty clinical data', async () => {
  const f = fixture(resident(), null);
  await assert.rejects(getResidentForIntake({ id: 'resident-a', user: actor(), repo: f.repo, supabase: f.supabase }), (error) => error.statusCode === 503);
});

test('search also requires actual scope and passes only the authenticated municipality/barangay', async () => {
  const f = fixture(resident());
  await searchResidents({ q: 'Recorded', user: actor('bhw'), repo: f.repo });
  assert.deepEqual(f.calls, [['search', { q: 'Recorded', limit: 25, barangay: 'San Antonio', municipalityId: 'municipality-a' }]]);
  const invalid = fixture(resident());
  await assert.rejects(searchResidents({ q: 'Recorded', user: { ...actor(), municipalityId: null }, repo: invalid.repo }), (error) => error.statusCode === 403);
  assert.deepEqual(invalid.calls, []);
});

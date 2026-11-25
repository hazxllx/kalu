import assert from 'node:assert/strict';
import test from 'node:test';
import { getResidentRiskClinicalDetails } from '../src/services/residentRisk.service.js';

const user = (role = 'phn') => ({ id: 'actor-id', role, municipalityId: 'municipality-id', barangayId: 'barangay-id' });

test('clinical details preserve all assessment fields and classify each recorded visit', async () => {
  const expected = {
    residentId: 'resident-1',
    birthDate: '1990-01-01',
    resident: { id: 'resident-1', name: 'Resident One', barangay: 'San Isidro', age: 36, sex: 'Female' },
    riskLevel: 'High',
    riskAssessmentStatus: 'assessed',
    riskAssessedAt: '2026-04-04T08:00:00Z',
    riskFactors: [{ code: 'bp_severe', name: 'Blood Pressure – Severe', description: 'Severe blood pressure', field: 'systolic', measured: 180 }],
    assessments: [{
      id: 'visit-1',
      assessmentAt: '2026-04-04T08:00:00Z',
      recordedBy: 'Recorded Staff',
      performedBy: 'Consulting Staff',
      assessmentType: 'Consultation',
      measurements: { bp: '120/80', hr: 72, bloodSugar: 91, bmi: 22 },
      assessmentDetails: {
        findings: 'No acute findings',
        consultationDetails: { clinicalAssessmentHistory: [{ status: 'reviewed' }] },
      },
      additionalApiField: 'retained',
    }],
  };
  let invocation;
  const result = await getResidentRiskClinicalDetails({
    user: user(),
    residentId: 'resident-1',
    supabase: { rpc: async (name, args) => { invocation = { name, args }; return { data: expected, error: null }; } },
  });

  assert.deepEqual(invocation, {
    name: 'resident_risk_clinical_details',
    args: { p_actor_id: 'actor-id', p_resident_id: 'resident-1' },
  });
  assert.equal(result.assessments[0].recordedBy, 'Recorded Staff');
  assert.equal(result.assessments[0].measurements.bloodSugar, 91);
  assert.equal(result.assessments[0].assessmentDetails.consultationDetails.clinicalAssessmentHistory[0].status, 'reviewed');
  assert.equal(result.assessments[0].additionalApiField, 'retained');
  assert.equal(result.assessments[0].clinicalScreening.classifications.heartRate.value, '72 bpm');
  assert.equal(result.resident.name, 'Resident One');
  assert.equal(result.riskFactors[0].description, 'Severe blood pressure');
});

test('clinical detail RPC is not called for unauthorized roles or malformed resident IDs', async () => {
  let called = false;
  const supabase = { rpc: async () => { called = true; return { data: {}, error: null }; } };

  await assert.rejects(getResidentRiskClinicalDetails({ user: user('resident'), residentId: 'resident-1', supabase }),
    (error) => error.statusCode === 403);
  await assert.rejects(getResidentRiskClinicalDetails({ user: user(), residentId: ' ', supabase }),
    (error) => error.statusCode === 400);
  assert.equal(called, false);
});

test('clinical details reject mismatched resident data and scope denials', async () => {
  await assert.rejects(getResidentRiskClinicalDetails({
    user: user(), residentId: 'resident-1',
    supabase: { rpc: async () => ({ data: { residentId: 'resident-2', assessments: [] }, error: null }) },
  }), (error) => error.code === 'RISK_CLINICAL_DETAILS_INVALID_RESPONSE');
  await assert.rejects(getResidentRiskClinicalDetails({
    user: user(), residentId: 'resident-1',
    supabase: { rpc: async () => ({ data: null, error: { code: '42501' } }) },
  }), (error) => error.statusCode === 403);
});

test('clinical details distinguish missing schema from connection failures', async () => {
  const request = (supabase) => getResidentRiskClinicalDetails({ user: user(), residentId: 'resident-1', supabase });

  await assert.rejects(request({
    rpc: async () => ({ data: null, error: { code: 'PGRST202' } }),
  }), (error) => error.code === 'RISK_CLINICAL_DETAILS_SCHEMA_UNAVAILABLE');
  await assert.rejects(request({
    rpc: async () => { throw new TypeError('fetch failed'); },
  }), (error) => error.code === 'RISK_CLINICAL_DETAILS_CONNECTION_ERROR');
  await assert.rejects(request({
    rpc: async () => ({ data: null, error: { code: '08006' } }),
  }), (error) => error.code === 'RISK_CLINICAL_DETAILS_UNAVAILABLE'
    && !error.message.includes('migration'));
});

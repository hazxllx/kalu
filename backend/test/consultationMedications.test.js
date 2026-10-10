import assert from 'node:assert/strict';
import test from 'node:test';
import { toVisit, fromVisit } from '../src/services/consultations.service.js';

const user = { id: 'u1', role: 'health_supervisor', name: 'HS One' };

test('toVisit stores structured medications, referral flag and BP classification snapshot', () => {
  const payload = {
    consultationDate: '2026-01-02',
    chiefComplaint: 'Cough',
    findings: 'Clear chest',
    diagnosis: 'URTI',
    treatmentGiven: 'Rest and fluids',
    referralRequired: 'Yes',
    bloodPressure: '145/95',
    medications: [
      { medicineId: 'm1', genericName: 'Amoxicillin', strength: '500 mg', source: 'yakap' },
      { genericName: 'Homemade syrup' },
    ],
  };
  const snapshot = { code: 'stage2', label: 'HIGH — Hypertension Stage 2', systolic: 145, diastolic: 95 };
  const visit = toVisit(payload, user, 'R1', { bpClassification: snapshot });

  assert.equal(visit.medications.length, 2);
  assert.equal(visit.medications[0].custom, false);
  assert.equal(visit.medications[0].source, 'yakap');
  assert.equal(visit.medications[1].custom, true);
  assert.equal(visit.referralRequired, true);
  assert.deepEqual(visit.bpClassification, snapshot);
  // treatment_given is not polluted by medication text when the structured
  // array is used (no medicationPrescribed string supplied).
  assert.equal(visit.treatmentGiven, 'Rest and fluids');
});

test('toVisit treats a missing/No referral as false', () => {
  assert.equal(toVisit({ consultationDate: '2026-01-02' }, user, 'R1').referralRequired, false);
  assert.equal(toVisit({ referralRequired: 'No' }, user, 'R1').referralRequired, false);
});

test('fromVisit round-trips structured medications, referral and classification', async () => {
  const visit = {
    id: 'V1',
    residentId: 'R1',
    visitDate: '2026-01-02T09:00:00',
    chiefComplaint: 'Cough',
    findings: 'Clear chest\nDiagnosis: URTI',
    treatmentGiven: 'Rest and fluids',
    recommendation: 'Hydrate',
    medications: [{ medicineId: 'm1', genericName: 'Amoxicillin', strength: '500 mg', custom: false, source: 'yakap' }],
    referralRequired: true,
    bpClassification: { code: 'stage2', label: 'HIGH — Hypertension Stage 2' },
    vitals: { bp: '145/95' },
    status: 'completed',
    resident: {},
  };
  const result = await fromVisit(visit, {});
  assert.equal(result.medications.length, 1);
  assert.equal(result.medications[0].genericName, 'Amoxicillin');
  assert.equal(result.referralRequired, 'Yes');
  assert.equal(result.bloodPressureClassification.code, 'stage2');
  assert.equal(result.treatmentGiven, 'Rest and fluids');
  assert.equal(result.diagnosis, 'URTI');
});

test('fromVisit parses a legacy medication marker out of treatment_given', async () => {
  const visit = {
    id: 'V2',
    residentId: 'R1',
    visitDate: '2026-01-02T00:00:00',
    treatmentGiven: 'Rest\nMedication: Paracetamol 500mg',
    recommendation: '',
    vitals: { bp: '118/76' },
    status: 'completed',
    resident: {},
  };
  const result = await fromVisit(visit, {});
  assert.equal(result.treatmentGiven, 'Rest');
  assert.equal(result.medications.length, 1);
  assert.equal(result.medications[0].genericName, 'Paracetamol 500mg');
  assert.equal(result.medications[0].custom, true);
  // No referral flag stored on a legacy row -> defaults to "No".
  assert.equal(result.referralRequired, 'No');
  // Legacy row without a stored snapshot still classifies from the reading.
  assert.equal(result.bloodPressureClassification.code, 'normal');
});

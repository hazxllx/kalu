import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHECKUP_STATUS,
  mapVisitStatus,
  mapVisitToPatient,
  mapVisitsToPatients,
  splitWalkInName,
  triageToVisitPayload,
} from '../src/lib/phnWorkflowMap.js';

// BUG-008: these lock the mapping between the persistent backend visit rows
// (the `visits` table served by /intake and /phn) and the patient-row shape the
// triage/PHN pages render, so the clinical workflow is DB-backed, not
// localStorage-backed.

test('mapVisitStatus maps backend statuses to the UI pipeline', () => {
  assert.equal(mapVisitStatus('submitted'), CHECKUP_STATUS.WAITING);
  assert.equal(mapVisitStatus('received'), CHECKUP_STATUS.WAITING);
  assert.equal(mapVisitStatus('in_review'), CHECKUP_STATUS.IN_CHECKUP);
  assert.equal(mapVisitStatus('referred'), CHECKUP_STATUS.IN_CHECKUP);
  assert.equal(mapVisitStatus('completed'), CHECKUP_STATUS.COMPLETED);
  // drafts and unknowns are not part of the queue view
  assert.equal(mapVisitStatus('draft'), null);
  assert.equal(mapVisitStatus('anything'), null);
});

test('mapVisitToPatient produces the triage/PHN row shape from a submitted visit', () => {
  const visit = {
    id: 'SUB-1',
    status: 'submitted',
    residentId: 'RES-1',
    chiefComplaint: 'Fever',
    clinicalHistory: 'note',
    recordedByName: 'RHU One',
    visitDate: '2026-09-24',
    vitals: { bp: '120/80', hr: 80, rr: 18, o2sat: 98, temperature: 37, heightCm: 170, weightKg: 65, bmi: 22.5, bloodSugar: 100 },
    resident: { firstName: 'Juan', lastName: 'Dela Cruz', sex: 'Male', barangay: 'San Isidro', birthDate: '2000-01-01' },
  };
  const row = mapVisitToPatient(visit);
  assert.equal(row.id, 'SUB-1');
  assert.equal(row.residentId, 'RES-1');
  assert.equal(row.patient, 'Juan Dela Cruz');
  assert.equal(row.status, CHECKUP_STATUS.WAITING);
  assert.equal(row.barangay, 'San Isidro');
  assert.equal(row.reason, 'Fever');
  assert.equal(row.triage.bloodPressure, '120/80');
  assert.equal(row.triage.bmi, 22.5);
  assert.equal(row.triage.bloodSugar, 100);
  assert.equal(row.checkup, undefined); // not completed yet
  assert.ok(typeof row.age === 'number' && row.age > 20);
});

test('mapVisitToPatient exposes the PHN check-up record once completed', () => {
  const visit = {
    id: 'SUB-2',
    status: 'completed',
    residentId: 'RES-2',
    chiefComplaint: 'BP check',
    findings: 'Elevated BP',
    treatmentGiven: 'Advised rest',
    recommendation: 'Follow-up in 1 week',
    completedAt: '2026-09-25',
    phn: { assessment: 'Hypertension', notes: 'monitor' },
    vitals: { bp: '140/90' },
    resident: { firstName: 'Ana', lastName: 'Reyes', sex: 'Female', barangay: 'San Antonio' },
  };
  const row = mapVisitToPatient(visit);
  assert.equal(row.status, CHECKUP_STATUS.COMPLETED);
  assert.equal(row.checkup.assessment, 'Elevated BP');
  assert.equal(row.checkup.healthConcern, 'Hypertension');
  assert.equal(row.checkup.recommendations, 'Follow-up in 1 week');
  assert.equal(row.checkup.clinicalNotes, 'monitor');
});

test('mapVisitsToPatients drops drafts and non-pipeline rows', () => {
  const rows = mapVisitsToPatients([
    { id: 'A', status: 'draft', resident: {} },
    { id: 'B', status: 'submitted', resident: { firstName: 'X', lastName: 'Y' } },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'B');
});

test('splitWalkInName splits a free-text name for the intake endpoint', () => {
  assert.deepEqual(splitWalkInName('Juan Dela Cruz'), { firstName: 'Juan', lastName: 'Dela Cruz' });
  assert.deepEqual(splitWalkInName('Madonna'), { firstName: 'Madonna', lastName: 'Madonna' });
  assert.deepEqual(splitWalkInName('  '), { firstName: '', lastName: '' });
});

test('triageToVisitPayload builds a numeric-normalized vitals payload', () => {
  const payload = triageToVisitPayload({
    reason: 'Check-up',
    bloodPressure: '120/80',
    heightCm: '170',
    weight: '65',
    bloodSugar: '100',
    notes: 'hx',
  });
  assert.equal(payload.chiefComplaint, 'Check-up');
  assert.equal(payload.clinicalHistory, 'hx');
  assert.equal(payload.vitals.bp, '120/80');
  assert.equal(payload.vitals.heightCm, 170);
  assert.equal(payload.vitals.weightKg, 65);
  assert.equal(payload.vitals.bloodSugar, 100);
});

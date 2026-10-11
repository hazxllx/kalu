import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePhnVisit } from '../src/services/phnQueue.service.js';
import { toResidentRecord, formatMedicationText } from '../src/services/residents.service.js';

// Issue 10 — PHN structured prescriptions survive the PHN check-up path and the
// resident health-record view, with legacy fallback.

test('normalizePhnVisit forwards and normalizes structured medications', () => {
  const patch = normalizePhnVisit({
    findings: 'BP controlled',
    medications: [
      // Catalog entry
      { medicineId: 'm1', genericName: 'Amlodipine', strength: '5 mg', dosageForm: 'Tablet', dose: '1 tab', route: 'Oral', frequency: 'OD', custom: false, source: 'yakap' },
      // Manual / custom entry
      { genericName: 'Paracetamol', dose: '500 mg', frequency: 'PRN' },
      // Nameless entry must be dropped by the normalizer
      { genericName: '   ', dose: '1 tab' },
    ],
  });
  assert.ok(Array.isArray(patch.medications));
  assert.equal(patch.medications.length, 2, 'nameless medicine is dropped');
  assert.equal(patch.medications[0].genericName, 'Amlodipine');
  assert.equal(patch.medications[0].custom, false);
  assert.equal(patch.medications[0].source, 'yakap');
  assert.equal(patch.medications[1].genericName, 'Paracetamol');
  assert.equal(patch.medications[1].custom, true);
});

test('normalizePhnVisit does NOT set medications when the field is absent (no accidental clear)', () => {
  const patch = normalizePhnVisit({ findings: 'note only' });
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'medications'), false);
});

test('normalizePhnVisit with an explicit empty array normalizes to []', () => {
  const patch = normalizePhnVisit({ medications: [] });
  assert.deepEqual(patch.medications, []);
});

test('toResidentRecord reads STRUCTURED medications and formats a readable string', () => {
  const record = toResidentRecord({
    id: 'V1',
    visitDate: '2026-02-01T09:30:00.000Z',
    treatmentGiven: 'Advised rest',
    medications: [
      { genericName: 'Amlodipine', strength: '5 mg', dosageForm: 'Tablet', dose: '1 tab', route: 'Oral', frequency: 'OD', duration: '30 days', quantity: '30', custom: false, source: 'yakap' },
      { genericName: 'Losartan', strength: '50 mg', custom: true },
    ],
  });
  assert.equal(record.medicationList.length, 2);
  assert.equal(record.medicationList[0].genericName, 'Amlodipine');
  assert.equal(record.medicationList[0].source, 'yakap');
  assert.equal(record.medicationList[1].source, 'custom');
  assert.match(record.medications, /Amlodipine 5 mg Tablet/);
  assert.match(record.medications, /Losartan 50 mg/);
  // Treatment text is unchanged and does not absorb the medication.
  assert.equal(record.treatmentGiven, 'Advised rest');
});

test('toResidentRecord falls back to the LEGACY inline Medication string', () => {
  const record = toResidentRecord({
    id: 'V2',
    treatmentGiven: 'Wound care\nMedication: Amoxicillin 500mg TID',
  });
  assert.deepEqual(record.medicationList, []);
  assert.equal(record.medications, 'Amoxicillin 500mg TID');
  assert.equal(record.treatmentGiven, 'Wound care');
});

test('toResidentRecord with no medications yields empty structured list and string', () => {
  const record = toResidentRecord({ id: 'V3', treatmentGiven: 'Observation only' });
  assert.deepEqual(record.medicationList, []);
  assert.equal(record.medications, '');
});

test('structured medications take precedence over a stray legacy marker', () => {
  const record = toResidentRecord({
    id: 'V4',
    treatmentGiven: 'Care\nMedication: ignored-legacy',
    medications: [{ genericName: 'Metformin', strength: '500 mg', custom: true }],
  });
  assert.equal(record.medicationList.length, 1);
  assert.match(record.medications, /Metformin 500 mg/);
  assert.doesNotMatch(record.medications, /ignored-legacy/);
});

test('formatMedicationText builds a readable one-line summary', () => {
  const line = formatMedicationText({
    genericName: 'Amlodipine', strength: '5 mg', dosageForm: 'Tablet',
    dose: '1 tab', route: 'Oral', frequency: 'OD', duration: '30 days',
    quantity: '30', instructions: 'Take in the morning',
  });
  assert.match(line, /Amlodipine 5 mg Tablet/);
  assert.match(line, /1 tab · Oral · OD · 30 days/);
  assert.match(line, /Qty 30/);
  assert.match(line, /Take in the morning/);
});

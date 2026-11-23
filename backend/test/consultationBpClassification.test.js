import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyBloodPressure as legacyClassify, toVisit, fromVisit } from '../src/services/consultations.service.js';
import { classifyBloodPressure as authoritativeClassify } from '../src/config/bpThresholds.js';

// The legacy label helper and complete snapshots share the same classifier.

test('below-range readings use Normal while retaining the shared classification', () => {
  assert.equal(legacyClassify('85/55'), 'Normal Blood Pressure');
});

test('stage-2 reading matches the authoritative classifier (no divergence)', () => {
  // Previously "150/95" → "Stage 1 hypertension" (legacy) vs Stage 2 (authoritative).
  assert.equal(legacyClassify('150/95'), 'Stage 2 Hypertension');
});

test('a normal reading stays Normal', () => {
  assert.equal(legacyClassify('118/76'), 'Normal Blood Pressure');
});

test('invalid / missing readings return null (never Normal)', () => {
  for (const bad of ['', '   ', 'abc', '120', '12/8', null, undefined]) {
    assert.equal(legacyClassify(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('legacy label always equals the authoritative label (single source of truth)', () => {
  const readings = ['90/60', '118/76', '125/78', '135/85', '145/95', '160/105', '190/130', '85/55'];
  for (const r of readings) {
    const authoritative = authoritativeClassify(r);
    assert.equal(legacyClassify(r), authoritative ? authoritative.label : null, `mismatch for ${r}`);
  }
});

test('the complete merged clinical field and reconstructed database vitals retain crisis classification', async () => {
  const visit = toVisit({ bloodPressure: '185/125', clinicalFindingsDiagnosis: 'Alert\nDiagnosis: Chest pain' }, { id: 'test' }, 'resident');
  assert.equal(visit.bpClassification.code, 'crisis');
  const restored = await fromVisit({ ...visit, vitals: { bp: '185/125' } }, null);
  assert.equal(restored.vitals.systolic, 185);
  assert.equal(restored.vitals.diastolic, 125);
  assert.equal(restored.vitals.bloodPressureCategory, 'Hypertensive Urgency or Emergency');
});

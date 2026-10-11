import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyBloodPressure as legacyClassify } from '../src/services/consultations.service.js';
import { classifyBloodPressure as authoritativeClassify } from '../src/config/bpThresholds.js';

// Regression for the divergent legacy BP classifier (Issue 12, defect #1).
//
// The legacy helper in consultations.service.js previously used its own
// hardcoded thresholds that disagreed with the authoritative classifier
// (config/bpThresholds.js) and had NO hypotension band, so a valid low reading
// was mislabelled "Normal". It now delegates to the authoritative classifier,
// so `vitals.bloodPressureCategory` can no longer disagree with
// `bloodPressureClassification` on the same visit.

test('a valid low reading is NOT labelled Normal (hypotension band restored)', () => {
  // Previously "85/55" returned "Normal"; it must now be the hypotension label.
  assert.equal(legacyClassify('85/55'), 'LOW — Hypotension');
  assert.notEqual(legacyClassify('85/55'), 'Normal');
});

test('stage-2 reading matches the authoritative classifier (no divergence)', () => {
  // Previously "150/95" → "Stage 1 hypertension" (legacy) vs Stage 2 (authoritative).
  assert.equal(legacyClassify('150/95'), 'HIGH — Hypertension Stage 2');
});

test('a normal reading stays Normal', () => {
  assert.equal(legacyClassify('118/76'), 'Normal');
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

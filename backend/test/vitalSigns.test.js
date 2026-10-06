import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyBloodPressure,
  create,
  toVisit,
  validateVitals,
} from '../src/services/consultations.service.js';

test('blood pressure classification follows the approved AHA boundaries', () => {
  const cases = [
    ['119/79', 'Normal'],
    ['120/79', 'Prehypertension'],
    ['139/89', 'Prehypertension'],
    ['140/89', 'Stage 1 hypertension'],
    ['159/99', 'Stage 1 hypertension'],
    ['160/99', 'Stage 2 hypertension'],
    ['180/100', 'Stage 2 hypertension'],
    ['181/100', 'Hypertensive Crisis'],
    ['160/110', 'Stage 2 hypertension'],
    ['160/111', 'Hypertensive Crisis'],
  ];
  for (const [reading, expected] of cases) {
    assert.equal(classifyBloodPressure(reading), expected, reading);
  }
});

test('blood pressure values outside 40–300 are rejected with HTTP 422', async () => {
  await assert.rejects(
    create({
      user: { id: 'staff-1', role: 'health_supervisor' },
      payload: {
        residentId: 'resident-1',
        chiefComplaint: 'Review',
        findings: 'Stable',
        diagnosis: 'Routine',
        bloodPressure: '39/80',
      },
    }),
    (error) => error.statusCode === 422 && /between 40 and 300/i.test(error.details.bloodPressure),
  );
  assert.ok(validateVitals({ bloodPressure: '120/301' }).length > 0);
});

test('server computes BMI when both height and weight are present', () => {
  const result = toVisit(
    { height: 180, weight: 72 },
    { id: 'staff-1', role: 'health_supervisor' },
    'resident-1',
  );
  assert.equal(result.vitals.bmi, 22.2);
  assert.equal(result.vitals.bmiCategory, 'Normal');
});

test('server leaves BMI unset when either height or weight is missing', () => {
  for (const partialVitals of [{ height: 180 }, { weight: 72 }]) {
    const result = toVisit(partialVitals, { id: 'staff-1', role: 'health_supervisor' }, 'resident-1');
    assert.equal(result.vitals.bmi, null);
    assert.equal(result.vitals.bmiCategory, null);
  }
});

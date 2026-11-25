import assert from 'node:assert/strict';
import test from 'node:test';
import { ageAtDate, classifyClinicalVitals } from '../../shared/clinicalScreening.js';

const adult = (vitals) => classifyClinicalVitals(vitals, { ageYears: 30 });
const classification = (result, field) => result.classifications[field].classification;

test('adult blood pressure uses inclusive highest-category-first systolic OR diastolic rules', () => {
  const cases = [
    ['119/79', 'Normal'], ['120/79', 'Normal'], ['120/80', 'Normal'],
    ['121/80', 'Elevated'], ['129/80', 'Elevated'], ['130/80', 'Stage 1 Hypertension'],
    ['120/81', 'Stage 1 Hypertension'], ['139/89', 'Stage 1 Hypertension'],
    ['140/79', 'Stage 2 Hypertension'], ['119/90', 'Stage 2 Hypertension'], ['179/119', 'Stage 2 Hypertension'],
    ['180/100', 'Severe Blood Pressure Alert'], ['150/120', 'Severe Blood Pressure Alert'], ['180/120', 'Severe Blood Pressure Alert'],
  ];
  for (const [bp, expected] of cases) assert.equal(classification(adult({ bp }), 'bloodPressure'), expected, bp);
  assert.equal(adult({ bp: '89/59' }).lowBloodPressureFlag, true);
  assert.equal(classification(classifyClinicalVitals({ bp: '119/79' }), 'bloodPressure'), 'Not classified');
});

test('adult BMI uses unrounded value and never classifies invalid or incomplete measurements', () => {
  const cases = [[18.49, 'Underweight'], [18.5, 'Normal'], [22.99, 'Normal'], [23, 'Overweight'],
    [24.99, 'Overweight'], [25, 'Obese Class I'], [29.99, 'Obese Class I'], [30, 'Obese Class II']];
  for (const [bmi, expected] of cases) {
    const heightCm = 100;
    const weightKg = bmi;
    assert.equal(classification(adult({ heightCm, weightKg }), 'bmi'), expected, String(bmi));
  }
  for (const vitals of [{ heightCm: 0, weightKg: 50 }, { heightCm: 160 }, { heightCm: -160, weightKg: 50 }]) {
    assert.equal(classification(adult(vitals), 'bmi'), 'Not assessed');
  }
});

test('oxygen saturation, adult respiratory rate, temperature, and heart rate boundaries are exact', () => {
  for (const [value, expected] of [[100, 'Normal Reference Range'], [95, 'Normal Reference Range'],
    [94, 'Borderline Oxygen Saturation'], [93, 'Reduced Oxygen Saturation'], [90, 'Reduced Oxygen Saturation'],
    [89, 'Critical Low Oxygen Saturation Alert']]) {
    assert.equal(classification(adult({ o2sat: value }), 'oxygenSaturation'), expected, `${value}%`);
  }
  for (const [value, expected] of [[11, 'Below Normal Reference Range'], [12, 'Normal Reference Range'],
    [20, 'Normal Reference Range'], [21, 'Elevated Respiratory Rate'], [29, 'Elevated Respiratory Rate'],
    [30, 'Priority Clinical Assessment Flag']]) {
    assert.equal(classification(adult({ rr: value }), 'respiratoryRate'), expected, `${value}/min`);
  }
  for (const [value, expected] of [[34.9, 'Hypothermia Alert'], [35, 'Below Normal Reference Range'],
    [36, 'Below Normal Reference Range'], [36.5, 'Normal Reference Range'], [37.3, 'Normal Reference Range'],
    [37.8, 'Above Normal Reference Range'], [38, 'Fever'], [39.9, 'Fever'], [40, 'Very High Temperature Alert']]) {
    assert.equal(classification(adult({ temperature: value }), 'temperature'), expected, `${value} C`);
  }
  for (const [value, expected] of [[59, 'Below Normal Resting Heart Rate'], [60, 'Normal Reference Range'],
    [100, 'Normal Reference Range'], [101, 'Elevated Resting Heart Rate'], [124, 'Elevated Resting Heart Rate'],
    [125, 'Priority Clinical Assessment Flag']]) {
    assert.equal(classification(adult({ hr: value }), 'heartRate'), expected, `${value} bpm`);
  }
});

test('special populations do not receive adult BP or BMI labels; supported child breathing thresholds are age-specific', () => {
  const maternal = classifyClinicalVitals({ bp: '145/95', heightCm: 160, weightKg: 65 }, { ageYears: 30, pregnancy: true });
  assert.equal(classification(maternal, 'bloodPressure'), 'Not classified');
  assert.equal(classification(maternal, 'bmi'), 'Not classified');
  const child = classifyClinicalVitals({ rr: 50 }, { ageYears: 0.5 });
  assert.equal(classification(child, 'respiratoryRate'), 'Fast Breathing for Age');
  assert.equal(classification(child, 'bloodPressure'), 'Not classified');
  assert.equal(classification(classifyClinicalVitals({ rr: 29 }, { ageYears: 8 }), 'respiratoryRate'), 'Not classified');
  assert.equal(ageAtDate('2020-11-25', new Date('2026-11-25T00:00:00Z')), 6);
  assert.equal(ageAtDate('2030-01-01', new Date('2026-11-25T00:00:00Z')), null);
});

test('invalid and missing measurements remain unknown and severe screening alerts stay separate', () => {
  const output = adult({ bp: 'invalid', o2sat: 101, temperature: 99, hr: 0, rr: -1 });
  assert.equal(classification(output, 'bloodPressure'), 'Not classified');
  assert.equal(classification(output, 'oxygenSaturation'), 'Not assessed');
  assert.equal(classification(output, 'temperature'), 'Not assessed');
  assert.equal(classification(output, 'heartRate'), 'Not assessed');
  assert.equal(classification(output, 'respiratoryRate'), 'Not assessed');
  const severe = adult({ bp: '180/120' });
  assert.equal(severe.alerts[0].classification, 'Severe Blood Pressure Alert');
  assert.equal(severe.decisionSupportOnly, true);
});

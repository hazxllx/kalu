import test from 'node:test';
import assert from 'node:assert/strict';

import { validateVitals, validateFollowUp, list, create } from '../src/services/consultations.service.js';

/**
 * Consultation data-integrity tests (issue #14 / #15).
 * Server-side validation of vitals and follow-up date consistency — independent
 * of any HTML input constraints. These are pure functions, no DB required.
 */

test('valid vitals produce no errors', () => {
  assert.deepEqual(validateVitals({
    bloodPressure: '120/80', temperature: 36.6, pulseRate: 72,
    respiratoryRate: 16, height: 165, weight: 60, oxygenSaturation: 98,
  }), []);
});

test('all vitals are optional (empty payload is valid)', () => {
  assert.deepEqual(validateVitals({}), []);
});

test('negative and absurd vitals are rejected', () => {
  const errors = validateVitals({ temperature: -5, pulseRate: 0, weight: -3, oxygenSaturation: 250 });
  assert.ok(errors.some((e) => /Temperature/.test(e)));
  assert.ok(errors.some((e) => /Pulse/.test(e)));
  assert.ok(errors.some((e) => /Weight/.test(e)));
  assert.ok(errors.some((e) => /Oxygen/.test(e)));
});

test('malformed blood pressure is rejected', () => {
  assert.ok(validateVitals({ bloodPressure: 'abc' }).length > 0);
  assert.ok(validateVitals({ bloodPressure: '120-80' }).length > 0);
});

test('impossible blood pressure relationships are rejected', () => {
  assert.ok(validateVitals({ bloodPressure: '80/120' }).some((e) => /greater than diastolic/.test(e)));
  assert.ok(validateVitals({ bloodPressure: '400/80' }).some((e) => /Systolic/.test(e)));
});

test('follow-up required with no next visit date is rejected', () => {
  const { errors } = validateFollowUp({ followUpRequired: 'Yes', consultationDate: '2026-09-27' });
  assert.ok(errors.some((e) => /next visit date is required/i.test(e)));
});

test('follow-up not required clears any next visit date (no contradiction stored)', () => {
  const { errors, normalized } = validateFollowUp({ followUpRequired: 'No', nextVisitDate: '2026-10-05', consultationDate: '2026-09-27' });
  assert.deepEqual(errors, []);
  assert.equal(normalized.nextVisitDate, '');
});

test('next visit date before the consultation date is rejected', () => {
  const { errors } = validateFollowUp({ followUpRequired: 'Yes', nextVisitDate: '2026-09-20', consultationDate: '2026-09-27' });
  assert.ok(errors.some((e) => /cannot be before the consultation date/i.test(e)));
});

test('an invalid next visit date is rejected', () => {
  const { errors } = validateFollowUp({ nextVisitDate: 'not-a-date' });
  assert.ok(errors.some((e) => /invalid/i.test(e)));
});

test('a valid follow-up on/after the consultation date passes', () => {
  const { errors, normalized } = validateFollowUp({ followUpRequired: 'Yes', nextVisitDate: '2026-10-05', consultationDate: '2026-09-27' });
  assert.deepEqual(errors, []);
  assert.equal(normalized.nextVisitDate, '2026-10-05');
});

test('resident consultation history is queried only for the account-linked resident', async () => {
  const calls = [];
  const repo = {
    getResidentByAuthUserId: async (authUserId) => {
      assert.equal(authUserId, 'resident-user-a');
      return { id: 'resident-a' };
    },
    listVisits: async (options) => {
      calls.push(options);
      return {
        rows: [{
          id: 'visit-a', residentId: 'resident-a', visitDate: '2026-09-27T09:00:00',
          status: 'completed', resident: { id: 'resident-a', firstName: 'Resident', lastName: 'A' },
        }],
        total: 1,
      };
    },
  };

  const result = await list({ user: { id: 'resident-user-a', role: 'resident' }, repo });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].residentId, 'resident-a');
  assert.equal(result.rows[0].id, 'visit-a');
  assert.equal(result.rows[0].resident.id, 'resident-a');
});

test('residents cannot create consultations', async () => {
  await assert.rejects(
    create({ user: { id: 'resident-user-a', role: 'resident' }, payload: {} }),
    { statusCode: 403 },
  );
});

test('consultation submission errors identify invalid form fields', async () => {
  await assert.rejects(
    create({
      user: { id: 'hs-1', role: 'health_supervisor' },
      payload: {
        residentId: 'RES-1',
        consultationDate: '2026-09-27',
        chiefComplaint: 'Check-up',
        findings: 'Stable',
        diagnosis: 'None',
        bloodPressure: 'invalid',
        temperature: 50,
        followUpRequired: 'Yes',
        nextVisitDate: '2026-09-20',
      },
    }),
    (error) => {
      assert.equal(error.statusCode, 422);
      assert.match(error.details.bloodPressure, /systolic\/diastolic/i);
      assert.match(error.details.temperature, /between 30 and 45/i);
      assert.match(error.details.nextVisitDate, /before the consultation date/i);
      return true;
    },
  );
});

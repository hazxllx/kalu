import test from 'node:test';
import assert from 'node:assert/strict';
import { updateHouseholdValidator, householdVisitValidator } from '../src/validators/household.validators.js';

test('household updates preserve all fields from the existing profiling sections', () => {
  const patch = {
    nhts: 'NHTS-4Ps',
    ip: 'Non-IP',
    philhealthMember: true,
    philhealthId: 'PH-123',
    philhealthCategory: 'Indigent',
    waterType: 'Deep well',
    waterDistance: '100–250 m',
    waterAvailability: 'Available year-round',
    waterTreated: true,
    treatmentMethods: ['Boiling', 'Filtration'],
    sanitationAccess: 'Shared',
    wasteDisposal: 'Collected',
    wasteSegregation: 'Yes',
  };

  const result = updateHouseholdValidator({ household: patch });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.value.household, patch);
});

test('household visits require an allowed reason and retain changed sections', () => {
  const result = householdVisitValidator({
    visit: {
      visitDate: '2026-11-05',
      requestId: 'c868ab28-b8b4-4a59-9c54-633f208692f0',
      visitReason: 'Updating Household Information',
      updatedSections: ['Respondent Information', 'Household Members'],
    },
  });

  assert.equal(result.error, undefined);
  assert.deepEqual(result.value.visit.updatedSections, ['Respondent Information', 'Household Members']);
});

test('household visits reject missing reasons', () => {
  const result = householdVisitValidator({
    visit: {
      visitDate: '2026-11-05',
      requestId: 'c868ab28-b8b4-4a59-9c54-633f208692f0',
      updatedSections: [],
    },
  });

  assert.ok(result.error.visitReason);
});

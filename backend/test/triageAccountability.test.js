import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import repository from '../src/repositories/index.js';
import * as intakeService from '../src/services/intake.service.js';

const original = {};
const STUBBED = ['getResident', 'nextSubmissionId', 'insertVisit', 'getVisit'];

let savedVisit;
const RESIDENT = { id: 'resident-1', firstName: 'Rosa', lastName: 'Santos', barangay: 'San Isidro' };
const USER = {
  id: 'staff-1',
  role: 'health_supervisor',
  name: 'Nurse Santos',
  barangay: 'San Isidro',
  municipalityId: 'municipality-1',
};

before(() => {
  for (const key of STUBBED) original[key] = repository[key];
  repository.getResident = async (id) => (id === RESIDENT.id ? RESIDENT : null);
  repository.nextSubmissionId = async () => ({ id: 'visit-1' });
  repository.insertVisit = async (visit) => {
    savedVisit = { ...visit };
    return { ...savedVisit, resident: RESIDENT };
  };
  repository.getVisit = async (id) => (id === savedVisit?.id ? { ...savedVisit, resident: RESIDENT } : null);
});

after(() => {
  for (const key of STUBBED) repository[key] = original[key];
});

beforeEach(() => {
  savedVisit = null;
});

test('triage creation assigns responsible personnel from the authenticated user', async () => {
  const created = await intakeService.createSubmission({
    residentId: RESIDENT.id,
    visit: { chiefComplaint: 'Fever', responsiblePersonnelId: 'spoofed-id', responsiblePersonnelName: 'Spoofed name' },
    user: USER,
  });

  assert.equal(created.responsiblePersonnelId, USER.id);
  assert.equal(created.responsiblePersonnelName, USER.name);
});

test('request body personnel fields cannot override the authenticated user', async () => {
  await intakeService.createSubmission({
    residentId: RESIDENT.id,
    visit: { chiefComplaint: 'Fever', assignedPersonnel: 'Client supplied name', responsiblePersonnelId: 'spoofed-id' },
    user: USER,
  });

  assert.equal(savedVisit.responsiblePersonnelId, USER.id);
  assert.equal(savedVisit.responsiblePersonnelName, USER.name);
});

test('fetched triage entry includes its recorded responsible personnel', async () => {
  await intakeService.createSubmission({
    residentId: RESIDENT.id,
    visit: { chiefComplaint: 'Fever' },
    user: USER,
  });

  const fetched = await intakeService.getSubmissionForIntake({ id: 'visit-1', user: USER });
  assert.equal(fetched.responsiblePersonnelId, USER.id);
  assert.equal(fetched.responsiblePersonnelName, USER.name);
});

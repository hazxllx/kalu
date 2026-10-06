import test from 'node:test';
import assert from 'node:assert/strict';

import { addHouseholdMember, searchHouseholdResidents } from '../src/services/households.service.js';

const USER = {
  id: 'bhw-1',
  role: 'bhw',
  municipalityId: 'mun-1',
  barangay: 'Pili',
  assignedBarangay: 'Pili',
};
const HOUSEHOLD_ID = 'HH-001';
const EXISTING_RESIDENT = {
  id: 'RES-001',
  firstName: 'Maria',
  lastName: 'Santos',
  birthDate: '1990-04-03',
  barangay: 'Pili',
  barangayId: 'brgy-1',
  municipalityId: 'mun-1',
  verificationStatus: 'approved',
};

const makeRepo = () => {
  const state = {
    residents: [EXISTING_RESIDENT],
    members: [],
    insertedResidents: [],
    nextResidentIds: 1,
  };
  const household = () => ({
    id: HOUSEHOLD_ID,
    barangay: 'Pili',
    barangayId: 'brgy-1',
    municipalityId: 'mun-1',
    members: [...state.members],
  });
  const repo = {
    state,
    getHousehold: async (id) => id === HOUSEHOLD_ID ? household() : null,
    getResident: async (id) => state.residents.find((resident) => resident.id === id) || null,
    listResidents: async ({ q, barangay, limit }) => ({
      rows: state.residents
        .filter((resident) => resident.barangay === barangay)
        .filter((resident) => `${resident.firstName} ${resident.lastName}`.toLowerCase().includes(q.toLowerCase()))
        .slice(0, limit),
    }),
    findResidentByIdentity: async ({ firstName, lastName, birthDate }) => state.residents.find((resident) =>
      resident.firstName.toLowerCase() === firstName.toLowerCase()
      && resident.lastName.toLowerCase() === lastName.toLowerCase()
      && resident.birthDate === birthDate) || null,
    findBarangayByName: async () => ({ id: 'brgy-1', name: 'Pili', municipalityId: 'mun-1' }),
    nextResidentIds: async () => {
      const value = state.nextResidentIds++;
      return { id: `RES-NEW-${value}`, healthRecordNo: `RHU-NEW-${value}` };
    },
    insertResident: async (resident) => {
      state.insertedResidents.push(resident);
      state.residents.push(resident);
      return resident;
    },
    addHouseholdMember: async (_householdId, member) => {
      const created = { id: `member-${state.members.length + 1}`, ...member };
      state.members.push(created);
      return created;
    },
  };
  return repo;
};

test('links an existing resident without creating a duplicate resident row', async () => {
  const repo = makeRepo();
  const result = await addHouseholdMember({
    id: HOUSEHOLD_ID,
    user: USER,
    repo,
    member: {
      name: 'Maria Santos',
      residentId: EXISTING_RESIDENT.id,
      relationship: 'Spouse',
      sex: 'Female',
    },
  });
  assert.equal(result.member.residentId, EXISTING_RESIDENT.id);
  assert.equal(repo.state.insertedResidents.length, 0);
});

test('creates a new resident when identity has no match, without creating credentials', async () => {
  const repo = makeRepo();
  const result = await addHouseholdMember({
    id: HOUSEHOLD_ID,
    user: USER,
    repo,
    member: {
      name: 'Jose Reyes',
      relationship: 'Child',
      sex: 'Male',
      newResident: { firstName: 'Jose', lastName: 'Reyes', birthDate: '2018-02-14', sex: 'Male' },
    },
  });
  assert.equal(repo.state.insertedResidents.length, 1);
  assert.equal(result.member.residentId, 'RES-NEW-1');
  assert.equal(repo.state.insertedResidents[0].authUserId, undefined);
  assert.equal(repo.state.insertedResidents[0].verificationStatus, 'pending');
});

test('rejects a new resident when first name, last name and birthdate already match', async () => {
  const repo = makeRepo();
  await assert.rejects(
    () => addHouseholdMember({
      id: HOUSEHOLD_ID,
      user: USER,
      repo,
      member: {
        name: 'Maria Santos',
        relationship: 'Spouse',
        sex: 'Female',
        newResident: { firstName: 'maria', lastName: 'SANTOS', birthDate: '1990-04-03' },
      },
    }),
    (error) => error.statusCode === 409,
  );
  assert.equal(repo.state.insertedResidents.length, 0);
});

test('keeps accountless household members unlinked to a resident', async () => {
  const repo = makeRepo();
  const result = await addHouseholdMember({
    id: HOUSEHOLD_ID,
    user: USER,
    repo,
    member: { name: 'Accountless Member', relationship: 'Other', sex: 'Female' },
  });
  assert.equal(result.member.residentId, null);
  assert.equal(repo.state.insertedResidents.length, 0);
});

test('resident search returns only residents scoped to the BHW barangay', async () => {
  const repo = makeRepo();
  repo.state.residents.push({ ...EXISTING_RESIDENT, id: 'RES-OTHER', barangay: 'Other' });
  const rows = await searchHouseholdResidents({ user: USER, q: 'maria', repo });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].residentId, EXISTING_RESIDENT.id);
  assert.equal(rows[0].verified, true);
});

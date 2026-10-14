import assert from 'node:assert/strict';
import test from 'node:test';

import * as householdsService from '../src/services/households.service.js';
import repository from '../src/repositories/index.js';

const assignedBhw = {
  id: 'profile-id',
  role: 'bhw',
  municipalityId: 'municipality-id',
  barangayId: 'san-antonio-id',
  barangay: 'San Antonio',
};

test('BHW household listing scopes by assigned barangay ID and municipality', async () => {
  const originalList = repository.listHouseholds;
  let query;
  repository.listHouseholds = async (params) => {
    query = params;
    return { rows: [], total: 0 };
  };

  try {
    await householdsService.listHouseholds({ user: assignedBhw, limit: 20, offset: 40 });
    assert.equal(query.barangayId, assignedBhw.barangayId);
    assert.equal(query.barangay, null);
    assert.equal(query.municipalityId, assignedBhw.municipalityId);
    assert.equal(query.limit, 20);
    assert.equal(query.offset, 40);
  } finally {
    repository.listHouseholds = originalList;
  }
});

test('BHW cannot request another barangay even when the query is supplied directly', async () => {
  await assert.rejects(
    householdsService.listHouseholds({ user: assignedBhw, barangay: 'San Isidro' }),
    (error) => error.statusCode === 403,
  );
});

test('BHW without a valid barangay assignment receives an actionable 403', async () => {
  await assert.rejects(
    householdsService.listHouseholds({
      user: { ...assignedBhw, barangayId: null },
    }),
    (error) => error.statusCode === 403 && /valid approved barangay assignment/i.test(error.message),
  );
});
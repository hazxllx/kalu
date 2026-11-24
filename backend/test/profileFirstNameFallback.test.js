import assert from 'node:assert/strict';
import test from 'node:test';

import { loadProfile, profileToSessionUser } from '../src/services/profile.service.js';

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'bhw@example.test',
  full_name: 'San Isidro BHW',
  role: 'bhw',
  status: 'active',
  municipality_id: '22222222-2222-4222-8222-222222222222',
  barangay_id: '33333333-3333-4333-8333-333333333333',
  rhu_stations: [],
};

const clientReturning = (responseForSelect) => {
  const selections = [];
  return {
    selections,
    client: {
      from: (table) => ({
        select: (selection) => {
          assert.equal(table, 'profiles');
          selections.push(selection);
          return {
            eq: () => ({ maybeSingle: async () => responseForSelect(selection) }),
          };
        },
      }),
    },
  };
};

test('authenticated profile loads without firstName when the database has not applied its migration', async () => {
  const { client, selections } = clientReturning((selection) => selection.includes('first_name')
    ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'first_name' column in the schema cache." } }
    : { data: profile, error: null });

  const result = await loadProfile(profile.id, client);
  assert.equal(result.error, null);
  assert.equal(result.profile.id, profile.id);
  assert.equal(selections.length, 2);
  assert.doesNotMatch(selections[1], /first_name/);
  assert.equal(profileToSessionUser(result.profile).firstName, '');
});

test('profile lookup does not hide unrelated missing-column errors', async () => {
  const { client, selections } = clientReturning(() => ({
    data: null,
    error: { code: 'PGRST204', message: "Could not find the 'role' column in the schema cache." },
  }));

  const result = await loadProfile(profile.id, client);
  assert.equal(result.error.code, 'PGRST204');
  assert.equal(selections.length, 1);
});

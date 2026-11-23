import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeImmunizationVaccine } from '../src/services/operational.service.js';

test('custom vaccine selection stores its trimmed display name and preserves the Other marker', () => {
  assert.deepEqual(normalizeImmunizationVaccine({
    vaccine: 'Measles',
    vaccine_selection: 'Other',
    custom_vaccine_name: '  Yellow fever  ',
  }), {
    vaccine: 'Yellow fever',
    vaccine_selection: 'Other',
    custom_vaccine_name: 'Yellow fever',
  });
});

test('custom vaccine selection rejects an empty or whitespace-only name', () => {
  for (const custom_vaccine_name of ['', '   ']) {
    assert.throws(
      () => normalizeImmunizationVaccine({ vaccine: 'Other', vaccine_selection: 'Other', custom_vaccine_name }),
      /Specify the vaccine name/,
    );
  }
});

test('predefined selections are saved as the vaccine and clear stale custom names', () => {
  assert.deepEqual(normalizeImmunizationVaccine({
    vaccine: 'BCG',
    vaccine_selection: 'BCG',
    custom_vaccine_name: 'Old custom value',
  }), {
    vaccine: 'BCG',
    vaccine_selection: 'BCG',
    custom_vaccine_name: null,
  });
});

test('unsupported vaccine dropdown values are rejected', () => {
  assert.throws(
    () => normalizeImmunizationVaccine({ vaccine: 'Unlisted', vaccine_selection: 'Unlisted' }),
    /Select a valid predefined vaccine/,
  );
});

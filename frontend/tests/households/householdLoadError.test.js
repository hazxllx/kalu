import assert from 'node:assert/strict';
import test from 'node:test';

import { householdLoadErrorMessage } from '../../src/features/households/lib/householdLoadError.js';

test('household load errors distinguish expired authentication', () => {
  assert.match(householdLoadErrorMessage({ status: 401 }), /session has expired or is invalid/i);
});

test('household load errors identify missing barangay assignment', () => {
  assert.match(
    householdLoadErrorMessage({
      status: 403,
      payload: { error: { message: 'Your account is missing a valid approved barangay assignment.' } },
    }),
    /barangay assignment is missing/i,
  );
});

test('household load errors distinguish permission denial', () => {
  assert.match(householdLoadErrorMessage({ status: 403 }), /do not have permission/i);
});

test('household load errors distinguish unavailable service and database failures', () => {
  assert.match(householdLoadErrorMessage({ status: 503 }), /service is unavailable/i);
  assert.match(householdLoadErrorMessage({ status: 500 }), /database request/i);
  assert.match(householdLoadErrorMessage(new TypeError('Failed to fetch')), /service is unavailable/i);
});

test('unexpected request failures do not resemble an empty household result', () => {
  assert.match(householdLoadErrorMessage(new Error('Invalid household response')), /request could not be completed/i);
});
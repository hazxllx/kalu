import assert from 'node:assert/strict';
import test from 'node:test';

import { readPermissionMatrix } from '../../src/services/api/rolesPermissionsResponse.js';
import { permissionLoadErrorMessage } from '../../src/services/api/permissionLoadError.js';

test('permission responses preserve a valid matrix, including an empty matrix', () => {
  assert.deepEqual(readPermissionMatrix({ matrix: {} }), {});
  assert.deepEqual(readPermissionMatrix({ matrix: { resident: { 'resident.view': true } } }), {
    resident: { 'resident.view': true },
  });
});

test('HTML or malformed endpoint responses fail as configuration errors', () => {
  assert.throws(
    () => readPermissionMatrix('<!doctype html><html></html>'),
    (error) => {
      assert.equal(error.code, 'INVALID_PERMISSION_MATRIX_RESPONSE');
      assert.match(permissionLoadErrorMessage(error), /API URL and backend deployment/i);
      return true;
    },
  );
  assert.throws(() => readPermissionMatrix({ matrix: [] }), /invalid response/i);
});

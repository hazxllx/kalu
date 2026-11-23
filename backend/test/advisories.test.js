import assert from 'node:assert/strict';
import test from 'node:test';

import * as advisories from '../src/services/advisories.service.js';
import { validateAdvisory, validateId, validateStatus } from '../src/validators/advisories.validators.js';

const admin = { id: 'admin-id', role: 'admin' };
const validPayload = { title: 'Clinic hours', message: '  Open Saturday.  ', isActive: true, displayOrder: 2 };

test('advisory validation trims content and applies safe defaults', () => {
  assert.deepEqual(validateAdvisory({ message: '  Clinic is open.  ' }), {
    value: { title: null, message: 'Clinic is open.', isActive: true, displayOrder: 0 },
  });
  assert.ok(validateAdvisory({ message: ' \n ' }).error.message);
  assert.ok(validateAdvisory(null).error.body);
  assert.ok(validateAdvisory({ ...validPayload, displayOrder: '2' }).error.displayOrder);
  assert.ok(validateAdvisory({ ...validPayload, title: 42 }).error.title);
  assert.ok(validateStatus({ isActive: 'false' }).error.isActive);
  assert.ok(validateId({ id: 'not-a-uuid' }).error.id);
});

test('administrator is required at the service boundary for advisory mutations and listing', async () => {
  const repo = {
    createAdvisory: async () => assert.fail('must not write'),
    listAdvisories: async () => assert.fail('must not read'),
  };
  await assert.rejects(
    advisories.createAdvisory({ user: { id: 'staff-id', role: 'phn' }, payload: validPayload, repo }),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    advisories.listAdvisories({ user: { role: 'resident' }, repo }),
    (error) => error.statusCode === 403,
  );
});

test('administrator creates and updates an advisory using the repository contract', async () => {
  const calls = [];
  const repo = {
    createAdvisory: async (payload) => {
      calls.push(['create', payload]);
      return { id: 'new-id', ...payload };
    },
    updateAdvisory: async (id, payload) => {
      calls.push(['update', id, payload]);
      return { id, ...payload };
    },
    setAdvisoryStatus: async (id, isActive) => ({ id, isActive }),
    deleteAdvisory: async (id) => id === 'existing-id',
  };

  const created = await advisories.createAdvisory({ user: admin, payload: validPayload, repo });
  assert.equal(created.createdBy, admin.id);
  assert.equal(calls[0][1].createdBy, admin.id);

  const updated = await advisories.updateAdvisory({
    user: admin,
    id: 'existing-id',
    payload: { ...validPayload, message: 'Updated notice' },
    repo,
  });
  assert.equal(updated.message, 'Updated notice');
  assert.deepEqual(await advisories.setAdvisoryStatus({ user: admin, id: 'existing-id', isActive: false, repo }), {
    id: 'existing-id',
    isActive: false,
  });
  await advisories.deleteAdvisory({ user: admin, id: 'existing-id', repo });
});

test('missing advisories are reported rather than silently treated as updated or deleted', async () => {
  const repo = {
    updateAdvisory: async () => null,
    setAdvisoryStatus: async () => null,
    deleteAdvisory: async () => false,
  };
  await assert.rejects(
    advisories.updateAdvisory({ user: admin, id: 'missing-id', payload: validPayload, repo }),
    (error) => error.statusCode === 404,
  );
  await assert.rejects(
    advisories.setAdvisoryStatus({ user: admin, id: 'missing-id', isActive: false, repo }),
    (error) => error.statusCode === 404,
  );
  await assert.rejects(
    advisories.deleteAdvisory({ user: admin, id: 'missing-id', repo }),
    (error) => error.statusCode === 404,
  );
});

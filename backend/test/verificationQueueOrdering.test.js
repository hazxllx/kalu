import assert from 'node:assert/strict';
import test from 'node:test';
import repository from '../src/repositories/fileRepository.js';
import store from '../src/repositories/fileStore.js';

test('verification queue sorts submissions newest-first before pagination and filtering', async (t) => {
  store.ensureLoaded();
  const originalResidents = store.data.residents;
  store.data.residents = [
    { id: 'RES-OLDER', firstName: 'Alex', verificationStatus: 'pending', submittedForVerificationAt: '2026-03-01T10:00:00Z' },
    { id: 'RES-NEWEST', firstName: 'Alex', verificationStatus: 'approved', submittedForVerificationAt: '2026-03-03T10:00:00Z' },
    { id: 'RES-MIDDLE', firstName: 'Alex', verificationStatus: 'rejected', submittedForVerificationAt: '2026-03-02T10:00:00Z' },
  ];
  t.after(() => {
    store.data.residents = originalResidents;
  });

  const firstPage = await repository.listResidentsByVerificationStatus({ q: 'Alex', limit: 2, offset: 0 });
  assert.deepEqual(firstPage.rows.map((row) => row.id), ['RES-NEWEST', 'RES-MIDDLE']);
  assert.equal(firstPage.total, 3);

  const approved = await repository.listResidentsByVerificationStatus({ statuses: ['approved'], limit: 2 });
  assert.deepEqual(approved.rows.map((row) => row.id), ['RES-NEWEST']);
});

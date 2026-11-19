import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeMedications,
  normalizeCatalogEntry,
  createMedicine,
  updateMedicine,
} from '../src/services/medicines.service.js';
import { DEFAULT_MEDICINES, medicineIdentityKey } from '../src/config/medicineCatalog.js';

test('normalizeMedications rejects invalid entries with field-specific errors', () => {
  assert.throws(
    () => normalizeMedications([{ genericName: 'Amoxicillin' }, { dose: '250 mg' }, null]),
    (error) => error.statusCode === 422
      && error.details['medications[1].genericName'] === 'This field is required.'
      && error.details['medications[2]'] === 'Use a medication object.',
  );
});

test('normalizeMedications flags catalog vs custom entries', () => {
  const out = normalizeMedications([
    { medicineId: 'abc', genericName: 'Metformin', source: 'yakap' },
    { genericName: 'Herbal mix' },
  ]);
  assert.equal(out[0].custom, false);
  assert.equal(out[0].source, 'yakap');
  assert.equal(out[1].custom, true);
  assert.equal(out[1].source, 'custom');
});

test('normalizeMedications preserves optional prescription detail verbatim', () => {
  const [m] = normalizeMedications([{
    genericName: 'Paracetamol', dose: '  1 tab  ', route: 'Oral', frequency: 'TID', duration: '5 days', quantity: '15', instructions: 'After meals',
  }]);
  assert.equal(m.dose, '  1 tab  ');
  assert.equal(m.frequency, 'TID');
  assert.equal(m.instructions, 'After meals');
  assert.deepEqual(normalizeMedications([{ genericName: 'Paracetamol' }])[0], {
    medicineId: null,
    genericName: 'Paracetamol',
    brandName: '',
    strength: '',
    dosageForm: '',
    dose: '',
    route: '',
    frequency: '',
    duration: '',
    quantity: '',
    instructions: '',
    custom: true,
    source: 'custom',
  });
});

test('normalizeMedications rejects overlong fields, unsupported content, and too many entries', () => {
  assert.throws(
    () => normalizeMedications([{ genericName: 'Paracetamol', instructions: 'x'.repeat(401) }]),
    (error) => error.details['medications[0].instructions'] === 'Use 400 characters or fewer.',
  );
  assert.throws(
    () => normalizeMedications([{ genericName: 'Paracetamol', instrutions: '1 tablet' }]),
    (error) => error.details['medications[0].instrutions'] === 'This prescription field is not supported.',
  );
  const many = Array.from({ length: 51 }, (_, i) => ({ genericName: `Med ${i}` }));
  assert.throws(
    () => normalizeMedications(many),
    (error) => error.details.medications === 'Add no more than 50 medication entries.',
  );
});

test('normalizeMedications accepts absent data but rejects non-array values', () => {
  assert.deepEqual(normalizeMedications(undefined), []);
  assert.throws(
    () => normalizeMedications('x'),
    (error) => error.details.medications === 'Use a list of prescription entries.',
  );
});

test('normalizeCatalogEntry requires a generic name and defaults the source', () => {
  assert.throws(() => normalizeCatalogEntry({ genericName: '' }), (e) => e.statusCode === 422);
  const entry = normalizeCatalogEntry({ genericName: 'Losartan', strength: '50 mg', dosageForm: 'Tablet' });
  assert.equal(entry.source, 'local');
  assert.equal(entry.active, true);
});

test('normalizeCatalogEntry reports long reference text instead of truncating', () => {
  assert.throws(
    () => normalizeCatalogEntry({ genericName: 'Test medicine', dosageInstructions: 'x'.repeat(601) }),
    (error) => error.statusCode === 422 && error.details.dosageInstructions === 'Use 600 characters or fewer.',
  );
});

test('default catalog contains no generic dosage recommendations', () => {
  assert.ok(DEFAULT_MEDICINES.length > 0);
  assert.ok(DEFAULT_MEDICINES.every((medicine) => !medicine.dosageInstructions));
});

test('medicineIdentityKey is case-insensitive on the identifying triple', () => {
  assert.equal(
    medicineIdentityKey({ genericName: 'Amoxicillin', strength: '500 MG', dosageForm: 'Capsule' }),
    medicineIdentityKey({ genericName: 'amoxicillin', strength: '500 mg', dosageForm: 'capsule' }),
  );
});

test('createMedicine rejects a duplicate on the identity triple', async () => {
  const repo = {
    insertMedicine: async (m) => ({ id: 'new', ...m }),
    findMedicineByIdentity: async () => ({ id: 'existing', genericName: 'Amoxicillin' }),
  };
  await assert.rejects(
    () => createMedicine({ user: { role: 'admin' }, payload: { genericName: 'Amoxicillin', strength: '500 mg', dosageForm: 'Capsule' }, repo }),
    (e) => e.statusCode === 409,
  );
});

test('createMedicine is admin-only', async () => {
  await assert.rejects(
    () => createMedicine({ user: { role: 'health_supervisor' }, payload: { genericName: 'X' }, repo: {} }),
    (e) => e.statusCode === 403,
  );
});

test('createMedicine persists a new catalog entry via the repo', async () => {
  let inserted = null;
  const repo = {
    findMedicineByIdentity: async () => null,
    insertMedicine: async (m) => { inserted = m; return { id: 'm1', ...m }; },
  };
  const saved = await createMedicine({
    user: { role: 'admin', id: 'admin-1' },
    payload: { genericName: 'Zinc Sulfate', strength: '20 mg', dosageForm: 'Tablet', source: 'local' },
    repo,
  });
  assert.equal(saved.id, 'm1');
  assert.equal(inserted.genericName, 'Zinc Sulfate');
  assert.equal(inserted.source, 'local');
});

test('createMedicine does not mark catalog text verified without reference provenance', async () => {
  let inserted;
  await createMedicine({
    user: { role: 'admin', id: 'admin-1' },
    payload: { genericName: 'Test medicine', dosageInstructions: 'Reference only' },
    repo: {
      findMedicineByIdentity: async () => null,
      insertMedicine: async (entry) => { inserted = entry; return { id: 'm2', ...entry }; },
    },
  });
  assert.equal(inserted.dosageVerifiedBy, undefined);
  assert.equal(inserted.dosageVerifiedAt, undefined);
});

test('updateMedicine clears verification metadata when reference text changes', async () => {
  let updated;
  const before = {
    id: 'm3', genericName: 'Test medicine', source: 'local', prescriptionRequirement: 'rx',
    dosageInstructions: 'Old reference', dosageVerifiedBy: 'admin-1', dosageVerifiedAt: '2026-01-01T00:00:00.000Z',
  };
  await updateMedicine({
    user: { role: 'admin', id: 'admin-2' },
    id: 'm3',
    payload: { dosageInstructions: 'New reference' },
    repo: {
      getMedicine: async () => before,
      updateMedicine: async (_id, patch) => { updated = patch; return { ...before, ...patch }; },
    },
  });
  assert.equal(updated.dosageVerifiedBy, null);
  assert.equal(updated.dosageVerifiedAt, null);
});

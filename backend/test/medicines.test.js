import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeMedications,
  normalizeCatalogEntry,
  createMedicine,
} from '../src/services/medicines.service.js';
import { medicineIdentityKey } from '../src/config/medicineCatalog.js';

test('normalizeMedications drops entries without a generic name', () => {
  const out = normalizeMedications([
    { genericName: 'Amoxicillin', strength: '500 mg' },
    { strength: '250 mg' },
    { genericName: '   ' },
    null,
    'nope',
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].genericName, 'Amoxicillin');
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

test('normalizeMedications preserves optional prescription detail and caps length', () => {
  const [m] = normalizeMedications([{
    genericName: 'Paracetamol', dose: '1 tab', route: 'Oral', frequency: 'TID', duration: '5 days', quantity: '15', instructions: 'After meals',
  }]);
  assert.equal(m.dose, '1 tab');
  assert.equal(m.frequency, 'TID');
  assert.equal(m.instructions, 'After meals');

  const many = Array.from({ length: 80 }, (_, i) => ({ genericName: `Med ${i}` }));
  assert.equal(normalizeMedications(many).length, 50);
});

test('normalizeMedications returns [] for non-arrays', () => {
  assert.deepEqual(normalizeMedications(undefined), []);
  assert.deepEqual(normalizeMedications('x'), []);
});

test('normalizeCatalogEntry requires a generic name and defaults the source', () => {
  assert.throws(() => normalizeCatalogEntry({ genericName: '' }), (e) => e.statusCode === 422);
  const entry = normalizeCatalogEntry({ genericName: 'Losartan', strength: '50 mg', dosageForm: 'Tablet' });
  assert.equal(entry.source, 'local');
  assert.equal(entry.active, true);
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

/**
 * Default medicine catalog — the generic-first seed list used when the database
 * catalog (public.medicines) is empty or unavailable (e.g. the file-repository
 * development/test backend).
 *
 * SOURCES:
 *   'yakap' — the 21 medicines identified in PhilHealth Advisory No. 2026-0007
 *             for YAKAP (reference:
 *             https://www.philhealth.gov.ph/advisories/2026/PA2026-0007.pdf).
 *   'local' — common primary-care medicines and supplements used at barangay
 *             health stations and municipal RHUs. These are NOT a guaranteed
 *             PhilHealth benefit and are not stocked at every facility.
 *
 * Generic names are the primary searchable term; brand/strength/form are
 * optional descriptors. The identity triple (generic + strength + form) is the
 * duplicate-detection key, mirroring the unique index in the migration.
 */

export const MEDICINE_SOURCES = Object.freeze(['yakap', 'local']);

export const DEFAULT_MEDICINES = Object.freeze([
  // --- PhilHealth Advisory 2026-0007 (YAKAP) — 21 medicines -----------------
  { genericName: 'Amoxicillin', strength: '500 mg', dosageForm: 'Capsule', category: 'Antibiotic', source: 'yakap' },
  { genericName: 'Co-amoxiclav', strength: '625 mg', dosageForm: 'Tablet', category: 'Antibiotic', source: 'yakap' },
  { genericName: 'Cotrimoxazole', strength: '800/160 mg', dosageForm: 'Tablet', category: 'Antibiotic', source: 'yakap' },
  { genericName: 'Nitrofurantoin', strength: '100 mg', dosageForm: 'Capsule', category: 'Antibiotic', source: 'yakap' },
  { genericName: 'Ciprofloxacin', strength: '500 mg', dosageForm: 'Tablet', category: 'Antibiotic', source: 'yakap' },
  { genericName: 'Clarithromycin', strength: '500 mg', dosageForm: 'Tablet', category: 'Antibiotic', source: 'yakap' },
  { genericName: 'Oral Rehydration Salts (ORS)', strength: '', dosageForm: 'Sachet', category: 'Electrolyte', source: 'yakap' },
  { genericName: 'Prednisone', strength: '20 mg', dosageForm: 'Tablet', category: 'Corticosteroid', source: 'yakap' },
  { genericName: 'Salbutamol', strength: '2 mg', dosageForm: 'Tablet', category: 'Bronchodilator', source: 'yakap' },
  { genericName: 'Fluticasone + Salmeterol', strength: '250/25 mcg', dosageForm: 'Inhaler', category: 'Respiratory', source: 'yakap' },
  { genericName: 'Paracetamol', strength: '500 mg', dosageForm: 'Tablet', category: 'Analgesic / Antipyretic', source: 'yakap' },
  { genericName: 'Gliclazide', strength: '80 mg', dosageForm: 'Tablet', category: 'Antidiabetic', source: 'yakap' },
  { genericName: 'Metformin', strength: '500 mg', dosageForm: 'Tablet', category: 'Antidiabetic', source: 'yakap' },
  { genericName: 'Simvastatin', strength: '20 mg', dosageForm: 'Tablet', category: 'Statin', source: 'yakap' },
  { genericName: 'Enalapril', strength: '10 mg', dosageForm: 'Tablet', category: 'Antihypertensive', source: 'yakap' },
  { genericName: 'Metoprolol', strength: '50 mg', dosageForm: 'Tablet', category: 'Antihypertensive', source: 'yakap' },
  { genericName: 'Amlodipine', strength: '5 mg', dosageForm: 'Tablet', category: 'Antihypertensive', source: 'yakap' },
  { genericName: 'Hydrochlorothiazide', strength: '25 mg', dosageForm: 'Tablet', category: 'Diuretic', source: 'yakap' },
  { genericName: 'Losartan', strength: '50 mg', dosageForm: 'Tablet', category: 'Antihypertensive', source: 'yakap' },
  { genericName: 'Aspirin', strength: '80 mg', dosageForm: 'Tablet', category: 'Antiplatelet', source: 'yakap' },
  { genericName: 'Chlorphenamine', strength: '4 mg', dosageForm: 'Tablet', category: 'Antihistamine', source: 'yakap' },
  // --- Local / facility catalog (NOT a guaranteed PhilHealth benefit) -------
  { genericName: 'Zinc Sulfate', strength: '20 mg', dosageForm: 'Tablet', category: 'Supplement', source: 'local' },
  { genericName: 'Ferrous Sulfate + Folic Acid', strength: '', dosageForm: 'Tablet', category: 'Supplement', source: 'local' },
  { genericName: 'Vitamin A', strength: '200,000 IU', dosageForm: 'Capsule', category: 'Supplement', source: 'local' },
  { genericName: 'Multivitamins', strength: '', dosageForm: 'Syrup', category: 'Supplement', source: 'local' },
]);

/** Case-insensitive identity key used to detect duplicate catalog entries. */
export const medicineIdentityKey = ({ genericName = '', strength = '', dosageForm = '' } = {}) =>
  [genericName, strength, dosageForm]
    .map((part) => String(part ?? '').trim().toLowerCase())
    .join('|');

export default { DEFAULT_MEDICINES, MEDICINE_SOURCES, medicineIdentityKey };

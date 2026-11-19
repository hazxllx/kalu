/**
 * Default medicine catalog: the generic-first seed list for the isolated file
 * repository. Supabase reads its own migrated public.medicines table and does
 * not substitute these entries on empty results or database failures.
 *
 * Architectural role: consumed in the `route -> authenticate -> authorize ->
 * controller -> medicineCatalog.service -> repository/Supabase` pipeline to
 * serve searchable clinical formularies during consultation prescribing and to
 * enforce admin catalog uniqueness.
 *
 * SOURCES:
 *   'yakap' — the 21 medicines identified in PhilHealth Advisory No. 2026-0007
 *             for YAKAP (reference:
 *             https://www.philhealth.gov.ph/advisories/2026/PA2026-0007.pdf).
 *   'local' — common primary-care medicines and supplements used at barangay
 *             health stations and municipal RHUs. These are NOT a guaranteed
 *             PhilHealth benefit and are not stocked at every facility.
 *
 * Generic names are the primary searchable term; brand name (e.g. "Biogesic"
 * for paracetamol), strength and form are optional descriptors. The identity
 * triple (generic + strength + form) is the duplicate-detection key, mirroring
 * the unique index in the migration, so products with the same active
 * ingredient are kept as a single entry rather than duplicated per brand.
 *
 * Entries can carry clinical reference information, but seed entries do not
 * include dosage instructions: patient-specific prescriptions must be entered
 * by the clinician, and reference text requires documented provenance before
 * it can be represented as verified.
 */

/** Supported catalog provenance tags (`yakap` PhilHealth benefit list vs `local` RHU/BHS formulary). */
export const MEDICINE_SOURCES = Object.freeze(['yakap', 'local']);

/** Prescription requirement: over-the-counter vs prescription-only. */
export const PRESCRIPTION_REQUIREMENTS = Object.freeze(['otc', 'rx']);

/**
 * Immutable seed formulary entries. Each entry specifies `genericName`,
 * `brandName`, `strength`, `dosageForm`, `category`, `source`,
 * `prescriptionRequirement`, and reference clinical guidance (`indication`,
 * `safetyNotes`, `contraindications`).
 */
export const DEFAULT_MEDICINES = Object.freeze([
  // --- PhilHealth Advisory 2026-0007 (YAKAP) — 21 medicines -----------------
  {
    genericName: 'Amoxicillin', brandName: 'Amoxil, Himox', strength: '500 mg', dosageForm: 'Capsule',
    category: 'Antibiotic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Bacterial infections of the respiratory tract, ear, urinary tract and skin.',
    safetyNotes: 'Complete the full prescribed course even if symptoms improve. May be taken with or without food.',
    contraindications: 'Known penicillin or cephalosporin hypersensitivity.',
  },
  {
    genericName: 'Co-amoxiclav', brandName: 'Augmentin', strength: '625 mg', dosageForm: 'Tablet',
    category: 'Antibiotic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Bacterial infections resistant to plain amoxicillin.',
    safetyNotes: 'Take at the start of a meal to reduce stomach upset. Finish the full course.',
    contraindications: 'Penicillin hypersensitivity; history of co-amoxiclav-associated jaundice/hepatic dysfunction.',
  },
  {
    genericName: 'Cotrimoxazole', brandName: 'Bactrim', strength: '800/160 mg', dosageForm: 'Tablet',
    category: 'Antibiotic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Urinary tract and respiratory infections; other susceptible infections.',
    safetyNotes: 'Drink plenty of water. Avoid prolonged sun exposure.',
    contraindications: 'Sulfonamide allergy; severe hepatic or renal impairment; pregnancy at term; infants < 2 months.',
  },
  {
    genericName: 'Nitrofurantoin', brandName: 'Macrobid', strength: '100 mg', dosageForm: 'Capsule',
    category: 'Antibiotic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Uncomplicated urinary tract infection.',
    safetyNotes: 'Take with food. Urine may turn dark yellow/brown (harmless).',
    contraindications: 'Significant renal impairment; pregnancy at term; infants < 1 month.',
  },
  {
    genericName: 'Ciprofloxacin', brandName: 'Cipro', strength: '500 mg', dosageForm: 'Tablet',
    category: 'Antibiotic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Urinary, gastrointestinal and other susceptible bacterial infections.',
    safetyNotes: 'Avoid dairy/antacids within 2 hours. Stay hydrated. Report tendon pain.',
    contraindications: 'Fluoroquinolone hypersensitivity; caution in children and pregnancy.',
  },
  {
    genericName: 'Clarithromycin', brandName: 'Klaricid', strength: '500 mg', dosageForm: 'Tablet',
    category: 'Antibiotic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Respiratory tract infections and H. pylori regimens.',
    safetyNotes: 'May interact with several medicines — review current medications.',
    contraindications: 'Macrolide hypersensitivity; concurrent use with certain QT-prolonging drugs.',
  },
  {
    genericName: 'Oral Rehydration Salts (ORS)', brandName: 'Hydrite', strength: '', dosageForm: 'Sachet',
    category: 'Electrolyte', source: 'yakap', prescriptionRequirement: 'otc',
    indication: 'Prevention and treatment of dehydration from diarrhea or vomiting.',
    safetyNotes: 'Use clean drinking water. Discard any unused solution after 24 hours.',
    contraindications: 'Severe dehydration or persistent vomiting needing IV fluids; intestinal obstruction.',
  },
  {
    genericName: 'Prednisone', brandName: '', strength: '20 mg', dosageForm: 'Tablet',
    category: 'Corticosteroid', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Inflammatory and allergic conditions; asthma/COPD exacerbations.',
    safetyNotes: 'Take with food in the morning. Do not stop abruptly after prolonged use.',
    contraindications: 'Systemic fungal infection; untreated active infection; hypersensitivity.',
  },
  {
    genericName: 'Salbutamol', brandName: 'Ventolin', strength: '2 mg', dosageForm: 'Tablet',
    category: 'Bronchodilator', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Relief of bronchospasm in asthma and COPD.',
    safetyNotes: 'May cause tremor or palpitations. Seek care if breathing does not improve.',
    contraindications: 'Hypersensitivity; use with caution in heart disease and hyperthyroidism.',
  },
  {
    genericName: 'Fluticasone + Salmeterol', brandName: 'Seretide', strength: '250/25 mcg', dosageForm: 'Inhaler',
    category: 'Respiratory', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Maintenance (not rescue) therapy for asthma and COPD.',
    safetyNotes: 'Rinse mouth after each use to prevent oral thrush. Not for acute attacks.',
    contraindications: 'Hypersensitivity to the components.',
  },
  {
    genericName: 'Paracetamol', brandName: 'Biogesic, Calpol', strength: '500 mg', dosageForm: 'Tablet',
    category: 'Analgesic / Antipyretic', source: 'yakap', prescriptionRequirement: 'otc',
    indication: 'Relief of mild to moderate pain and fever.',
    safetyNotes: 'Do not combine with other paracetamol-containing products. Avoid excessive alcohol.',
    contraindications: 'Severe hepatic impairment; paracetamol hypersensitivity.',
  },
  {
    genericName: 'Gliclazide', brandName: 'Diamicron', strength: '80 mg', dosageForm: 'Tablet',
    category: 'Antidiabetic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Type 2 diabetes mellitus.',
    safetyNotes: 'Take with meals. Watch for signs of low blood sugar (sweating, tremor, hunger).',
    contraindications: 'Type 1 diabetes; diabetic ketoacidosis; severe hepatic/renal impairment.',
  },
  {
    genericName: 'Metformin', brandName: 'Glucophage', strength: '500 mg', dosageForm: 'Tablet',
    category: 'Antidiabetic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'First-line therapy for type 2 diabetes mellitus.',
    safetyNotes: 'Take with meals to reduce stomach upset.',
    contraindications: 'Severe renal impairment; acute metabolic acidosis.',
  },
  {
    genericName: 'Simvastatin', brandName: 'Zocor', strength: '20 mg', dosageForm: 'Tablet',
    category: 'Statin', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Lowering of elevated cholesterol / cardiovascular risk reduction.',
    safetyNotes: 'Take in the evening. Report unexplained muscle pain or weakness. Avoid grapefruit juice.',
    contraindications: 'Active liver disease; pregnancy and breastfeeding.',
  },
  {
    genericName: 'Enalapril', brandName: 'Vasotec', strength: '10 mg', dosageForm: 'Tablet',
    category: 'Antihypertensive', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Hypertension and heart failure.',
    safetyNotes: 'May cause a dry cough or dizziness. Rise slowly from sitting/lying.',
    contraindications: 'Pregnancy; history of angioedema; bilateral renal artery stenosis.',
  },
  {
    genericName: 'Metoprolol', brandName: 'Betaloc', strength: '50 mg', dosageForm: 'Tablet',
    category: 'Antihypertensive', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Hypertension, angina and selected arrhythmias.',
    safetyNotes: 'Do not stop abruptly. Monitor heart rate.',
    contraindications: 'Severe bradycardia; high-degree heart block; decompensated heart failure.',
  },
  {
    genericName: 'Amlodipine', brandName: 'Norvasc', strength: '5 mg', dosageForm: 'Tablet',
    category: 'Antihypertensive', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Hypertension and angina.',
    safetyNotes: 'May cause ankle swelling or flushing.',
    contraindications: 'Hypersensitivity; severe aortic stenosis.',
  },
  {
    genericName: 'Hydrochlorothiazide', brandName: '', strength: '25 mg', dosageForm: 'Tablet',
    category: 'Diuretic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Hypertension and edema.',
    safetyNotes: 'Take in the morning. May lower potassium — follow up as advised.',
    contraindications: 'Anuria; sulfonamide hypersensitivity; severe renal/hepatic impairment.',
  },
  {
    genericName: 'Losartan', brandName: 'Cozaar', strength: '50 mg', dosageForm: 'Tablet',
    category: 'Antihypertensive', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Hypertension and diabetic kidney protection.',
    safetyNotes: 'May cause dizziness. Rise slowly from sitting/lying.',
    contraindications: 'Pregnancy; bilateral renal artery stenosis.',
  },
  {
    genericName: 'Aspirin', brandName: 'Aspilet, Bayer', strength: '80 mg', dosageForm: 'Tablet',
    category: 'Antiplatelet', source: 'yakap', prescriptionRequirement: 'otc',
    indication: 'Low-dose antiplatelet for cardiovascular protection.',
    safetyNotes: 'Take with food. Report black stools or unusual bleeding.',
    contraindications: 'Active peptic ulcer or bleeding; aspirin/NSAID allergy; children with viral illness (Reye syndrome).',
  },
  {
    genericName: 'Chlorphenamine', brandName: 'Allerta (chlorphenamine), Chlor-Trimeton', strength: '4 mg', dosageForm: 'Tablet',
    category: 'Antihistamine', source: 'yakap', prescriptionRequirement: 'otc',
    indication: 'Allergic rhinitis, urticaria and other allergic reactions.',
    safetyNotes: 'May cause drowsiness; avoid alcohol and driving.',
    contraindications: 'Narrow-angle glaucoma; urinary retention; newborns.',
  },
  // --- Local / facility catalog (NOT a guaranteed PhilHealth benefit) -------
  {
    genericName: 'Zinc Sulfate', brandName: '', strength: '20 mg', dosageForm: 'Tablet',
    category: 'Supplement', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Adjunct in the management of childhood diarrhea; zinc supplementation.',
    safetyNotes: 'Give together with ORS during diarrhea episodes.',
    contraindications: 'Hypersensitivity.',
  },
  {
    genericName: 'Ferrous Sulfate + Folic Acid', brandName: '', strength: '', dosageForm: 'Tablet',
    category: 'Supplement', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Prevention and treatment of iron-deficiency anemia, including in pregnancy.',
    safetyNotes: 'May darken stools and cause constipation. Take with vitamin C to aid absorption.',
    contraindications: 'Iron-overload conditions (e.g. hemochromatosis, thalassemia with overload).',
  },
  {
    genericName: 'Vitamin A', brandName: '', strength: '200,000 IU', dosageForm: 'Capsule',
    category: 'Supplement', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Vitamin A supplementation under DOH micronutrient programs.',
    safetyNotes: 'Give exactly per program schedule; do not exceed recommended doses.',
    contraindications: 'Pregnancy (high-dose); hypervitaminosis A.',
  },
  {
    genericName: 'Multivitamins', brandName: '', strength: '', dosageForm: 'Syrup',
    category: 'Supplement', source: 'local', prescriptionRequirement: 'otc',
    indication: 'General micronutrient supplementation, especially for children.',
    safetyNotes: 'Use the enclosed measuring device. Store as labeled.',
    contraindications: 'Hypersensitivity to any component.',
  },
  {
    genericName: 'Paracetamol + Phenylephrine + Chlorphenamine', brandName: 'Bioflu, Neozep, Decolgen', strength: '500/10/2 mg', dosageForm: 'Tablet',
    category: 'Cough & Cold', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Relief of flu symptoms: fever, headache, body aches, runny nose and nasal congestion.',
    safetyNotes: 'May cause drowsiness; avoid alcohol and driving. Do not combine with other paracetamol products.',
    contraindications: 'Severe hypertension or coronary artery disease; hyperthyroidism; narrow-angle glaucoma.',
  },
  {
    genericName: 'Ascorbic Acid (Vitamin C)', brandName: 'Cecon, Poten-Cee', strength: '500 mg', dosageForm: 'Tablet',
    category: 'Supplement', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Vitamin C supplementation and immune support.',
    safetyNotes: 'Best taken after meals. Very high doses may cause stomach upset.',
    contraindications: 'History of kidney stones (high doses); hypersensitivity.',
  },
  {
    genericName: 'Cetirizine', brandName: 'Virlix, Zyrtec, Allerkid', strength: '10 mg', dosageForm: 'Tablet',
    category: 'Antihistamine', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Allergic rhinitis, chronic urticaria and itching.',
    safetyNotes: 'May cause mild drowsiness; use caution when driving.',
    contraindications: 'Severe renal impairment (dose adjustment); hypersensitivity.',
  },
  {
    genericName: 'Ibuprofen', brandName: 'Advil, Medicol', strength: '400 mg', dosageForm: 'Tablet',
    category: 'Analgesic / NSAID', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Relief of pain, inflammation and fever.',
    safetyNotes: 'Take with food. May irritate the stomach; use the lowest effective dose.',
    contraindications: 'Active peptic ulcer or GI bleeding; severe renal impairment; aspirin/NSAID allergy; third-trimester pregnancy.',
  },
  {
    genericName: 'Mefenamic Acid', brandName: 'Dolfenal, Ponstan', strength: '500 mg', dosageForm: 'Tablet',
    category: 'Analgesic / NSAID', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Mild to moderate pain, including dysmenorrhea.',
    safetyNotes: 'Take with food. Limit continuous use to a few days.',
    contraindications: 'Active peptic ulcer or GI bleeding; severe renal impairment; aspirin/NSAID allergy.',
  },
  {
    genericName: 'Loperamide', brandName: 'Imodium, Diatabs', strength: '2 mg', dosageForm: 'Capsule',
    category: 'Antidiarrheal', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Symptomatic relief of acute non-infectious diarrhea.',
    safetyNotes: 'Keep hydrated with ORS. Stop and seek care if symptoms persist beyond 48 hours.',
    contraindications: 'Bloody diarrhea with high fever; suspected bacterial dysentery; children < 12 years without advice.',
  },
  {
    genericName: 'Loratadine', brandName: 'Claritin', strength: '10 mg', dosageForm: 'Tablet',
    category: 'Antihistamine', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Allergic rhinitis and chronic urticaria (non-drowsy).',
    safetyNotes: 'Generally non-sedating. Reduce dose in liver impairment.',
    contraindications: 'Hypersensitivity.',
  },
  {
    genericName: 'Omeprazole', brandName: 'Losec, Omepron', strength: '20 mg', dosageForm: 'Capsule',
    category: 'Proton Pump Inhibitor', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Hyperacidity, GERD and peptic ulcer disease.',
    safetyNotes: 'Take 30–60 minutes before breakfast; swallow whole.',
    contraindications: 'Hypersensitivity; concurrent use with certain antiretrovirals.',
  },
  {
    genericName: 'Aluminum Hydroxide + Magnesium Hydroxide', brandName: 'Kremil-S, Maalox', strength: '', dosageForm: 'Suspension',
    category: 'Antacid', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Relief of hyperacidity, heartburn and indigestion.',
    safetyNotes: 'Separate from other medicines by at least 2 hours. Shake well before use.',
    contraindications: 'Severe renal impairment; hypersensitivity.',
  },
]);

/**
 * Build a normalized, case-insensitive `generic|strength|dosageform` identity
 * key used to detect duplicate catalog entries across both DB and file stores.
 *
 * @param {Object} [entry]
 * @returns {string}
 */
export const medicineIdentityKey = ({ genericName = '', strength = '', dosageForm = '' } = {}) =>
  [genericName, strength, dosageForm]
    .map((part) => String(part ?? '').trim().toLowerCase())
    .join('|');

export default { DEFAULT_MEDICINES, MEDICINE_SOURCES, PRESCRIPTION_REQUIREMENTS, medicineIdentityKey };

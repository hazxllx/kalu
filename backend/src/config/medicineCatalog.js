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
 * Generic names are the primary searchable term; brand name (e.g. "Biogesic"
 * for paracetamol), strength and form are optional descriptors. The identity
 * triple (generic + strength + form) is the duplicate-detection key, mirroring
 * the unique index in the migration, so products with the same active
 * ingredient are kept as a single entry rather than duplicated per brand.
 *
 * Each entry can also carry clinical reference information: intended use /
 * indication, basic safety notes and contraindications, the prescription
 * requirement ('otc' or 'rx') and standard dosage instructions. Dosage
 * instructions are reference values only — authorized health personnel verify
 * them in-app (recorded as dosageVerifiedBy / dosageVerifiedAt on the catalog
 * entry) and the prescriber confirms the dose for each patient.
 */

export const MEDICINE_SOURCES = Object.freeze(['yakap', 'local']);

/** Prescription requirement: over-the-counter vs prescription-only. */
export const PRESCRIPTION_REQUIREMENTS = Object.freeze(['otc', 'rx']);

export const DEFAULT_MEDICINES = Object.freeze([
  // --- PhilHealth Advisory 2026-0007 (YAKAP) — 21 medicines -----------------
  {
    genericName: 'Amoxicillin', brandName: 'Amoxil, Himox', strength: '500 mg', dosageForm: 'Capsule',
    category: 'Antibiotic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Bacterial infections of the respiratory tract, ear, urinary tract and skin.',
    safetyNotes: 'Complete the full prescribed course even if symptoms improve. May be taken with or without food.',
    contraindications: 'Known penicillin or cephalosporin hypersensitivity.',
    dosageInstructions: 'Adults: 500 mg every 8 hours (or as prescribed) for the full course.',
  },
  {
    genericName: 'Co-amoxiclav', brandName: 'Augmentin', strength: '625 mg', dosageForm: 'Tablet',
    category: 'Antibiotic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Bacterial infections resistant to plain amoxicillin.',
    safetyNotes: 'Take at the start of a meal to reduce stomach upset. Finish the full course.',
    contraindications: 'Penicillin hypersensitivity; history of co-amoxiclav-associated jaundice/hepatic dysfunction.',
    dosageInstructions: 'Adults: 1 tablet (625 mg) every 8 hours (or as prescribed).',
  },
  {
    genericName: 'Cotrimoxazole', brandName: 'Bactrim', strength: '800/160 mg', dosageForm: 'Tablet',
    category: 'Antibiotic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Urinary tract and respiratory infections; other susceptible infections.',
    safetyNotes: 'Drink plenty of water. Avoid prolonged sun exposure.',
    contraindications: 'Sulfonamide allergy; severe hepatic or renal impairment; pregnancy at term; infants < 2 months.',
    dosageInstructions: 'Adults: 1 tablet (800/160 mg) every 12 hours (or as prescribed).',
  },
  {
    genericName: 'Nitrofurantoin', brandName: 'Macrobid', strength: '100 mg', dosageForm: 'Capsule',
    category: 'Antibiotic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Uncomplicated urinary tract infection.',
    safetyNotes: 'Take with food. Urine may turn dark yellow/brown (harmless).',
    contraindications: 'Significant renal impairment; pregnancy at term; infants < 1 month.',
    dosageInstructions: 'Adults: 100 mg every 12 hours with food (or as prescribed).',
  },
  {
    genericName: 'Ciprofloxacin', brandName: 'Cipro', strength: '500 mg', dosageForm: 'Tablet',
    category: 'Antibiotic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Urinary, gastrointestinal and other susceptible bacterial infections.',
    safetyNotes: 'Avoid dairy/antacids within 2 hours. Stay hydrated. Report tendon pain.',
    contraindications: 'Fluoroquinolone hypersensitivity; caution in children and pregnancy.',
    dosageInstructions: 'Adults: 500 mg every 12 hours (or as prescribed).',
  },
  {
    genericName: 'Clarithromycin', brandName: 'Klaricid', strength: '500 mg', dosageForm: 'Tablet',
    category: 'Antibiotic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Respiratory tract infections and H. pylori regimens.',
    safetyNotes: 'May interact with several medicines — review current medications.',
    contraindications: 'Macrolide hypersensitivity; concurrent use with certain QT-prolonging drugs.',
    dosageInstructions: 'Adults: 500 mg every 12 hours (or as prescribed).',
  },
  {
    genericName: 'Oral Rehydration Salts (ORS)', brandName: 'Hydrite', strength: '', dosageForm: 'Sachet',
    category: 'Electrolyte', source: 'yakap', prescriptionRequirement: 'otc',
    indication: 'Prevention and treatment of dehydration from diarrhea or vomiting.',
    safetyNotes: 'Use clean drinking water. Discard any unused solution after 24 hours.',
    contraindications: 'Severe dehydration or persistent vomiting needing IV fluids; intestinal obstruction.',
    dosageInstructions: 'Dissolve 1 sachet in the labeled volume of clean water; give small sips after each loose stool.',
  },
  {
    genericName: 'Prednisone', brandName: '', strength: '20 mg', dosageForm: 'Tablet',
    category: 'Corticosteroid', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Inflammatory and allergic conditions; asthma/COPD exacerbations.',
    safetyNotes: 'Take with food in the morning. Do not stop abruptly after prolonged use.',
    contraindications: 'Systemic fungal infection; untreated active infection; hypersensitivity.',
    dosageInstructions: 'As prescribed; take the full daily dose with food in the morning.',
  },
  {
    genericName: 'Salbutamol', brandName: 'Ventolin', strength: '2 mg', dosageForm: 'Tablet',
    category: 'Bronchodilator', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Relief of bronchospasm in asthma and COPD.',
    safetyNotes: 'May cause tremor or palpitations. Seek care if breathing does not improve.',
    contraindications: 'Hypersensitivity; use with caution in heart disease and hyperthyroidism.',
    dosageInstructions: 'Adults: 2–4 mg three to four times daily (or as prescribed).',
  },
  {
    genericName: 'Fluticasone + Salmeterol', brandName: 'Seretide', strength: '250/25 mcg', dosageForm: 'Inhaler',
    category: 'Respiratory', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Maintenance (not rescue) therapy for asthma and COPD.',
    safetyNotes: 'Rinse mouth after each use to prevent oral thrush. Not for acute attacks.',
    contraindications: 'Hypersensitivity to the components.',
    dosageInstructions: 'Usually 1–2 inhalations twice daily (or as prescribed); rinse mouth after use.',
  },
  {
    genericName: 'Paracetamol', brandName: 'Biogesic, Calpol', strength: '500 mg', dosageForm: 'Tablet',
    category: 'Analgesic / Antipyretic', source: 'yakap', prescriptionRequirement: 'otc',
    indication: 'Relief of mild to moderate pain and fever.',
    safetyNotes: 'Do not combine with other paracetamol-containing products. Avoid excessive alcohol.',
    contraindications: 'Severe hepatic impairment; paracetamol hypersensitivity.',
    dosageInstructions: 'Adults: 1–2 tablets (500 mg–1 g) every 4–6 hours as needed; maximum 4 g (8 tablets) per day.',
  },
  {
    genericName: 'Gliclazide', brandName: 'Diamicron', strength: '80 mg', dosageForm: 'Tablet',
    category: 'Antidiabetic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Type 2 diabetes mellitus.',
    safetyNotes: 'Take with meals. Watch for signs of low blood sugar (sweating, tremor, hunger).',
    contraindications: 'Type 1 diabetes; diabetic ketoacidosis; severe hepatic/renal impairment.',
    dosageInstructions: 'Adults: 80 mg with breakfast; adjust as prescribed.',
  },
  {
    genericName: 'Metformin', brandName: 'Glucophage', strength: '500 mg', dosageForm: 'Tablet',
    category: 'Antidiabetic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'First-line therapy for type 2 diabetes mellitus.',
    safetyNotes: 'Take with meals to reduce stomach upset.',
    contraindications: 'Severe renal impairment; acute metabolic acidosis.',
    dosageInstructions: 'Adults: 500 mg once or twice daily with meals; titrate as prescribed.',
  },
  {
    genericName: 'Simvastatin', brandName: 'Zocor', strength: '20 mg', dosageForm: 'Tablet',
    category: 'Statin', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Lowering of elevated cholesterol / cardiovascular risk reduction.',
    safetyNotes: 'Take in the evening. Report unexplained muscle pain or weakness. Avoid grapefruit juice.',
    contraindications: 'Active liver disease; pregnancy and breastfeeding.',
    dosageInstructions: 'Adults: 20 mg once daily in the evening (or as prescribed).',
  },
  {
    genericName: 'Enalapril', brandName: 'Vasotec', strength: '10 mg', dosageForm: 'Tablet',
    category: 'Antihypertensive', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Hypertension and heart failure.',
    safetyNotes: 'May cause a dry cough or dizziness. Rise slowly from sitting/lying.',
    contraindications: 'Pregnancy; history of angioedema; bilateral renal artery stenosis.',
    dosageInstructions: 'Adults: 10 mg once or twice daily (or as prescribed).',
  },
  {
    genericName: 'Metoprolol', brandName: 'Betaloc', strength: '50 mg', dosageForm: 'Tablet',
    category: 'Antihypertensive', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Hypertension, angina and selected arrhythmias.',
    safetyNotes: 'Do not stop abruptly. Monitor heart rate.',
    contraindications: 'Severe bradycardia; high-degree heart block; decompensated heart failure.',
    dosageInstructions: 'Adults: 50 mg once or twice daily (or as prescribed).',
  },
  {
    genericName: 'Amlodipine', brandName: 'Norvasc', strength: '5 mg', dosageForm: 'Tablet',
    category: 'Antihypertensive', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Hypertension and angina.',
    safetyNotes: 'May cause ankle swelling or flushing.',
    contraindications: 'Hypersensitivity; severe aortic stenosis.',
    dosageInstructions: 'Adults: 5 mg once daily; up to 10 mg as prescribed.',
  },
  {
    genericName: 'Hydrochlorothiazide', brandName: '', strength: '25 mg', dosageForm: 'Tablet',
    category: 'Diuretic', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Hypertension and edema.',
    safetyNotes: 'Take in the morning. May lower potassium — follow up as advised.',
    contraindications: 'Anuria; sulfonamide hypersensitivity; severe renal/hepatic impairment.',
    dosageInstructions: 'Adults: 12.5–25 mg once daily in the morning (or as prescribed).',
  },
  {
    genericName: 'Losartan', brandName: 'Cozaar', strength: '50 mg', dosageForm: 'Tablet',
    category: 'Antihypertensive', source: 'yakap', prescriptionRequirement: 'rx',
    indication: 'Hypertension and diabetic kidney protection.',
    safetyNotes: 'May cause dizziness. Rise slowly from sitting/lying.',
    contraindications: 'Pregnancy; bilateral renal artery stenosis.',
    dosageInstructions: 'Adults: 50 mg once daily; up to 100 mg as prescribed.',
  },
  {
    genericName: 'Aspirin', brandName: 'Aspilet, Bayer', strength: '80 mg', dosageForm: 'Tablet',
    category: 'Antiplatelet', source: 'yakap', prescriptionRequirement: 'otc',
    indication: 'Low-dose antiplatelet for cardiovascular protection.',
    safetyNotes: 'Take with food. Report black stools or unusual bleeding.',
    contraindications: 'Active peptic ulcer or bleeding; aspirin/NSAID allergy; children with viral illness (Reye syndrome).',
    dosageInstructions: 'Adults: 80 mg once daily with food (or as prescribed).',
  },
  {
    genericName: 'Chlorphenamine', brandName: 'Allerta (chlorphenamine), Chlor-Trimeton', strength: '4 mg', dosageForm: 'Tablet',
    category: 'Antihistamine', source: 'yakap', prescriptionRequirement: 'otc',
    indication: 'Allergic rhinitis, urticaria and other allergic reactions.',
    safetyNotes: 'May cause drowsiness; avoid alcohol and driving.',
    contraindications: 'Narrow-angle glaucoma; urinary retention; newborns.',
    dosageInstructions: 'Adults: 4 mg every 4–6 hours as needed; maximum 24 mg/day.',
  },
  // --- Local / facility catalog (NOT a guaranteed PhilHealth benefit) -------
  {
    genericName: 'Zinc Sulfate', brandName: '', strength: '20 mg', dosageForm: 'Tablet',
    category: 'Supplement', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Adjunct in the management of childhood diarrhea; zinc supplementation.',
    safetyNotes: 'Give together with ORS during diarrhea episodes.',
    contraindications: 'Hypersensitivity.',
    dosageInstructions: 'Children: as per DOH diarrhea protocol for 10–14 days; adults as directed.',
  },
  {
    genericName: 'Ferrous Sulfate + Folic Acid', brandName: '', strength: '', dosageForm: 'Tablet',
    category: 'Supplement', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Prevention and treatment of iron-deficiency anemia, including in pregnancy.',
    safetyNotes: 'May darken stools and cause constipation. Take with vitamin C to aid absorption.',
    contraindications: 'Iron-overload conditions (e.g. hemochromatosis, thalassemia with overload).',
    dosageInstructions: 'Adults: 1 tablet once daily (or as prescribed).',
  },
  {
    genericName: 'Vitamin A', brandName: '', strength: '200,000 IU', dosageForm: 'Capsule',
    category: 'Supplement', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Vitamin A supplementation under DOH micronutrient programs.',
    safetyNotes: 'Give exactly per program schedule; do not exceed recommended doses.',
    contraindications: 'Pregnancy (high-dose); hypervitaminosis A.',
    dosageInstructions: 'Per DOH program schedule by age group.',
  },
  {
    genericName: 'Multivitamins', brandName: '', strength: '', dosageForm: 'Syrup',
    category: 'Supplement', source: 'local', prescriptionRequirement: 'otc',
    indication: 'General micronutrient supplementation, especially for children.',
    safetyNotes: 'Use the enclosed measuring device. Store as labeled.',
    contraindications: 'Hypersensitivity to any component.',
    dosageInstructions: 'As directed on the label by age/weight.',
  },
  {
    genericName: 'Paracetamol + Phenylephrine + Chlorphenamine', brandName: 'Bioflu, Neozep, Decolgen', strength: '500/10/2 mg', dosageForm: 'Tablet',
    category: 'Cough & Cold', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Relief of flu symptoms: fever, headache, body aches, runny nose and nasal congestion.',
    safetyNotes: 'May cause drowsiness; avoid alcohol and driving. Do not combine with other paracetamol products.',
    contraindications: 'Severe hypertension or coronary artery disease; hyperthyroidism; narrow-angle glaucoma.',
    dosageInstructions: 'Adults: 1 tablet every 6 hours as needed; maximum 4 tablets per day.',
  },
  {
    genericName: 'Ascorbic Acid (Vitamin C)', brandName: 'Cecon, Poten-Cee', strength: '500 mg', dosageForm: 'Tablet',
    category: 'Supplement', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Vitamin C supplementation and immune support.',
    safetyNotes: 'Best taken after meals. Very high doses may cause stomach upset.',
    contraindications: 'History of kidney stones (high doses); hypersensitivity.',
    dosageInstructions: 'Adults: 1 tablet (500 mg) once daily, or as directed.',
  },
  {
    genericName: 'Cetirizine', brandName: 'Virlix, Zyrtec, Allerkid', strength: '10 mg', dosageForm: 'Tablet',
    category: 'Antihistamine', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Allergic rhinitis, chronic urticaria and itching.',
    safetyNotes: 'May cause mild drowsiness; use caution when driving.',
    contraindications: 'Severe renal impairment (dose adjustment); hypersensitivity.',
    dosageInstructions: 'Adults and children \u2265 12 years: 10 mg once daily.',
  },
  {
    genericName: 'Ibuprofen', brandName: 'Advil, Medicol', strength: '400 mg', dosageForm: 'Tablet',
    category: 'Analgesic / NSAID', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Relief of pain, inflammation and fever.',
    safetyNotes: 'Take with food. May irritate the stomach; use the lowest effective dose.',
    contraindications: 'Active peptic ulcer or GI bleeding; severe renal impairment; aspirin/NSAID allergy; third-trimester pregnancy.',
    dosageInstructions: 'Adults: 200–400 mg every 4–6 hours as needed with food; OTC maximum 1200 mg/day.',
  },
  {
    genericName: 'Mefenamic Acid', brandName: 'Dolfenal, Ponstan', strength: '500 mg', dosageForm: 'Tablet',
    category: 'Analgesic / NSAID', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Mild to moderate pain, including dysmenorrhea.',
    safetyNotes: 'Take with food. Limit continuous use to a few days.',
    contraindications: 'Active peptic ulcer or GI bleeding; severe renal impairment; aspirin/NSAID allergy.',
    dosageInstructions: 'Adults: 500 mg initially, then 250 mg every 6 hours as needed with food.',
  },
  {
    genericName: 'Loperamide', brandName: 'Imodium, Diatabs', strength: '2 mg', dosageForm: 'Capsule',
    category: 'Antidiarrheal', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Symptomatic relief of acute non-infectious diarrhea.',
    safetyNotes: 'Keep hydrated with ORS. Stop and seek care if symptoms persist beyond 48 hours.',
    contraindications: 'Bloody diarrhea with high fever; suspected bacterial dysentery; children < 12 years without advice.',
    dosageInstructions: 'Adults: 4 mg initially, then 2 mg after each loose stool; maximum 8 mg/day (OTC).',
  },
  {
    genericName: 'Loratadine', brandName: 'Claritin', strength: '10 mg', dosageForm: 'Tablet',
    category: 'Antihistamine', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Allergic rhinitis and chronic urticaria (non-drowsy).',
    safetyNotes: 'Generally non-sedating. Reduce dose in liver impairment.',
    contraindications: 'Hypersensitivity.',
    dosageInstructions: 'Adults and children \u2265 12 years: 10 mg once daily.',
  },
  {
    genericName: 'Omeprazole', brandName: 'Losec, Omepron', strength: '20 mg', dosageForm: 'Capsule',
    category: 'Proton Pump Inhibitor', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Hyperacidity, GERD and peptic ulcer disease.',
    safetyNotes: 'Take 30–60 minutes before breakfast; swallow whole.',
    contraindications: 'Hypersensitivity; concurrent use with certain antiretrovirals.',
    dosageInstructions: 'Adults: 20 mg once daily before breakfast (or as prescribed).',
  },
  {
    genericName: 'Aluminum Hydroxide + Magnesium Hydroxide', brandName: 'Kremil-S, Maalox', strength: '', dosageForm: 'Suspension',
    category: 'Antacid', source: 'local', prescriptionRequirement: 'otc',
    indication: 'Relief of hyperacidity, heartburn and indigestion.',
    safetyNotes: 'Separate from other medicines by at least 2 hours. Shake well before use.',
    contraindications: 'Severe renal impairment; hypersensitivity.',
    dosageInstructions: 'Adults: 10 mL (or 1–2 tablets) after meals and at bedtime as needed.',
  },
]);

/** Case-insensitive identity key used to detect duplicate catalog entries. */
export const medicineIdentityKey = ({ genericName = '', strength = '', dosageForm = '' } = {}) =>
  [genericName, strength, dosageForm]
    .map((part) => String(part ?? '').trim().toLowerCase())
    .join('|');

export default { DEFAULT_MEDICINES, MEDICINE_SOURCES, PRESCRIPTION_REQUIREMENTS, medicineIdentityKey };

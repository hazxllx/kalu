-- Medicine information fields + removal of per-facility stock availability.
--
-- Builds on 20261011120000_bp_thresholds_and_medicine_catalog.sql:
--
--   1. public.medicines gains clinical reference fields so every medicine can
--      carry its intended use/indication, basic safety notes, contraindications,
--      the prescription requirement (OTC vs prescription-only) and standard
--      dosage instructions. Dosage instructions are entered/verified by an
--      authorized System Administrator (recorded in dosage_verified_by /
--      dosage_verified_at); the prescriber still confirms the dose per patient.
--
--   2. The per-facility stock/availability feature is REMOVED from the medicine
--      interface and medicine lookup, per requirement: no inventory tracking or
--      stock availability indicators on medicines. public.medicine_facility_
--      availability (and its policies/trigger/indexes) is dropped. Unrelated
--      facility features elsewhere in the system are untouched.
--
--   3. Existing seeded medicines are enriched (brand names such as "Biogesic"
--      for paracetamol so brand searches resolve to the generic) and common
--      Philippine primary-care medicines (Bioflu, ascorbic acid / Vitamin C,
--      cetirizine, ibuprofen, etc.) are added. The case-insensitive identity
--      triple (generic + strength + form) continues to prevent duplicates, so
--      products with the same active ingredient stay a single catalog entry.
--
-- Additive and idempotent: existing consultation records (medications stored by
-- value on public.visits) are never altered.

begin;

-- ---------------------------------------------------------------------------
-- 1. New medicine information columns (additive)
-- ---------------------------------------------------------------------------
alter table public.medicines
  add column if not exists indication text not null default '',
  add column if not exists safety_notes text not null default '',
  add column if not exists contraindications text not null default '',
  add column if not exists prescription_requirement text not null default 'rx'
    check (prescription_requirement in ('otc', 'rx')),
  add column if not exists dosage_instructions text not null default '',
  add column if not exists dosage_verified_by uuid references public.profiles(id) on delete set null,
  add column if not exists dosage_verified_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Remove per-facility stock availability from the medicine interface
-- ---------------------------------------------------------------------------
drop trigger if exists medicine_availability_set_updated_at on public.medicine_facility_availability;
drop policy if exists medicine_availability_select on public.medicine_facility_availability;
drop policy if exists medicine_availability_write on public.medicine_facility_availability;
drop table if exists public.medicine_facility_availability;

-- ---------------------------------------------------------------------------
-- 3a. Enrich existing seeded medicines (brand names + clinical reference info)
-- ---------------------------------------------------------------------------
update public.medicines m set
  brand_name = v.brand_name,
  prescription_requirement = v.rx,
  indication = v.indication,
  safety_notes = v.safety_notes,
  contraindications = v.contra,
  dosage_instructions = v.dosage
from (values
  ('amoxicillin', '500 mg', 'capsule', 'Amoxil, Himox', 'rx',
    'Bacterial infections of the respiratory tract, ear, urinary tract and skin.',
    'Complete the full prescribed course even if symptoms improve. May be taken with or without food.',
    'Known penicillin or cephalosporin hypersensitivity.',
    'Adults: 500 mg every 8 hours (or as prescribed) for the full course.'),
  ('co-amoxiclav', '625 mg', 'tablet', 'Augmentin', 'rx',
    'Bacterial infections resistant to plain amoxicillin.',
    'Take at the start of a meal to reduce stomach upset. Finish the full course.',
    'Penicillin hypersensitivity; history of co-amoxiclav-associated jaundice/hepatic dysfunction.',
    'Adults: 1 tablet (625 mg) every 8 hours (or as prescribed).'),
  ('cotrimoxazole', '800/160 mg', 'tablet', 'Bactrim', 'rx',
    'Urinary tract and respiratory infections; other susceptible infections.',
    'Drink plenty of water. Avoid prolonged sun exposure.',
    'Sulfonamide allergy; severe hepatic or renal impairment; pregnancy at term; infants < 2 months.',
    'Adults: 1 tablet (800/160 mg) every 12 hours (or as prescribed).'),
  ('nitrofurantoin', '100 mg', 'capsule', 'Macrobid', 'rx',
    'Uncomplicated urinary tract infection.',
    'Take with food. Urine may turn dark yellow/brown (harmless).',
    'Significant renal impairment; pregnancy at term; infants < 1 month.',
    'Adults: 100 mg every 12 hours with food (or as prescribed).'),
  ('ciprofloxacin', '500 mg', 'tablet', 'Cipro', 'rx',
    'Urinary, gastrointestinal and other susceptible bacterial infections.',
    'Avoid dairy/antacids within 2 hours. Stay hydrated. Report tendon pain.',
    'Fluoroquinolone hypersensitivity; caution in children and pregnancy.',
    'Adults: 500 mg every 12 hours (or as prescribed).'),
  ('clarithromycin', '500 mg', 'tablet', 'Klaricid', 'rx',
    'Respiratory tract infections and H. pylori regimens.',
    'May interact with several medicines - review current medications.',
    'Macrolide hypersensitivity; concurrent use with certain QT-prolonging drugs.',
    'Adults: 500 mg every 12 hours (or as prescribed).'),
  ('oral rehydration salts (ors)', '', 'sachet', 'Hydrite', 'otc',
    'Prevention and treatment of dehydration from diarrhea or vomiting.',
    'Use clean drinking water. Discard any unused solution after 24 hours.',
    'Severe dehydration or persistent vomiting needing IV fluids; intestinal obstruction.',
    'Dissolve 1 sachet in the labeled volume of clean water; give small sips after each loose stool.'),
  ('prednisone', '20 mg', 'tablet', '', 'rx',
    'Inflammatory and allergic conditions; asthma/COPD exacerbations.',
    'Take with food in the morning. Do not stop abruptly after prolonged use.',
    'Systemic fungal infection; untreated active infection; hypersensitivity.',
    'As prescribed; take the full daily dose with food in the morning.'),
  ('salbutamol', '2 mg', 'tablet', 'Ventolin', 'rx',
    'Relief of bronchospasm in asthma and COPD.',
    'May cause tremor or palpitations. Seek care if breathing does not improve.',
    'Hypersensitivity; use with caution in heart disease and hyperthyroidism.',
    'Adults: 2-4 mg three to four times daily (or as prescribed).'),
  ('fluticasone + salmeterol', '250/25 mcg', 'inhaler', 'Seretide', 'rx',
    'Maintenance (not rescue) therapy for asthma and COPD.',
    'Rinse mouth after each use to prevent oral thrush. Not for acute attacks.',
    'Hypersensitivity to the components.',
    'Usually 1-2 inhalations twice daily (or as prescribed); rinse mouth after use.'),
  ('paracetamol', '500 mg', 'tablet', 'Biogesic, Calpol', 'otc',
    'Relief of mild to moderate pain and fever.',
    'Do not combine with other paracetamol-containing products. Avoid excessive alcohol.',
    'Severe hepatic impairment; paracetamol hypersensitivity.',
    'Adults: 1-2 tablets (500 mg-1 g) every 4-6 hours as needed; maximum 4 g (8 tablets) per day.'),
  ('gliclazide', '80 mg', 'tablet', 'Diamicron', 'rx',
    'Type 2 diabetes mellitus.',
    'Take with meals. Watch for signs of low blood sugar (sweating, tremor, hunger).',
    'Type 1 diabetes; diabetic ketoacidosis; severe hepatic/renal impairment.',
    'Adults: 80 mg with breakfast; adjust as prescribed.'),
  ('metformin', '500 mg', 'tablet', 'Glucophage', 'rx',
    'First-line therapy for type 2 diabetes mellitus.',
    'Take with meals to reduce stomach upset.',
    'Severe renal impairment; acute metabolic acidosis.',
    'Adults: 500 mg once or twice daily with meals; titrate as prescribed.'),
  ('simvastatin', '20 mg', 'tablet', 'Zocor', 'rx',
    'Lowering of elevated cholesterol / cardiovascular risk reduction.',
    'Take in the evening. Report unexplained muscle pain or weakness. Avoid grapefruit juice.',
    'Active liver disease; pregnancy and breastfeeding.',
    'Adults: 20 mg once daily in the evening (or as prescribed).'),
  ('enalapril', '10 mg', 'tablet', 'Vasotec', 'rx',
    'Hypertension and heart failure.',
    'May cause a dry cough or dizziness. Rise slowly from sitting/lying.',
    'Pregnancy; history of angioedema; bilateral renal artery stenosis.',
    'Adults: 10 mg once or twice daily (or as prescribed).'),
  ('metoprolol', '50 mg', 'tablet', 'Betaloc', 'rx',
    'Hypertension, angina and selected arrhythmias.',
    'Do not stop abruptly. Monitor heart rate.',
    'Severe bradycardia; high-degree heart block; decompensated heart failure.',
    'Adults: 50 mg once or twice daily (or as prescribed).'),
  ('amlodipine', '5 mg', 'tablet', 'Norvasc', 'rx',
    'Hypertension and angina.',
    'May cause ankle swelling or flushing.',
    'Hypersensitivity; severe aortic stenosis.',
    'Adults: 5 mg once daily; up to 10 mg as prescribed.'),
  ('hydrochlorothiazide', '25 mg', 'tablet', '', 'rx',
    'Hypertension and edema.',
    'Take in the morning. May lower potassium - follow up as advised.',
    'Anuria; sulfonamide hypersensitivity; severe renal/hepatic impairment.',
    'Adults: 12.5-25 mg once daily in the morning (or as prescribed).'),
  ('losartan', '50 mg', 'tablet', 'Cozaar', 'rx',
    'Hypertension and diabetic kidney protection.',
    'May cause dizziness. Rise slowly from sitting/lying.',
    'Pregnancy; bilateral renal artery stenosis.',
    'Adults: 50 mg once daily; up to 100 mg as prescribed.'),
  ('aspirin', '80 mg', 'tablet', 'Aspilet, Bayer', 'otc',
    'Low-dose antiplatelet for cardiovascular protection.',
    'Take with food. Report black stools or unusual bleeding.',
    'Active peptic ulcer or bleeding; aspirin/NSAID allergy; children with viral illness (Reye syndrome).',
    'Adults: 80 mg once daily with food (or as prescribed).'),
  ('chlorphenamine', '4 mg', 'tablet', 'Chlor-Trimeton', 'otc',
    'Allergic rhinitis, urticaria and other allergic reactions.',
    'May cause drowsiness; avoid alcohol and driving.',
    'Narrow-angle glaucoma; urinary retention; newborns.',
    'Adults: 4 mg every 4-6 hours as needed; maximum 24 mg/day.'),
  ('zinc sulfate', '20 mg', 'tablet', '', 'otc',
    'Adjunct in the management of childhood diarrhea; zinc supplementation.',
    'Give together with ORS during diarrhea episodes.',
    'Hypersensitivity.',
    'Children: as per DOH diarrhea protocol for 10-14 days; adults as directed.'),
  ('ferrous sulfate + folic acid', '', 'tablet', '', 'otc',
    'Prevention and treatment of iron-deficiency anemia, including in pregnancy.',
    'May darken stools and cause constipation. Take with vitamin C to aid absorption.',
    'Iron-overload conditions (e.g. hemochromatosis, thalassemia with overload).',
    'Adults: 1 tablet once daily (or as prescribed).'),
  ('vitamin a', '200,000 IU', 'capsule', '', 'otc',
    'Vitamin A supplementation under DOH micronutrient programs.',
    'Give exactly per program schedule; do not exceed recommended doses.',
    'Pregnancy (high-dose); hypervitaminosis A.',
    'Per DOH program schedule by age group.'),
  ('multivitamins', '', 'syrup', '', 'otc',
    'General micronutrient supplementation, especially for children.',
    'Use the enclosed measuring device. Store as labeled.',
    'Hypersensitivity to any component.',
    'As directed on the label by age/weight.')
) as v(gname, strg, form, brand_name, rx, indication, safety_notes, contra, dosage)
where lower(m.generic_name) = v.gname
  and lower(m.strength) = v.strg
  and lower(m.dosage_form) = v.form;

-- ---------------------------------------------------------------------------
-- 3b. Add common Philippine primary-care medicines (idempotent)
-- ---------------------------------------------------------------------------
insert into public.medicines
  (generic_name, brand_name, strength, dosage_form, category, source,
   prescription_requirement, indication, safety_notes, contraindications, dosage_instructions)
values
  ('Paracetamol + Phenylephrine + Chlorphenamine', 'Bioflu', '500/10/2 mg', 'Tablet', 'Cough & Cold', 'local',
    'otc',
    'Relief of flu symptoms: fever, headache, body aches, runny nose and nasal congestion.',
    'May cause drowsiness; avoid alcohol and driving. Do not combine with other paracetamol products.',
    'Severe hypertension or coronary artery disease; hyperthyroidism; narrow-angle glaucoma.',
    'Adults: 1 tablet every 6 hours as needed; maximum 4 tablets per day.'),
  ('Ascorbic Acid (Vitamin C)', 'Cecon, Poten-Cee', '500 mg', 'Tablet', 'Supplement', 'local',
    'otc',
    'Vitamin C supplementation and immune support.',
    'Best taken after meals. Very high doses may cause stomach upset.',
    'History of kidney stones (high doses); hypersensitivity.',
    'Adults: 1 tablet (500 mg) once daily, or as directed.'),
  ('Cetirizine', 'Virlix, Zyrtec, Allerkid', '10 mg', 'Tablet', 'Antihistamine', 'local',
    'otc',
    'Allergic rhinitis, chronic urticaria and itching.',
    'May cause mild drowsiness; use caution when driving.',
    'Severe renal impairment (dose adjustment); hypersensitivity.',
    'Adults and children >= 12 years: 10 mg once daily.'),
  ('Ibuprofen', 'Advil, Medicol', '400 mg', 'Tablet', 'Analgesic / NSAID', 'local',
    'otc',
    'Relief of pain, inflammation and fever.',
    'Take with food. May irritate the stomach; use the lowest effective dose.',
    'Active peptic ulcer or GI bleeding; severe renal impairment; aspirin/NSAID allergy; third-trimester pregnancy.',
    'Adults: 200-400 mg every 4-6 hours as needed with food; OTC maximum 1200 mg/day.'),
  ('Mefenamic Acid', 'Dolfenal, Ponstan', '500 mg', 'Tablet', 'Analgesic / NSAID', 'local',
    'otc',
    'Mild to moderate pain, including dysmenorrhea.',
    'Take with food. Limit continuous use to a few days.',
    'Active peptic ulcer or GI bleeding; severe renal impairment; aspirin/NSAID allergy.',
    'Adults: 500 mg initially, then 250 mg every 6 hours as needed with food.'),
  ('Loperamide', 'Imodium, Diatabs', '2 mg', 'Capsule', 'Antidiarrheal', 'local',
    'otc',
    'Symptomatic relief of acute non-infectious diarrhea.',
    'Keep hydrated with ORS. Stop and seek care if symptoms persist beyond 48 hours.',
    'Bloody diarrhea with high fever; suspected bacterial dysentery; children < 12 years without advice.',
    'Adults: 4 mg initially, then 2 mg after each loose stool; maximum 8 mg/day (OTC).'),
  ('Loratadine', 'Claritin', '10 mg', 'Tablet', 'Antihistamine', 'local',
    'otc',
    'Allergic rhinitis and chronic urticaria (non-drowsy).',
    'Generally non-sedating. Reduce dose in liver impairment.',
    'Hypersensitivity.',
    'Adults and children >= 12 years: 10 mg once daily.'),
  ('Omeprazole', 'Losec, Omepron', '20 mg', 'Capsule', 'Proton Pump Inhibitor', 'local',
    'otc',
    'Hyperacidity, GERD and peptic ulcer disease.',
    'Take 30-60 minutes before breakfast; swallow whole.',
    'Hypersensitivity; concurrent use with certain antiretrovirals.',
    'Adults: 20 mg once daily before breakfast (or as prescribed).'),
  ('Aluminum Hydroxide + Magnesium Hydroxide', 'Kremil-S, Maalox', '', 'Suspension', 'Antacid', 'local',
    'otc',
    'Relief of hyperacidity, heartburn and indigestion.',
    'Separate from other medicines by at least 2 hours. Shake well before use.',
    'Severe renal impairment; hypersensitivity.',
    'Adults: 10 mL (or 1-2 tablets) after meals and at bedtime as needed.')
on conflict do nothing;

commit;

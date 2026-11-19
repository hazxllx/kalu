-- Remove legacy seed dosage text from the medicine catalog. These values had
-- no source provenance and must not be mistaken for patient-specific orders.
-- Consultation prescriptions (public.visits.medications) are not modified.
begin;

with seeded(source, generic_name, strength, dosage_form, dosage_instructions) as (
  values
    ('yakap', 'Amoxicillin', '500 mg', 'Capsule', 'Adults: 500 mg every 8 hours (or as prescribed) for the full course.'),
    ('yakap', 'Co-amoxiclav', '625 mg', 'Tablet', 'Adults: 1 tablet (625 mg) every 8 hours (or as prescribed).'),
    ('yakap', 'Cotrimoxazole', '800/160 mg', 'Tablet', 'Adults: 1 tablet (800/160 mg) every 12 hours (or as prescribed).'),
    ('yakap', 'Nitrofurantoin', '100 mg', 'Capsule', 'Adults: 100 mg every 12 hours with food (or as prescribed).'),
    ('yakap', 'Ciprofloxacin', '500 mg', 'Tablet', 'Adults: 500 mg every 12 hours (or as prescribed).'),
    ('yakap', 'Clarithromycin', '500 mg', 'Tablet', 'Adults: 500 mg every 12 hours (or as prescribed).'),
    ('yakap', 'Oral Rehydration Salts (ORS)', '', 'Sachet', 'Dissolve 1 sachet in the labeled volume of clean water; give small sips after each loose stool.'),
    ('yakap', 'Prednisone', '20 mg', 'Tablet', 'As prescribed; take the full daily dose with food in the morning.'),
    ('yakap', 'Salbutamol', '2 mg', 'Tablet', 'Adults: 2-4 mg three to four times daily (or as prescribed).'),
    ('yakap', 'Fluticasone + Salmeterol', '250/25 mcg', 'Inhaler', 'Usually 1-2 inhalations twice daily (or as prescribed); rinse mouth after use.'),
    ('yakap', 'Paracetamol', '500 mg', 'Tablet', 'Adults: 1-2 tablets (500 mg-1 g) every 4-6 hours as needed; maximum 4 g (8 tablets) per day.'),
    ('yakap', 'Gliclazide', '80 mg', 'Tablet', 'Adults: 80 mg with breakfast; adjust as prescribed.'),
    ('yakap', 'Metformin', '500 mg', 'Tablet', 'Adults: 500 mg once or twice daily with meals; titrate as prescribed.'),
    ('yakap', 'Simvastatin', '20 mg', 'Tablet', 'Adults: 20 mg once daily in the evening (or as prescribed).'),
    ('yakap', 'Enalapril', '10 mg', 'Tablet', 'Adults: 10 mg once or twice daily (or as prescribed).'),
    ('yakap', 'Metoprolol', '50 mg', 'Tablet', 'Adults: 50 mg once or twice daily (or as prescribed).'),
    ('yakap', 'Amlodipine', '5 mg', 'Tablet', 'Adults: 5 mg once daily; up to 10 mg as prescribed.'),
    ('yakap', 'Hydrochlorothiazide', '25 mg', 'Tablet', 'Adults: 12.5-25 mg once daily in the morning (or as prescribed).'),
    ('yakap', 'Losartan', '50 mg', 'Tablet', 'Adults: 50 mg once daily; up to 100 mg as prescribed.'),
    ('yakap', 'Aspirin', '80 mg', 'Tablet', 'Adults: 80 mg once daily with food (or as prescribed).'),
    ('yakap', 'Chlorphenamine', '4 mg', 'Tablet', 'Adults: 4 mg every 4-6 hours as needed; maximum 24 mg/day.'),
    ('local', 'Zinc Sulfate', '20 mg', 'Tablet', 'Children: as per DOH diarrhea protocol for 10-14 days; adults as directed.'),
    ('local', 'Ferrous Sulfate + Folic Acid', '', 'Tablet', 'Adults: 1 tablet once daily (or as prescribed).'),
    ('local', 'Vitamin A', '200,000 IU', 'Capsule', 'Per DOH program schedule by age group.'),
    ('local', 'Multivitamins', '', 'Syrup', 'As directed on the label by age/weight.'),
    ('local', 'Paracetamol + Phenylephrine + Chlorphenamine', '500/10/2 mg', 'Tablet', 'Adults: 1 tablet every 6 hours as needed; maximum 4 tablets per day.'),
    ('local', 'Ascorbic Acid (Vitamin C)', '500 mg', 'Tablet', 'Adults: 1 tablet (500 mg) once daily, or as directed.'),
    ('local', 'Cetirizine', '10 mg', 'Tablet', 'Adults and children >= 12 years: 10 mg once daily.'),
    ('local', 'Ibuprofen', '400 mg', 'Tablet', 'Adults: 200-400 mg every 4-6 hours as needed with food; OTC maximum 1200 mg/day.'),
    ('local', 'Mefenamic Acid', '500 mg', 'Tablet', 'Adults: 500 mg initially, then 250 mg every 6 hours as needed with food.'),
    ('local', 'Loperamide', '2 mg', 'Capsule', 'Adults: 4 mg initially, then 2 mg after each loose stool; maximum 8 mg/day (OTC).'),
    ('local', 'Loratadine', '10 mg', 'Tablet', 'Adults and children >= 12 years: 10 mg once daily.'),
    ('local', 'Omeprazole', '20 mg', 'Capsule', 'Adults: 20 mg once daily before breakfast (or as prescribed).'),
    ('local', 'Aluminum Hydroxide + Magnesium Hydroxide', '', 'Suspension', 'Adults: 10 mL (or 1-2 tablets) after meals and at bedtime as needed.')
)
update public.medicines as m
set dosage_instructions = ''
from seeded as s
where m.source = s.source
  and lower(m.generic_name) = lower(s.generic_name)
  and lower(m.strength) = lower(s.strength)
  and lower(m.dosage_form) = lower(s.dosage_form)
  and m.dosage_instructions = s.dosage_instructions
  and m.created_by is null
  and m.dosage_verified_by is null
  and m.dosage_verified_at is null;

commit;

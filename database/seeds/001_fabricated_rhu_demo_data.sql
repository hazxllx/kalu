-- =============================================================================
-- KALUSAGAP — fabricated demo/reference data (development environments only)
--
-- These are NOT real people. Mirrors the file-driver demo seed so both data
-- layers behave identically. Never add real resident information here.
-- Applies on top of 20260903120000_create_rhu_patient_workflow.sql.
-- =============================================================================

begin;

-- residents: RES-000001 .. RES-000005
insert into public.residents (
  id, health_record_no, last_name, first_name, middle_name, suffix,
  birth_date, birth_place, sex, civil_status, religion, employment_status,
  father_name, mother_name, is_4ps_member, philhealth_no,
  current_address, permanent_address, cellphone_no, identity_no, barangay,
  created_by_id, created_by_role
) values
  ('RES-000001', 'RHU-000001', 'Santos', 'Maria', 'Reyes', '', '1992-05-14',
   'Pili, Camarines Sur', 'Female', 'Single', 'Roman Catholic', 'Employed',
   'Ramon Santos', 'Elena Reyes Santos', false, '12-345678901-2',
   'Zone 3, San Jose, Pili, Camarines Sur', 'Zone 3, San Jose, Pili, Camarines Sur',
   '0917 123 4567', '', 'San Jose', 'seed', 'bhw'),
  ('RES-000002', 'RHU-000002', 'Dela Cruz', 'Juan', 'Santos', '', '1985-03-09',
   'Calabanga, Camarines Sur', 'Male', 'Married', 'Roman Catholic', 'Employed',
   'Pedro Dela Cruz', 'Rosario Santos Dela Cruz', true, '11-223344556-7',
   'Zone 1, San Jose, Pili, Camarines Sur', 'Calabanga, Camarines Sur',
   '0918 234 5678', '', 'San Jose', 'seed', 'rhu_personnel'),
  ('RES-000003', 'RHU-000003', 'Aquino', 'Grace', 'Lim', '', '1999-11-20',
   'Pili, Camarines Sur', 'Female', 'Single', 'Roman Catholic', 'Student',
   'Danilo Aquino', 'Melanie Lim Aquino', true, '',
   'Sitio Maligaya, Cadlan, Pili, Camarines Sur', 'Sitio Maligaya, Cadlan, Pili, Camarines Sur',
   '0919 345 6789', '', 'Cadlan', 'seed', 'bhw'),
  ('RES-000004', 'RHU-000004', 'Aguilar', 'Roberto', 'Bautista', '', '1968-02-17',
   'Naga City, Camarines Sur', 'Male', 'Married', 'Roman Catholic', 'Self-Employed',
   'Tomas Aguilar', 'Leticia Bautista Aguilar', false, '12-998877665-4',
   'Purok 5, Cadlan, Pili, Camarines Sur', 'Purok 5, Cadlan, Pili, Camarines Sur',
   '0920 456 7890', '', 'Cadlan', 'seed', 'bhw'),
  ('RES-000005', 'RHU-000005', 'Mendoza', 'Lourdes', 'Ramos', '', '1963-08-30',
   'Talisay, Pili, Camarines Sur', 'Female', 'Widowed', 'Roman Catholic', 'Retired',
   'Benigno Ramos', 'Consuelo Ramos', true, '13-445566778-9',
   'Zone 2, Talisay, Pili, Camarines Sur', 'Zone 2, Talisay, Pili, Camarines Sur',
   '0921 567 8901', '', 'Talisay', 'seed', 'bhw');

-- visits (submissions already handed to the PHN queue): SUB-000001, SUB-000002
insert into public.visits (
  id, resident_id, recorded_by_id, recorded_by_role, recorded_by_name,
  status, visit_date, chief_complaint, clinical_history, findings,
  treatment_given, recommendation, bp, hr, rr, o2sat, temperature,
  height_cm, weight_kg, bmi, bmi_category, submitted_at
) values
  ('SUB-000001', 'RES-000001', 'dev-bhw', 'bhw', 'Maria Cruz', 'submitted',
   '2026-08-20T01:45:00Z',
   'Request for laboratory examination (CBC) — pallor, easy fatigability',
   'Patient reports progressive fatigue over the past month, occasional dizziness and pale appearance. No active bleeding. Menstrual history: regular. Dietary history: inadequate iron intake.',
   'Pale conjunctivae and nail beds. Tachycardic on exertion. Lungs clear. Abdomen soft, non-tender. No jaundice or petechiae.',
   'Ferrous sulfate 60 mg once a day x 30 days; advised dietary iron sources.',
   'CBC and peripheral smear. Return for follow-up with results.',
   '110/70', 76, 18, 98, 36.5, 158, 55, 22.0, 'Normal',
   '2026-08-20T02:00:00Z'),
  ('SUB-000002', 'RES-000002', 'dev-rhu_personnel', 'rhu_personnel', 'Antonio Reyes', 'submitted',
   '2026-08-22T00:30:00Z',
   'Recurrent epigastric pain with heartburn',
   'Burning epigastric pain for 3 weeks, worse after meals and at night. Relieved temporarily by antacids. No hematemesis or melena. Smoker, 10 sticks/day. Occasional alcohol intake.',
   'Mild epigastric tenderness on palpation. No palpable mass or organomegaly. Bowel sounds normal.',
   'Omeprazole 20 mg once daily before breakfast x 14 days. Advised smoking cessation.',
   'Reassess after 2 weeks. Consider H. pylori testing / upper endoscopy if symptoms persist.',
   '120/80', 82, 20, 97, 36.8, 170, 72, 24.9, 'Normal',
   '2026-08-22T00:45:00Z');

-- keep identifiers in sync with the seeded rows above
update public.record_counters set value = 5 where name = 'residents';
update public.record_counters set value = 2 where name = 'submissions';
update public.record_counters set value = 0 where name = 'referrals';

commit;

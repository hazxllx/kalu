-- KALUSAGAP - Maternal Care TCL (PN / Intra / PP) documentation fields
--
-- Additive only. Closes the gap between the official "TCL PN PP" worksheet and
-- the existing public.maternal_records model by adding the prenatal
-- immunization, micronutrient, deworming, infectious-disease surveillance,
-- laboratory-screening, registration/identity and delivery/postpartum detail
-- fields the worksheet records but the table did not yet have.
--
-- These are NEUTRAL DOCUMENTATION fields, consistent with the earlier maternal
-- migrations (20260924070000, 20261003000000): no clinical rule, dosage,
-- eligibility or classification is encoded, no CHECK constraints are added (so
-- legacy/empty rows are preserved), and nothing here changes FHSIS M1
-- behaviour. The existing delivery/postpartum columns are kept as-is; this
-- migration only ADDS columns and never rewrites a row.
--
-- Repeated per-visit items (Td/TT doses, prenatal/postpartum micronutrient
-- visits) are stored as jsonb maps (same pattern as public.m1_records.detail),
-- keeping one column per logical group instead of a wide sparse matrix.

begin;

alter table public.maternal_records
  -- Registration & identity (worksheet cols 1,2,5)
  add column if not exists date_of_registration date,
  add column if not exists family_serial_no text not null default '',
  add column if not exists socio_economic_status text not null default '',
  -- Obstetric score (worksheet col 7: G-P)
  add column if not exists gravida integer,
  add column if not exists para integer,
  -- Immunization status (worksheet col 10): Td/TT dose dates + FIM status
  --   { "td1": "YYYY-MM-DD", ... "td5": "YYYY-MM-DD" }
  add column if not exists tt_td_doses jsonb not null default '{}'::jsonb,
  add column if not exists fim_status boolean not null default false,
  -- Micronutrient supplementation (worksheet col 11): per-visit date + tablet
  -- counts. { "iron_folic": {"v1":{"date":..,"tablets":..}, ...},
  --           "calcium": {...} }
  add column if not exists prenatal_micronutrients jsonb not null default '{}'::jsonb,
  add column if not exists iodine_given_date date,
  -- Deworming tablet (worksheet col 13, 2nd/3rd tri)
  add column if not exists deworming_date date,
  -- Infectious disease surveillance (worksheet col 14)
  add column if not exists syphilis_screen_date date,
  add column if not exists syphilis_result text not null default '',   -- '+' / '-'
  add column if not exists hepb_screen_date date,
  add column if not exists hepb_result text not null default '',       -- '+' / '-'
  add column if not exists hiv_screen_date date,
  -- Laboratory screening (worksheet col 15)
  add column if not exists gdm_screen_date date,
  add column if not exists gdm_result text not null default '',        -- '+' / '-'
  add column if not exists cbc_screen_date date,
  add column if not exists cbc_result text not null default '',        -- '+' anemia / '-'
  add column if not exists cbc_iron_given boolean not null default false,
  -- Pregnancy outcome (worksheet col 16)
  add column if not exists pregnancy_outcome text not null default '', -- FT/PT/FD/AB
  add column if not exists pregnancy_outcome_date date,
  add column if not exists newborn_sex text not null default '',       -- M/F
  -- Delivery detail (worksheet cols 17-22)
  add column if not exists delivery_time text not null default '',
  add column if not exists birth_weight_class text not null default '', -- low/normal/unknown
  -- Postpartum micronutrient (worksheet col 24): per-month iron+folic
  --   { "m1": {"date":..,"tablets":..}, "m2": {...}, "m3": {...} }
  add column if not exists pp_iron_folic jsonb not null default '{}'::jsonb;

commit;

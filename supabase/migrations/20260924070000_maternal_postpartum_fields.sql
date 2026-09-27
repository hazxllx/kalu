-- KALUSAGAP - Extend M1 / Maternal records with post-partum care, delivery
-- outcome, supplementation and lifestyle documentation fields.
--
-- Source of truth for the field set: the "Household and Health Profile —
-- Post-partum Care and Delivery Outcome" reference form. Additive only: new
-- columns on the EXISTING public.maternal_records (no new table, no
-- postpartum_records, no duplication). Household identification and member
-- demographics (Zone No., HH No., member name/relation/birthday/age/sex) are
-- intentionally NOT duplicated here — they live in households /
-- household_members / residents and are displayed from there.
--
-- These are neutral DOCUMENTATION fields. No clinical rule, dosage, schedule,
-- eligibility, or BMI risk classification is encoded — BMI is stored as a
-- recorded value only. Any classification "Requires validation with RHU/MHO".

begin;

alter table public.maternal_records
  -- Post-partum care and delivery outcome
  add column if not exists type_of_delivery text not null default '',
  add column if not exists birth_weight text not null default '',
  add column if not exists place_of_delivery text not null default '',
  add column if not exists birth_attendant text not null default '',
  -- Post-partum check-ups (date each visit was done; null = not recorded)
  add column if not exists pp_checkup_24h date,
  add column if not exists pp_checkup_day3 date,
  add column if not exists pp_checkup_7_14d date,
  add column if not exists pp_checkup_6wk date,
  -- Supplementation / preventive care (documentation dates only)
  add column if not exists iron_folic_completed_date date,
  add column if not exists vitamin_a_given_date date,
  -- Health / lifestyle profile (documentation booleans; no risk scoring)
  add column if not exists smoking_history boolean not null default false,
  add column if not exists binge_alcohol boolean not null default false,
  add column if not exists insufficient_physical_activity boolean not null default false,
  add column if not exists unhealthy_diet boolean not null default false,
  -- Body Mass Index (Asia Pacific Standard) — recorded value only, unclassified
  add column if not exists bmi numeric(5, 2);

commit;

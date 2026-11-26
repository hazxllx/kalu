-- supabase/migrations/20261116110000_maternal_visit_detail_snapshots.sql
-- Preserve the clinical details captured at each maternal encounter while
-- reusing the existing maternal_visits history table.

begin;

alter table public.maternal_visits
  add column if not exists height_cm numeric(5, 2),
  add column if not exists clinical_data jsonb not null default '{}'::jsonb;

alter table public.maternal_records
  alter column fim_status drop not null,
  alter column fim_status drop default,
  alter column cbc_iron_given drop not null,
  alter column cbc_iron_given drop default,
  alter column smoking_history drop not null,
  alter column smoking_history drop default,
  alter column binge_alcohol drop not null,
  alter column binge_alcohol drop default,
  alter column insufficient_physical_activity drop not null,
  alter column insufficient_physical_activity drop default,
  alter column unhealthy_diet drop not null,
  alter column unhealthy_diet drop default;

commit;

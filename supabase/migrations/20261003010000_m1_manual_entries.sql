-- KALUSAGAP — FHSIS M1 manual reporting entries
--
-- Additive only. Companion to public.m1_records (the per-event store) and the
-- derived sources (maternal_records / immunizations / households /
-- household_member_health_profiles).
--
-- WHY A SEPARATE TABLE:
--   Many FHSIS M1 program indicators are AGGREGATE monthly figures that have no
--   per-resident operational record in KALUSAGAP (e.g. "pregnant women screened
--   for syphilis", "pre-term births", oral-care and NCD service counts). The
--   health supervisor must be able to enter these as the official form requires
--   — by Reporting Year, Reporting Month, Indicator, and the indicator's age or
--   sex breakdown — and EDIT them later with the value being UPDATED in place
--   (never duplicated). An append-only per-event store cannot express "set this
--   month's 20–49 value to 4"; this table can, via the uniqueness key below.
--
-- Monthly / Quarterly / Annual reports read these rows by (period_year,
-- period_month) and SUM them over the selected range, exactly like the derived
-- sources — a quarter is its three months, a year is its twelve months.
--
-- One row per (barangay, indicator, year, month, age_group, sex) bucket. For an
-- age-banded indicator the buckets are the age groups (sex = ''); for a
-- sex-split indicator the buckets are the sexes (age_group = 'Total'); a
-- total-only indicator stores a single ('Total','') bucket. The report Total is
-- always derived by summing the stored buckets, so a stored "Total" can never
-- disagree with its parts. Remarks are kept in public.m1_indicator_remarks
-- (shared with the derived indicators), not duplicated here.

begin;

create table public.m1_manual_entries (
  id uuid primary key default gen_random_uuid(),
  indicator_code text not null,
  barangay_id uuid not null references public.barangays(id) on delete cascade,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  period_year integer not null check (period_year between 2000 and 2100),
  period_month integer not null check (period_month between 1 and 12),
  age_group text not null default 'Total',
  sex text not null default '' check (sex in ('', 'Male', 'Female', 'Other')),
  value numeric not null default 0 check (value >= 0),
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The upsert key: re-saving the same bucket UPDATES the stored value in place
  -- instead of creating an uncontrolled duplicate.
  constraint m1_manual_entries_unique
    unique (barangay_id, indicator_code, period_year, period_month, age_group, sex)
);

create index m1_manual_entries_scope_idx
  on public.m1_manual_entries(barangay_id, period_year, period_month);
create index m1_manual_entries_indicator_idx
  on public.m1_manual_entries(indicator_code, period_year, period_month);

-- Derive municipality from the barangay so a caller can never place a figure in
-- a municipality they do not cover by sending an arbitrary id (mirrors the
-- m1_records / m1_indicator_remarks scope triggers).
create or replace function public.sync_m1_manual_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare b public.barangays%rowtype;
begin
  select * into b from public.barangays where id = new.barangay_id;
  if not found then raise exception 'm1 manual entry: unknown barangay_id %', new.barangay_id; end if;
  new.municipality_id := b.municipality_id;
  return new;
end; $$;

create trigger m1_manual_entries_scope
  before insert or update on public.m1_manual_entries
  for each row execute function public.sync_m1_manual_scope();

create trigger m1_manual_entries_updated
  before update on public.m1_manual_entries
  for each row execute function public.set_updated_at();

-- RLS mirrors the operational-records boundary exactly, like m1_records:
--   admin                     -> all
--   mho / phn / rhu_personnel -> own municipality
--   health_supervisor / bhw   -> own assigned barangay only
alter table public.m1_manual_entries enable row level security;

create policy m1_manual_entries_select on public.m1_manual_entries
  for select to authenticated
  using (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() in ('health_supervisor', 'bhw') and barangay_id = public.profile_barangay_id())
      )
    )
  );

create policy m1_manual_entries_write on public.m1_manual_entries
  for all to authenticated
  using (public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id)))
  with check (public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id)));

commit;

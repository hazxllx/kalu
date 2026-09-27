-- KALUSAGAP — FHSIS M1 reporting/aggregation layer
--
-- Additive only. No existing residents, households, household_members, visits,
-- referrals, maternal, immunization, notification, or audit rows are deleted or
-- rewritten. This migration adds the M1 (Field Health Services Information
-- System, Form M1) reporting layer on top of the existing health records:
--
--   m1_indicators        the indicator CATALOG (one row per FHSIS M1 indicator,
--                         all sections A..H). Seeded/kept in sync from
--                         backend/src/config/m1Catalog.js by the API
--                         (ensureCatalog upsert) — the JS module is the single
--                         source of truth; this table mirrors it for joins.
--   m1_records           the underlying EVENT store for indicators that have no
--                         existing source table. Barangay-scoped exactly like
--                         the operational records; one row per service/visit/
--                         case event, always traceable to a resident/household.
--   m1_report_meta       per (barangay, month, year) report header + prepared-
--                         by / validated-by workflow fields.
--   m1_indicator_remarks per (barangay, indicator, month, year) section-level
--                         remarks (the M1 "Remarks" column).
--
-- Indicators for immunization, WASH/households and member mortality are NOT
-- stored here — they are aggregated from the existing immunizations /
-- households / household_member_health_profiles tables by the API. No duplicate
-- records are created.

begin;

-- ---------------------------------------------------------------------------
-- Indicator catalog (mirror of backend/src/config/m1Catalog.js)
-- ---------------------------------------------------------------------------
create table public.m1_indicators (
  code text primary key,
  section text not null,
  subsection text not null default '',
  name text not null,
  frequency text not null default 'monthly'
    check (frequency in ('monthly', 'quarterly', 'annual', 'november')),
  aggregation text not null default 'TOTAL',
  source text not null default 'm1_records',
  age_scheme text not null default 'none',
  age_groups jsonb not null default '["Total"]'::jsonb,
  sex_breakdown boolean not null default false,
  remarks_allowed boolean not null default true,
  data_type text not null default 'count',
  match jsonb,
  population text,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index m1_indicators_section_idx on public.m1_indicators(section, display_order);

create trigger m1_indicators_set_updated_at before update on public.m1_indicators
  for each row execute function public.set_updated_at();

-- The catalog is public reference data (drives the report UI for every signed-in
-- staff member). Only administrators may write it; the API upserts it with the
-- service-role key, which bypasses RLS.
alter table public.m1_indicators enable row level security;
create policy m1_indicators_select on public.m1_indicators
  for select to authenticated using (true);
create policy m1_indicators_write on public.m1_indicators
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Underlying M1 event records
-- ---------------------------------------------------------------------------
create table public.m1_records (
  id uuid primary key default gen_random_uuid(),
  indicator_code text not null,
  -- Either a resident, a household, or neither (barangay-level events such as
  -- ZOD declaration / industrial sanitary permit). Scope is derived below.
  resident_id text references public.residents(id) on delete restrict,
  household_id text references public.households(id) on delete restrict,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,
  record_date date not null default current_date,
  value numeric not null default 1 check (value >= 0),
  sex text not null default '' check (sex in ('', 'Male', 'Female', 'Other')),
  age_group text not null default '',
  status text not null default 'Completed',
  detail jsonb not null default '{}'::jsonb,
  remarks text not null default '',
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index m1_records_scope_idx on public.m1_records(barangay_id, indicator_code, record_date);
create index m1_records_resident_idx on public.m1_records(resident_id);
create index m1_records_household_idx on public.m1_records(household_id);
create index m1_records_date_idx on public.m1_records(record_date);
create index m1_records_indicator_idx on public.m1_records(indicator_code, record_date);

-- Derive scope from the linked resident or household so a caller can never
-- place a record in a barangay they do not cover by sending an arbitrary id.
-- For barangay-level events (no resident/household) the caller-supplied
-- barangay_id is retained and validated by the RLS insert policy
-- (profile_covers_barangay).
create or replace function public.sync_m1_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.residents%rowtype;
  h public.households%rowtype;
  b public.barangays%rowtype;
begin
  if new.resident_id is not null then
    select * into r from public.residents where id = new.resident_id;
    if not found then raise exception 'm1 record: resident not found'; end if;
    new.municipality_id := r.municipality_id;
    new.barangay_id := r.barangay_id;
  elsif new.household_id is not null then
    select * into h from public.households where id = new.household_id;
    if not found then raise exception 'm1 record: household not found'; end if;
    new.municipality_id := h.municipality_id;
    new.barangay_id := h.barangay_id;
  else
    if new.barangay_id is null then
      raise exception 'm1 record: a resident, household, or barangay is required';
    end if;
    select * into b from public.barangays where id = new.barangay_id;
    if not found then raise exception 'm1 record: unknown barangay_id %', new.barangay_id; end if;
    new.municipality_id := b.municipality_id;
  end if;
  return new;
end; $$;

create trigger m1_records_scope
  before insert or update on public.m1_records
  for each row execute function public.sync_m1_scope();

create trigger m1_records_updated
  before update on public.m1_records
  for each row execute function public.set_updated_at();

-- RLS mirrors the operational-records boundary exactly:
--   admin                     -> all
--   mho / phn / rhu_personnel -> own municipality
--   health_supervisor / bhw   -> own assigned barangay only
--   resident                  -> only records linked to their own account
alter table public.m1_records enable row level security;

create policy m1_records_select on public.m1_records
  for select to authenticated
  using (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() in ('health_supervisor', 'bhw') and barangay_id = public.profile_barangay_id())
      )
    ) or exists (
      select 1 from public.residents r
      where r.id = m1_records.resident_id and r.auth_user_id = auth.uid()
    )
  );

create policy m1_records_insert on public.m1_records
  for insert to authenticated
  with check (public.is_staff_active() and public.profile_covers_barangay(barangay_id));

create policy m1_records_update on public.m1_records
  for update to authenticated
  using (public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id)))
  with check (public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id)));

create policy m1_records_delete on public.m1_records
  for delete to authenticated
  using (public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id)));

-- ---------------------------------------------------------------------------
-- Report header + workflow metadata (one row per barangay/month/year)
-- ---------------------------------------------------------------------------
create table public.m1_report_meta (
  id uuid primary key default gen_random_uuid(),
  barangay_id uuid not null references public.barangays(id) on delete cascade,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  period_year integer not null check (period_year between 2000 and 2100),
  period_month integer not null check (period_month between 1 and 12),
  bhs_name text not null default '',
  projected_population integer check (projected_population is null or projected_population >= 0),
  prepared_by text not null default '',
  designation text not null default '',
  validated_by text not null default '',
  date_submitted date,
  date_validated date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint m1_report_meta_period_unique unique (barangay_id, period_year, period_month)
);

create index m1_report_meta_scope_idx on public.m1_report_meta(barangay_id, period_year, period_month);

create or replace function public.sync_m1_report_meta_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare b public.barangays%rowtype;
begin
  select * into b from public.barangays where id = new.barangay_id;
  if not found then raise exception 'm1 report meta: unknown barangay_id %', new.barangay_id; end if;
  new.municipality_id := b.municipality_id;
  return new;
end; $$;

create trigger m1_report_meta_scope
  before insert or update on public.m1_report_meta
  for each row execute function public.sync_m1_report_meta_scope();

create trigger m1_report_meta_updated
  before update on public.m1_report_meta
  for each row execute function public.set_updated_at();

alter table public.m1_report_meta enable row level security;

create policy m1_report_meta_select on public.m1_report_meta
  for select to authenticated
  using (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() in ('health_supervisor', 'bhw') and barangay_id = public.profile_barangay_id())
      )
    )
  );

create policy m1_report_meta_write on public.m1_report_meta
  for all to authenticated
  using (public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id)))
  with check (public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id)));

-- ---------------------------------------------------------------------------
-- Section-level remarks (the M1 "Remarks" column)
-- ---------------------------------------------------------------------------
create table public.m1_indicator_remarks (
  id uuid primary key default gen_random_uuid(),
  barangay_id uuid not null references public.barangays(id) on delete cascade,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  indicator_code text not null,
  period_year integer not null check (period_year between 2000 and 2100),
  period_month integer not null check (period_month between 1 and 12),
  remarks text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint m1_indicator_remarks_unique unique (barangay_id, indicator_code, period_year, period_month)
);

create index m1_indicator_remarks_scope_idx
  on public.m1_indicator_remarks(barangay_id, period_year, period_month);

create or replace function public.sync_m1_remarks_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare b public.barangays%rowtype;
begin
  select * into b from public.barangays where id = new.barangay_id;
  if not found then raise exception 'm1 remarks: unknown barangay_id %', new.barangay_id; end if;
  new.municipality_id := b.municipality_id;
  return new;
end; $$;

create trigger m1_indicator_remarks_scope
  before insert or update on public.m1_indicator_remarks
  for each row execute function public.sync_m1_remarks_scope();

create trigger m1_indicator_remarks_updated
  before update on public.m1_indicator_remarks
  for each row execute function public.set_updated_at();

alter table public.m1_indicator_remarks enable row level security;

create policy m1_indicator_remarks_select on public.m1_indicator_remarks
  for select to authenticated
  using (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() in ('health_supervisor', 'bhw') and barangay_id = public.profile_barangay_id())
      )
    )
  );

create policy m1_indicator_remarks_write on public.m1_indicator_remarks
  for all to authenticated
  using (public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id)))
  with check (public.is_admin() or (public.is_staff_active() and public.profile_covers_barangay(barangay_id)));

commit;

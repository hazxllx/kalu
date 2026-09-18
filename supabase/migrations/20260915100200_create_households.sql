-- =============================================================================
-- KALUSAGAP — households & household members
--
-- Phase 5. Runs AFTER all three earlier migrations (org/profiles helpers and
-- the clinical scope columns are required).
--
-- The Household Profiling workflow (BHW collection -> Health Supervisor
-- verification -> risk classification) previously lived only in frontend mock
-- stores. These tables give it a real home:
--
--   households         one row per surveyed household, scoped to a barangay of
--                      the deployment municipality, with the WASH/socioeconomic
--                      fields the profiling form collects and a RISK
--                      CLASSIFICATION computed server-side (never trusted from
--                      the client) by the ported household-risk rules.
--   household_members  household roster. `resident_id` links a member to an
--                      existing resident record (adding the same resident
--                      twice is blocked by a unique constraint); free-form
--                      members are allowed while registration catches up.
--
-- Households are allocated human-readable ids (HH-001...) through the existing
-- record_counters function, matching residents/visits/referrals.
-- =============================================================================

begin;

create table public.households (
  id text primary key,
  municipality_id uuid not null references public.municipalities(id) on delete restrict,
  barangay_id uuid not null references public.barangays(id) on delete restrict,
  barangay text not null default '',

  -- Household identity
  head_name text not null,
  purok text not null default '',
  street_address text not null default '',
  contact text not null default '',
  families integer not null default 1 check (families >= 1),
  monthly_income numeric check (monthly_income is null or monthly_income >= 0),

  -- Profiling workflow states
  hh_status text not null default 'Pending' check (hh_status in (
    'Pending', 'Ongoing', 'Submitted', 'Needs Update', 'Approved', 'Refused',
    'For Masterlist Update', 'Non-Eligible', 'Duplicate', 'Migrated', 'Other'
  )),
  approval_status text not null default 'Not yet approved' check (approval_status in (
    'Not yet approved', 'Approved', 'Needs revision'
  )),

  -- Respondent
  respondent_last text not null default '',
  respondent_first text not null default '',
  respondent_maiden text not null default '',
  nhts text not null default '',
  ip text not null default '',

  -- PhilHealth
  philhealth_member boolean not null default false,
  philhealth_id text not null default '',
  philhealth_category text not null default '',

  -- Water, sanitation & hygiene (values match the profiling form options)
  water_source text not null default '' check (water_source in ('', 'level1', 'level2', 'level3', 'unimproved')),
  water_type text not null default '',
  water_distance text not null default '',
  water_availability text not null default '',
  water_treated boolean not null default false,
  treatment_methods jsonb not null default '[]'::jsonb,
  toilet_type text not null default '' check (toilet_type in ('', 'ws_own', 'ws_shared', 'open_pit', 'antipolo', 'none')),
  sanitation_access text not null default '',
  waste_disposal text not null default '',
  waste_segregation text not null default '',
  quarter_visits jsonb not null default '{}'::jsonb,

  -- Risk classification — computed by the API on every write; the client
  -- value is never stored.
  risk_score integer not null default 0 check (risk_score >= 0),
  risk_level text not null default 'Low' check (risk_level in ('Low', 'Moderate', 'High')),
  risk_factors jsonb not null default '[]'::jsonb,
  flags jsonb not null default '[]'::jsonb,

  -- Health Supervisor verification of the gathered data
  verification_status text not null default 'Pending Verification' check (verification_status in (
    'Pending Verification', 'Verified', 'Returned for Correction'
  )),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  correction_reason text not null default '',

  -- Provenance
  collector_id uuid references public.profiles(id) on delete set null,
  collector_name text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint households_barangay_name_unique unique (barangay_id, head_name, purok, street_address)
);

create index households_municipality_id_idx on public.households(municipality_id);
create index households_barangay_id_idx on public.households(barangay_id);
create index households_risk_level_idx on public.households(risk_level);
create index households_verification_status_idx on public.households(verification_status);

create trigger households_set_updated_at before update on public.households
  for each row execute function public.set_updated_at();

-- Keep the denormalized barangay name in sync with barangay_id (same pattern
-- as residents), so list/search can filter on the name the UI already uses.
create or replace function public.households_sync_barangay()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.barangays%rowtype;
begin
  select * into b from public.barangays where id = new.barangay_id;
  if not found then
    raise exception 'households: unknown barangay_id %', new.barangay_id;
  end if;
  if b.municipality_id <> new.municipality_id then
    raise exception 'households: barangay does not belong to the household municipality';
  end if;
  new.barangay := b.name;
  return new;
end;
$$;

create trigger households_sync_barangay_trigger
  before insert or update on public.households
  for each row execute function public.households_sync_barangay();

-- A BHW (data collector) may never write the verification outcome — those
-- transitions belong to the Health Supervisor and are service-enforced too.
create or replace function public.guard_household_verification_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'update' and auth.uid() is not null and public.profile_role() = 'bhw' then
    if new.verification_status is distinct from old.verification_status
       or new.verified_by is distinct from old.verified_by
       or new.verified_at is distinct from old.verified_at
       or new.correction_reason is distinct from old.correction_reason then
      raise exception 'households: verification outcomes can only be set by the Health Supervisor';
    end if;
  end if;
  return new;
end;
$$;

create trigger households_guard_verification
  before update on public.households
  for each row execute function public.guard_household_verification_writes();

-- ---------------------------------------------------------------------------
-- Household members
-- ---------------------------------------------------------------------------

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id text not null references public.households(id) on delete cascade,
  -- Optional link to a registered resident: adding the same resident to the
  -- same household twice is a constraint violation (free-form members with
  -- NULL resident_id are unconstrained).
  resident_id text references public.residents(id) on delete set null,
  name text not null,
  birthday text not null default '',
  age integer check (age is null or age >= 0),
  sex text not null default '' check (sex in ('', 'Male', 'Female')),
  classification text not null default '',
  relationship text not null default '',
  is_pwd boolean not null default false,
  philhealth text not null default '' check (philhealth in ('', 'member', 'non-member')),
  fp_method text not null default '',
  quarter_status text not null default '',
  is_head boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint household_members_resident_unique unique (household_id, resident_id)
);

create index household_members_household_id_idx on public.household_members(household_id);
create index household_members_resident_id_idx on public.household_members(resident_id);

create trigger household_members_set_updated_at before update on public.household_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — households follow the established scope rules:
--   mho / phn / rhu_personnel -> own municipality
--   health_supervisor / bhw   -> exactly their assigned barangay
--   residents                 -> no household access (no resident household UI)
-- ---------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.household_members enable row level security;

create policy households_select on public.households
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and (
        (
          public.profile_role() in ('mho', 'phn', 'rhu_personnel')
          and municipality_id = public.profile_municipality_id()
        )
        or (
          public.profile_role() in ('health_supervisor', 'bhw')
          and barangay_id = public.profile_barangay_id()
        )
      )
    )
  );

create policy households_insert on public.households
  for insert to authenticated
  with check (
    public.is_staff_active()
    and public.profile_role() in ('bhw', 'health_supervisor', 'phn')
    and public.profile_covers_barangay(barangay_id)
  );

create policy households_update on public.households
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('bhw', 'health_supervisor', 'phn')
      and public.profile_covers_barangay(barangay_id)
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('bhw', 'health_supervisor', 'phn')
      and public.profile_covers_barangay(barangay_id)
    )
  );

-- No delete policy: households are archived through hh_status, preserving
-- community health history.

create policy household_members_select on public.household_members
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and exists (
        select 1 from public.households h
        where h.id = household_members.household_id
          and (
            (
              public.profile_role() in ('mho', 'phn', 'rhu_personnel')
              and h.municipality_id = public.profile_municipality_id()
            )
            or (
              public.profile_role() in ('health_supervisor', 'bhw')
              and h.barangay_id = public.profile_barangay_id()
            )
          )
      )
    )
  );

create policy household_members_insert on public.household_members
  for insert to authenticated
  with check (
    public.is_staff_active()
    and public.profile_role() in ('bhw', 'health_supervisor', 'phn')
    and exists (
      select 1 from public.households h
      where h.id = household_id
        and public.profile_covers_barangay(h.barangay_id)
    )
  );

create policy household_members_update on public.household_members
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('bhw', 'health_supervisor', 'phn')
      and exists (
        select 1 from public.households h
        where h.id = household_members.household_id
          and public.profile_covers_barangay(h.barangay_id)
      )
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('bhw', 'health_supervisor', 'phn')
      and exists (
        select 1 from public.households h
        where h.id = household_id
          and public.profile_covers_barangay(h.barangay_id)
      )
    )
  );

create policy household_members_delete on public.household_members
  for delete to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('bhw', 'health_supervisor', 'phn')
      and exists (
        select 1 from public.households h
        where h.id = household_members.household_id
          and public.profile_covers_barangay(h.barangay_id)
      )
    )
  );

commit;

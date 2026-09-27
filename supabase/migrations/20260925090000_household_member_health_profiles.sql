-- KALUSAGAP - Household member health profile (foundation)
--
-- Additive only. No existing residents, households, household_members, visits,
-- referrals, maternal, immunization, notification, or audit rows are deleted or
-- rewritten.
--
-- This is the member-level foundation for the Household Profiling health
-- sections. It attaches to an EXISTING household_members row (1:1) rather than
-- duplicating the person, and copies scope (municipality_id / barangay_id) from
-- the parent household through a trigger so a caller can never inject an
-- arbitrary barangay. RLS mirrors household_members exactly.
--
-- Only well-defined, non-clinical-rule fields are added here:
--   * anthropometrics (height_cm, weight_kg) + BMI
--   * mortality (date_of_death, cause_of_death)
--   * trans-out + free-text remarks (reference-form REMARKS section)
--
-- BMI is a RECORDED VALUE ONLY (no risk classification is encoded). The API
-- recomputes it server-side from the stored height/weight on every write and
-- clears it to NULL when either measurement is missing/invalid — a client BMI
-- is never trusted. The CHECK constraint only bounds the value. No PhilPEN /
-- BMI risk classification, disease classification, or clinical rule is created
-- by this migration; those health sections are added in later additive
-- migrations.

begin;

create table public.household_member_health_profiles (
  id uuid primary key default gen_random_uuid(),
  -- 1:1 with an existing household member (never a second person record).
  household_member_id uuid not null unique
    references public.household_members(id) on delete cascade,
  -- Denormalized parent + scope, populated by the trigger below (never trusted
  -- from the client).
  household_id text references public.households(id) on delete cascade,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,

  -- Anthropometrics + BMI (recorded value only; server-recomputed, unclassified)
  height_cm numeric check (height_cm is null or (height_cm > 0 and height_cm < 300)),
  weight_kg numeric check (weight_kg is null or (weight_kg > 0 and weight_kg < 500)),
  bmi numeric(5, 2) check (bmi is null or (bmi > 0 and bmi < 200)),
  bmi_measured_at date,

  -- Mortality (reference-form MORTALITY section)
  date_of_death date,
  cause_of_death text not null default '',

  -- Remarks section (Trans-out flag + free text)
  trans_out boolean not null default false,
  remarks text not null default '',

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index household_member_health_household_idx
  on public.household_member_health_profiles(household_id);
create index household_member_health_scope_idx
  on public.household_member_health_profiles(barangay_id);

-- Resolve parent household + scope from the linked household_member so callers
-- cannot select an arbitrary household/barangay for a health profile row.
create or replace function public.sync_household_member_health_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m public.household_members%rowtype;
  h public.households%rowtype;
begin
  select * into m from public.household_members where id = new.household_member_id;
  if not found then
    raise exception 'household member health profile: household member not found';
  end if;
  select * into h from public.households where id = m.household_id;
  if not found then
    raise exception 'household member health profile: household not found';
  end if;
  new.household_id := h.id;
  new.municipality_id := h.municipality_id;
  new.barangay_id := h.barangay_id;
  return new;
end; $$;

create trigger household_member_health_scope
  before insert or update on public.household_member_health_profiles
  for each row execute function public.sync_household_member_health_scope();

create trigger household_member_health_updated
  before update on public.household_member_health_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — identical scope rules to household_members (resolved through the parent
-- household): mho/phn/rhu_personnel -> own municipality; health_supervisor/bhw
-- -> exactly their assigned barangay; residents -> no access.
-- ---------------------------------------------------------------------------

alter table public.household_member_health_profiles enable row level security;

create policy household_member_health_select on public.household_member_health_profiles
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and exists (
        select 1 from public.households h
        where h.id = household_member_health_profiles.household_id
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

create policy household_member_health_insert on public.household_member_health_profiles
  for insert to authenticated
  with check (
    public.is_staff_active()
    and public.profile_role() in ('bhw', 'health_supervisor', 'phn')
    and exists (
      select 1 from public.household_members m
      join public.households h on h.id = m.household_id
      where m.id = household_member_id
        and public.profile_covers_barangay(h.barangay_id)
    )
  );

create policy household_member_health_update on public.household_member_health_profiles
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('bhw', 'health_supervisor', 'phn')
      and exists (
        select 1 from public.households h
        where h.id = household_member_health_profiles.household_id
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
        select 1 from public.household_members m
        join public.households h on h.id = m.household_id
        where m.id = household_member_id
          and public.profile_covers_barangay(h.barangay_id)
      )
    )
  );

create policy household_member_health_delete on public.household_member_health_profiles
  for delete to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('bhw', 'health_supervisor', 'phn')
      and exists (
        select 1 from public.households h
        where h.id = household_member_health_profiles.household_id
          and public.profile_covers_barangay(h.barangay_id)
      )
    )
  );

commit;

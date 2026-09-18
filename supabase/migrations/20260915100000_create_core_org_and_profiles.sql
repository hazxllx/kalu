-- =============================================================================
-- KALUSAGAP — core organization & account schema
--
-- Phase 2 of the Supabase backend. Creates:
--   app_role          canonical role enum (mirrors frontend/src/lib/roles.js
--                     and backend/src/config/roles.js)
--   municipalities    deployment municipality registry
--   barangays         barangay registry (canonical: San Isidro, San Antonio,
--                     Old San Roque — see seeds/002_reference_data.sql)
--   facilities        RHU + barangay health stations
--   profiles          the account layer — one row per auth.users user, holding
--                     role, status and municipality/barangay assignment.
--                     NEVER stores passwords: credentials live only in
--                     Supabase Auth.
--   role_permissions  the admin-editable permission matrix (currently
--                     persisted in the frontend; migrated here later)
--
-- plus the RLS helper functions every scope-aware policy builds on, and the
-- trigger that creates a pending profile for each new Supabase Auth user.
--
-- Runs AFTER 20260903120000_create_rhu_patient_workflow.sql (this migration
-- reuses its public.set_updated_at() helper).
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
-- 'resident-limited' is the pending-verification sub-state of a resident
-- account, exactly as in the frontend ROLE map.
create type public.app_role as enum (
  'admin',
  'mho',
  'phn',
  'health_supervisor',
  'rhu_personnel',
  'bhw',
  'resident',
  'resident-limited'
);

-- ---------------------------------------------------------------------------
-- Municipality / barangay / facility registry
-- ---------------------------------------------------------------------------

create table public.municipalities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  province text not null default '',
  region text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint municipalities_name_province_unique unique (name, province)
);

create table public.barangays (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references public.municipalities(id) on delete restrict,
  name text not null,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  captain text not null default '',
  contact text not null default '',
  health_station_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint barangays_municipality_name_unique unique (municipality_id, name)
);

create index barangays_municipality_id_idx on public.barangays(municipality_id);

create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete set null,
  name text not null,
  type text not null check (type in ('rhu', 'barangay_health_station')),
  address text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint facilities_municipality_name_unique unique (municipality_id, name)
);

create index facilities_municipality_id_idx on public.facilities(municipality_id);
create index facilities_barangay_id_idx on public.facilities(barangay_id);

-- ---------------------------------------------------------------------------
-- Profiles — one row per Supabase Auth user
-- ---------------------------------------------------------------------------
-- Role, account status and coverage assignment live here and are read from
-- the database — never trusted from the client. Users cannot change their own
-- role/status/assignment: a guard trigger blocks self-service changes and the
-- admin-only update policy keeps everything else out.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role public.app_role not null default 'resident',
  status text not null default 'pending_verification'
    check (status in ('pending_verification', 'active', 'disabled')),
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete set null,
  facility_id uuid references public.facilities(id) on delete set null,
  position text not null default '',
  license_no text not null default '',
  contact text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_unique unique (email)
);

create index profiles_municipality_id_idx on public.profiles(municipality_id);
create index profiles_barangay_id_idx on public.profiles(barangay_id);
create index profiles_role_idx on public.profiles(role);

-- Auto-create a pending profile for every new auth user. Staff accounts are
-- provisioned through the admin approval flow, which then sets role/status;
-- resident accounts stay 'pending_verification' until identity review.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'resident',
    'pending_verification'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Block self-service changes to role, status or assignment. Admin and
-- service-role writes (auth.uid() is null) are not restricted.
create or replace function public.guard_profile_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'update' and auth.uid() is not null and auth.uid() = old.id
     and not public.is_admin() then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.municipality_id is distinct from old.municipality_id
       or new.barangay_id is distinct from old.barangay_id
       or new.facility_id is distinct from old.facility_id then
      raise exception
        'profiles: role, status and assignment can only be changed by an administrator';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_own_updates
  before update on public.profiles
  for each row execute function public.guard_profile_updates();

-- ---------------------------------------------------------------------------
-- Role permission matrix (admin-editable)
-- ---------------------------------------------------------------------------
-- Permission ids match frontend/src/lib/permissions.js. Defaults are seeded
-- when the access-control UI migrates from localStorage to the database.

create table public.role_permissions (
  role public.app_role not null,
  permission_id text not null,
  granted boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint role_permissions_pk primary key (role, permission_id)
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance for the new tables
-- ---------------------------------------------------------------------------

create trigger municipalities_set_updated_at before update on public.municipalities
  for each row execute function public.set_updated_at();
create trigger barangays_set_updated_at before update on public.barangays
  for each row execute function public.set_updated_at();
create trigger facilities_set_updated_at before update on public.facilities
  for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger role_permissions_set_updated_at before update on public.role_permissions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helper functions
-- ---------------------------------------------------------------------------
-- All helpers are SECURITY DEFINER (owned by postgres, which bypasses RLS) so
-- policies can read `profiles` without recursion. The Express API talks to the
-- database with the service-role key AFTER its own authenticate + authorize
-- middleware has run; these policies are the boundary for any direct,
-- user-token access.

create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles where id = auth.uid();
$$;

create or replace function public.profile_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.profile_municipality_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select municipality_id from public.profiles where id = auth.uid();
$$;

create or replace function public.profile_barangay_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select barangay_id from public.profiles where id = auth.uid();
$$;

/** Active, non-resident staff account (any clinical/administrative role). */
create or replace function public.is_staff_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and status = 'active'
      and role in ('admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw')
  );
$$;

/** Active administrator. */
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and status = 'active'
      and role = 'admin'
  );
$$;

/**
 * Does the caller's coverage include this barangay?
 *   admin                 -> every barangay (system administration)
 *   mho / phn / rhu       -> every barangay of their own municipality
 *   health_supervisor/bhw -> exactly their assigned barangay
 * Residents and inactive accounts never cover any barangay.
 */
create or replace function public.profile_covers_barangay(target_barangay uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_admin() then true
    when not public.is_staff_active() then false
    when target_barangay is null then false
    when public.profile_role() in ('mho', 'phn', 'rhu_personnel') then
      exists (
        select 1 from public.barangays b
        where b.id = target_barangay
          and b.municipality_id = public.profile_municipality_id()
      )
    when public.profile_role() in ('health_supervisor', 'bhw') then
      target_barangay = public.profile_barangay_id()
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security — registry & account tables
-- ---------------------------------------------------------------------------

alter table public.municipalities enable row level security;
alter table public.barangays enable row level security;
alter table public.facilities enable row level security;
alter table public.profiles enable row level security;
alter table public.role_permissions enable row level security;

-- The registry is public reference data (needed by the public registration
-- pages); only admins and the MHO of the municipality may change it.
create policy municipalities_select on public.municipalities
  for select to anon, authenticated using (true);

create policy municipalities_insert on public.municipalities
  for insert to authenticated with check (public.is_admin());

create policy municipalities_update on public.municipalities
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy municipalities_delete on public.municipalities
  for delete to authenticated using (public.is_admin());

create policy barangays_select on public.barangays
  for select to anon, authenticated using (true);

-- The MHO manages their own municipality's barangays (frontend "Add Barangay").
create policy barangays_insert on public.barangays
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() = 'mho'
      and municipality_id = public.profile_municipality_id()
    )
  );

create policy barangays_update on public.barangays
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() = 'mho'
      and municipality_id = public.profile_municipality_id()
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() = 'mho'
      and municipality_id = public.profile_municipality_id()
    )
  );

create policy barangays_delete on public.barangays
  for delete to authenticated using (public.is_admin());

create policy facilities_select on public.facilities
  for select to anon, authenticated using (true);

create policy facilities_insert on public.facilities
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() = 'mho'
      and municipality_id = public.profile_municipality_id()
    )
  );

create policy facilities_update on public.facilities
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() = 'mho'
      and municipality_id = public.profile_municipality_id()
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() = 'mho'
      and municipality_id = public.profile_municipality_id()
    )
  );

create policy facilities_delete on public.facilities
  for delete to authenticated using (public.is_admin());

-- Profiles: everyone reads their own row (even pending/disabled, so the UI can
-- show the account state). Staff rows are visible within the caller's scope.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
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

-- Profiles are created by the auth trigger / admin flow, never self-inserted.
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy profiles_delete on public.profiles
  for delete to authenticated using (public.is_admin());

-- Permission matrix: readable by any signed-in user (drives the UI), writable
-- only by administrators.
create policy role_permissions_select on public.role_permissions
  for select to authenticated using (true);

create policy role_permissions_insert on public.role_permissions
  for insert to authenticated with check (public.is_admin());

create policy role_permissions_update on public.role_permissions
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy role_permissions_delete on public.role_permissions
  for delete to authenticated using (public.is_admin());

commit;

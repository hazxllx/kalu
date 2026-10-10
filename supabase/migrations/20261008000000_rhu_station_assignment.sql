-- =============================================================================
-- KALUSAGAP — RHU station assignment (Triage / Consultation)
--
-- Adds an RHU STATION assignment that is deliberately SEPARATE from the
-- account's system role (`profiles.role`) and from its barangay assignment
-- (`profiles.barangay_id`):
--
--   User -> System Role -> Personnel Profile -> Barangay (optional)
--                                             -> RHU Station(s) (optional)
--
-- Supported stations: 'triage', 'consultation'. Stored as a text[] (a person
-- may hold both stations on the SAME account — no duplicate account is created
-- for an additional assignment).
--
-- Registration captures the requested station(s) on `staff_account_requests`
-- and the approval flow copies them onto `profiles`. Approval authority is
-- unchanged (PHN approves Health Supervisor / RHU Personnel; Health Supervisor
-- approves BHW) and remains enforced by `public.can_approve_staff_role()`.
--
-- A facility may have MANY active RHU personnel and MANY per station (several
-- Triage personnel and several Consultation personnel at the same RHU), so the
-- previous "one active RHU per facility" uniqueness rule is DROPPED outright and
-- NOT replaced with any per-station uniqueness. Station assignment is an
-- attribute of the individual personnel account, never a facility-wide lock.
--
-- Additive + idempotent: existing rows keep an empty station list and remain
-- readable; they can be assigned a station by an administrator.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- profiles.rhu_stations
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists rhu_stations text[] not null default '{}'::text[];

-- Only the supported station ids are allowed in the array.
alter table public.profiles
  drop constraint if exists profiles_rhu_stations_valid;
alter table public.profiles
  add constraint profiles_rhu_stations_valid
  check (rhu_stations <@ array['triage', 'consultation']::text[]);

comment on column public.profiles.rhu_stations is
  'RHU station assignment(s): triage and/or consultation. Separate from role and barangay assignment; multiple stations are allowed on one account.';

-- ---------------------------------------------------------------------------
-- staff_account_requests.rhu_stations
-- ---------------------------------------------------------------------------
alter table public.staff_account_requests
  add column if not exists rhu_stations text[] not null default '{}'::text[];

alter table public.staff_account_requests
  drop constraint if exists staff_account_requests_rhu_stations_valid;
alter table public.staff_account_requests
  add constraint staff_account_requests_rhu_stations_valid
  check (rhu_stations <@ array['triage', 'consultation']::text[]);

comment on column public.staff_account_requests.rhu_stations is
  'Requested RHU station assignment(s) captured at registration and copied to the profile on approval.';

-- ---------------------------------------------------------------------------
-- Self-service guard: an account may never change its own station assignment
-- ---------------------------------------------------------------------------
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
       or new.facility_id is distinct from old.facility_id
       or new.rhu_stations is distinct from old.rhu_stations then
      raise exception
        'profiles: role, status, assignment and RHU station can only be changed by an administrator';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS helper: the caller's own RHU stations
-- ---------------------------------------------------------------------------
create or replace function public.profile_rhu_stations()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(rhu_stations, '{}'::text[]) from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Remove the facility-wide RHU uniqueness entirely.
--
-- The system must allow MANY active RHU personnel at the same facility and MANY
-- per station (e.g. Juan + Maria both active on Triage at RHU A, Pedro + Ana
-- both active on Consultation). The old `one_active_rhu_per_facility` partial
-- unique index is therefore dropped and intentionally NOT replaced. Station
-- access is enforced per account via `profiles.rhu_stations`, not by a
-- database-level facility lock.
-- ---------------------------------------------------------------------------
drop index if exists public.one_active_rhu_per_facility;

-- Defensive: drop any earlier per-station uniqueness that a prior draft of this
-- migration may have created, so re-running converges on "no uniqueness".
drop index if exists public.one_active_rhu_triage_per_facility;
drop index if exists public.one_active_rhu_consultation_per_facility;

commit;

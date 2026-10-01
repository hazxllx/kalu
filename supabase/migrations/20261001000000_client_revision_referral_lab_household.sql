-- KALUSAGAP — Client Revision: Laboratory Test in Referrals, Household Coordinates
--
-- This migration addresses the following client requirements:
--
-- 1. REFERRAL: Add optional laboratory test fields to health_referrals
--    Client: "Resident laboratory test may add if necessary. so, add field for this."
--    - laboratory_test_required: boolean (Yes/No)
--    - laboratory_test: text (description of required tests)
--    - additional_instructions: text (optional instructions)
--    Fields are OPTIONAL - no existing referral data is affected.
--
-- 2. HOUSEHOLD: Add coordinates to households for map pinpointing
--    Client: "if actual location could be pinpoint for those active cases"
--    - latitude: numeric for household location
--    - longitude: numeric for household location
--    - Falls back to barangay coordinates if household coordinates unavailable
--    - No coordinates are fabricated - null when unavailable
--
-- 3. CONSTRAINT: One active RHU personnel per facility
--    Client: "There should be ONE RHU account/personnel assignment per RHU station"
--    - Add unique constraint on profiles(facility_id) for active rhu_personnel
--    - Enforced at database level to prevent multiple active RHU per station

begin;

-- =============================================================================
-- 1. REFERRAL: Add laboratory test fields
-- =============================================================================

alter table public.health_referrals
  add column if not exists laboratory_test_required boolean default false,
  add column if not exists laboratory_test text,
  add column if not exists additional_instructions text;

comment on column public.health_referrals.laboratory_test_required is
  'Whether a laboratory test is required for this referral. Yes/No.';
comment on column public.health_referrals.laboratory_test is
  'Description of the laboratory test(s) requested.';
comment on column public.health_referrals.additional_instructions is
  'Additional instructions for the referral recipient.';

-- =============================================================================
-- 2. HOUSEHOLD: Add coordinates for map pinpointing
-- =============================================================================

alter table public.households
  add column if not exists latitude numeric(10, 7),
  add column if not exists longitude numeric(10, 7);

comment on column public.households.latitude is
  'Household GPS latitude. Used for map pinpointing of active cases. NULL if unavailable.';
comment on column public.households.longitude is
  'Household GPS longitude. Used for map pinpointing of active cases. NULL if unavailable.';

-- Add check constraints for valid coordinates
alter table public.households
  drop constraint if exists households_latitude_range;
alter table public.households
  add constraint households_latitude_range
  check (latitude is null or (latitude >= -90 and latitude <= 90));

alter table public.households
  drop constraint if exists households_longitude_range;
alter table public.households
  add constraint households_longitude_range
  check (longitude is null or (longitude >= -180 and longitude <= 180));

-- =============================================================================
-- 3. RHU PERSONNEL: Ensure one active RHU personnel per facility
-- =============================================================================

-- First, check if there are any duplicate active RHU personnel per facility
-- If so, keep only the most recently updated one
with duplicates as (
  select facility_id
  from public.profiles
  where role = 'rhu_personnel'
    and status = 'active'
    and facility_id is not null
  group by facility_id
  having count(*) > 1
)
update public.profiles p
set status = 'disabled'
from duplicates d
where p.facility_id = d.facility_id
  and p.role = 'rhu_personnel'
  and p.status = 'active'
  and p.updated_at < (
    select max(p2.updated_at)
    from public.profiles p2
    where p2.facility_id = d.facility_id
      and p2.role = 'rhu_personnel'
      and p2.status = 'active'
  );

-- Add unique constraint: only one active rhu_personnel per facility.
-- PostgreSQL expresses a filtered uniqueness rule as a PARTIAL UNIQUE INDEX
-- (a table UNIQUE constraint cannot carry a WHERE clause). This guarantees at
-- the database level that a facility can have at most one active RHU personnel.
drop index if exists one_active_rhu_per_facility;
create unique index one_active_rhu_per_facility
  on public.profiles (facility_id)
  where (role = 'rhu_personnel' and status = 'active' and facility_id is not null);

-- =============================================================================
-- 4. UPDATE RLS POLICIES for new fields
-- =============================================================================

-- Ensure RLS policies cover the new health_referrals columns
-- The existing policies use security_barrier views which should already include these

-- =============================================================================
-- 5. FUNCTION: Get the assigned RHU personnel for a facility
-- =============================================================================

create or replace function public.get_facility_rhu_personnel(p_facility_id uuid)
returns table (
  id uuid,
  full_name text,
  email text,
  -- `position` is a PostgreSQL keyword and cannot be used as a RETURNS TABLE
  -- column identifier (SQLSTATE 42601). The underlying profiles.position column
  -- keeps its real name; only the returned alias is renamed. Application callers
  -- that expect a `position` property should map job_position -> position.
  job_position text,
  facility_id uuid,
  facility_name text
)
security definer
as $$
begin
  return query
  select
    p.id,
    p.full_name,
    p.email,
    p.position as job_position,
    p.facility_id,
    f.name as facility_name
  from public.profiles p
  left join public.facilities f on f.id = p.facility_id
  where p.facility_id = p_facility_id
    and p.role = 'rhu_personnel'
    and p.status = 'active'
  limit 1;
end;
$$ language plpgsql;

comment on function public.get_facility_rhu_personnel(uuid) is
  'Returns the active RHU personnel assigned to a facility. Used to identify the attending personnel in consultations.';

-- =============================================================================
-- 6. FUNCTION: Get RHU personnel for consultation display
-- =============================================================================

create or replace function public.get_consultation_attending_personnel(
  p_facility_id uuid,
  p_recorded_by_id uuid
)
returns jsonb
security definer
as $$
declare
  v_personnel jsonb;
begin
  -- First try to get the RHU personnel assigned to the facility
  select jsonb_build_object(
    'id', p.id,
    'fullName', p.full_name,
    'email', p.email,
    'position', p.position,
    'facilityId', p.facility_id,
    'facilityName', f.name,
    'type', 'assigned_rhu'
  )
  into v_personnel
  from public.profiles p
  left join public.facilities f on f.id = p.facility_id
  where p.facility_id = p_facility_id
    and p.role = 'rhu_personnel'
    and p.status = 'active'
  limit 1;

  -- If no assigned RHU, use the recorded_by profile
  if v_personnel is null then
    select jsonb_build_object(
      'id', p.id,
      'fullName', p.full_name,
      'email', p.email,
      'position', p.position,
      'facilityId', p.facility_id,
      'facilityName', f.name,
      'type', 'recording_personnel'
    )
    into v_personnel
    from public.profiles p
    left join public.facilities f on f.id = p.facility_id
    where p.id = p_recorded_by_id
    limit 1;
  end if;

  return v_personnel;
end;
$$ language plpgsql;

comment on function public.get_consultation_attending_personnel(uuid, uuid) is
  'Returns the attending personnel for a consultation: first the assigned RHU personnel for the facility, or fallback to the recording personnel.';

commit;
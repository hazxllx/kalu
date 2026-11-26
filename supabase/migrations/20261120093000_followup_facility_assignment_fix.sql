-- supabase/migrations/20261120093000_followup_facility_assignment_fix.sql
-- Ensure every operational follow-up can route resident schedule requests to
-- the creator's registered facility, or the registered BHS for the resident's
-- barangay when the creator has no facility assignment.
begin;

update public.follow_ups f
set facility_id = coalesce(
  p.facility_id,
  (
    select bhs.id
    from public.residents r
    join public.facilities bhs
      on bhs.type = 'barangay_health_station'
     and bhs.barangay_id = r.barangay_id
     and bhs.municipality_id = r.municipality_id
    where r.id = f.resident_id
    order by bhs.created_at, bhs.id
    limit 1
  )
)
from public.profiles p
where f.facility_id is null
  and f.created_by = p.id;

create or replace function public.follow_up_registered_facility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare resident_barangay uuid; resident_municipality uuid;
begin
  if new.facility_id is not null then return new; end if;

  if new.created_by is not null then
    select facility_id into new.facility_id
    from public.profiles
    where id = new.created_by;
  end if;

  if new.facility_id is null then
    select barangay_id, municipality_id
      into resident_barangay, resident_municipality
    from public.residents
    where id = new.resident_id;

    select id into new.facility_id
    from public.facilities
    where type = 'barangay_health_station'
      and barangay_id = resident_barangay
      and municipality_id = resident_municipality
    order by created_at, id
    limit 1;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
commit;

-- Persist RHU triage facility context from the authenticated staff assignment.

begin;

alter table public.visits
  add column if not exists facility_id uuid references public.facilities(id) on delete set null;

create index if not exists visits_facility_id_idx on public.visits(facility_id);

create or replace function public.profile_facility_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select facility_id from public.profiles where id = auth.uid();
$$;

drop policy if exists visits_insert on public.visits;
create policy visits_insert on public.visits
  for insert to authenticated
  with check (
    public.is_staff_active()
    and public.profile_role() in ('bhw', 'rhu_personnel', 'health_supervisor', 'phn')
    and public.profile_covers_barangay(barangay_id)
    and (
      facility_id is null
      or facility_id = public.profile_facility_id()
      or (
        public.profile_role() = 'health_supervisor'
        and exists (
          select 1
          from public.facilities f
          where f.id = visits.facility_id
            and f.type = 'barangay_health_station'
            and f.barangay_id = public.profile_barangay_id()
            and f.municipality_id = public.profile_municipality_id()
        )
      )
    )
    and (
      public.profile_role() <> 'rhu_personnel'
      or (facility_id is not null and facility_id = public.profile_facility_id())
    )
  );

create or replace function public.guard_visit_facility_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not public.is_admin()
     and new.facility_id is distinct from old.facility_id then
    raise exception 'visits: facility assignment cannot be changed by staff';
  end if;
  return new;
end;
$$;

drop trigger if exists visits_guard_facility_update on public.visits;
create trigger visits_guard_facility_update
  before update on public.visits
  for each row execute function public.guard_visit_facility_update();

commit;
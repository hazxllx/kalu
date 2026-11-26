-- supabase/migrations/20261121220000_health_supervisor_calendar_activities.sql
begin;

create table public.calendar_activities (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  title varchar(120) not null check (length(btrim(title)) > 0),
  activity_type text not null check (activity_type in (
    'Reminder', 'Follow-up', 'Meeting', 'Field Visit', 'Health Activity', 'Other'
  )),
  activity_date date not null,
  activity_time time,
  notes text check (notes is null or length(notes) <= 2000),
  resident_id text references public.residents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calendar_activities_owner_date_idx
  on public.calendar_activities (created_by, activity_date, activity_time);

create trigger calendar_activities_updated
  before update on public.calendar_activities
  for each row execute function public.set_updated_at();

alter table public.calendar_activities enable row level security;
revoke all on public.calendar_activities from public, anon;
grant select, insert, update, delete on public.calendar_activities to authenticated;

create policy calendar_activities_select_own
  on public.calendar_activities for select to authenticated
  using (
    public.personnel_session_is_usable()
    and public.profile_role() = 'health_supervisor'
    and created_by = auth.uid()
    and exists (
      select 1 from public.barangays b
      where b.id = public.profile_barangay_id()
        and b.municipality_id = public.profile_municipality_id()
        and b.status = 'Active'
    )
  );

create policy calendar_activities_insert_own
  on public.calendar_activities for insert to authenticated
  with check (
    public.personnel_session_is_usable()
    and public.profile_role() = 'health_supervisor'
    and created_by = auth.uid()
    and exists (
      select 1 from public.barangays b
      where b.id = public.profile_barangay_id()
        and b.municipality_id = public.profile_municipality_id()
        and b.status = 'Active'
    )
    and (
      resident_id is null
      or exists (
        select 1 from public.residents r
        where r.id = calendar_activities.resident_id
          and r.barangay_id = public.profile_barangay_id()
          and r.municipality_id = public.profile_municipality_id()
      )
    )
  );

create policy calendar_activities_update_own
  on public.calendar_activities for update to authenticated
  using (
    public.personnel_session_is_usable()
    and public.profile_role() = 'health_supervisor'
    and created_by = auth.uid()
    and exists (
      select 1 from public.barangays b
      where b.id = public.profile_barangay_id()
        and b.municipality_id = public.profile_municipality_id()
        and b.status = 'Active'
    )
  )
  with check (
    public.personnel_session_is_usable()
    and public.profile_role() = 'health_supervisor'
    and created_by = auth.uid()
    and (
      resident_id is null
      or exists (
        select 1 from public.residents r
        where r.id = calendar_activities.resident_id
          and r.barangay_id = public.profile_barangay_id()
          and r.municipality_id = public.profile_municipality_id()
      )
    )
  );

create policy calendar_activities_delete_own
  on public.calendar_activities for delete to authenticated
  using (
    public.personnel_session_is_usable()
    and public.profile_role() = 'health_supervisor'
    and created_by = auth.uid()
    and exists (
      select 1 from public.barangays b
      where b.id = public.profile_barangay_id()
        and b.municipality_id = public.profile_municipality_id()
        and b.status = 'Active'
    )
  );

notify pgrst, 'reload schema';
commit;

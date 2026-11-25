begin;

-- Persist an explicit PHN decision before an RHU Consultation station can see
-- an encounter. The encounter's overall PHN status remains independent.
alter table public.visits
  add column if not exists consultation_routed_at timestamptz,
  add column if not exists consultation_routed_by uuid references public.profiles(id) on delete set null,
  add column if not exists consultation_routed_facility_id uuid references public.facilities(id) on delete restrict,
  add column if not exists consultation_started_at timestamptz,
  add column if not exists consultation_started_by uuid references public.profiles(id) on delete set null;

alter table public.visits drop constraint if exists visits_consultation_route_consistency;
alter table public.visits add constraint visits_consultation_route_consistency check (
  (consultation_routed_at is null and consultation_routed_by is null and consultation_routed_facility_id is null)
  or
  (consultation_routed_at is not null and consultation_routed_by is not null and consultation_routed_facility_id is not null)
);
create index if not exists visits_consultation_station_queue_idx
  on public.visits (consultation_routed_facility_id, consultation_started_at, status, submitted_at)
  where consultation_routed_at is not null;

-- Keep missed attendance distinct from actual service delivery. Historical
-- duplicate rows remain in place; one row per service/resident/date is marked
-- as the current record so new operations can be safely serialized.
alter table public.health_service_attendance
  add column if not exists is_current_record boolean not null default true,
  add column if not exists service_provided_date date,
  add column if not exists service_completed_at timestamptz,
  add column if not exists correction_reason text not null default '';

with ranked as (
  select id, row_number() over (
    partition by service_id, resident_id, scheduled_date
    order by updated_at desc, created_at desc, id desc
  ) as position
  from public.health_service_attendance
)
update public.health_service_attendance a
set is_current_record = (ranked.position = 1)
from ranked
where ranked.id = a.id and a.is_current_record is distinct from (ranked.position = 1);

create unique index if not exists health_service_attendance_current_schedule_unique
  on public.health_service_attendance (service_id, resident_id, scheduled_date)
  where is_current_record;

alter table public.health_service_attendance
  drop constraint if exists health_service_attendance_attendance_status_check;
alter table public.health_service_attendance
  add constraint health_service_attendance_attendance_status_check
  check (attendance_status in ('scheduled', 'attended', 'absent', 'missed', 'cancelled', 'rescheduled', 'walk_in'));

create table if not exists public.health_service_attendance_history (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.health_service_attendance(id) on delete cascade,
  service_id uuid not null references public.health_services(id) on delete cascade,
  resident_id text not null references public.residents(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'updated')),
  previous_status text,
  new_status text not null,
  previous_record jsonb,
  current_record jsonb not null,
  correction_reason text not null default '',
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null default '',
  recorded_at timestamptz not null default now()
);
create index if not exists health_service_attendance_history_record_idx
  on public.health_service_attendance_history (attendance_id, recorded_at desc);
alter table public.health_service_attendance_history enable row level security;
revoke all on public.health_service_attendance_history from public, anon, authenticated;
grant select, insert on public.health_service_attendance_history to service_role;

create or replace function public.log_health_service_attendance_history()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  changed_actor uuid;
  changed_name text;
begin
  changed_actor := coalesce(new.provided_by, new.recorded_by, auth.uid());
  changed_name := coalesce(nullif(new.provided_by_name, ''), nullif(new.recorded_by_name, ''), 'System scheduler');
  if tg_op = 'INSERT' then
    insert into public.health_service_attendance_history(
      attendance_id, service_id, resident_id, event_type, new_status,
      current_record, correction_reason, actor_id, actor_name
    ) values (
      new.id, new.service_id, new.resident_id, 'created', new.attendance_status,
      to_jsonb(new), new.correction_reason, changed_actor, changed_name
    );
    return new;
  end if;

  if row(new.attendance_status, new.attended_at, new.service_provided_date,
         new.service_completed_at, new.service_provided, new.assessment,
         new.recommendations, new.follow_up_required, new.follow_up_date, new.notes)
     is distinct from
     row(old.attendance_status, old.attended_at, old.service_provided_date,
         old.service_completed_at, old.service_provided, old.assessment,
         old.recommendations, old.follow_up_required, old.follow_up_date, old.notes) then
    insert into public.health_service_attendance_history(
      attendance_id, service_id, resident_id, event_type, previous_status,
      new_status, previous_record, current_record, correction_reason,
      actor_id, actor_name
    ) values (
      new.id, new.service_id, new.resident_id, 'updated', old.attendance_status,
      new.attendance_status, to_jsonb(old), to_jsonb(new), new.correction_reason,
      changed_actor, changed_name
    );
  end if;
  return new;
end;
$$;

drop trigger if exists health_service_attendance_history_log on public.health_service_attendance;
create trigger health_service_attendance_history_log
  after insert or update on public.health_service_attendance
  for each row execute function public.log_health_service_attendance_history();
revoke all on function public.log_health_service_attendance_history() from public, anon, authenticated, service_role;

-- Serialize staff recording and the scheduled missed sweep on a shared key.
-- The unique partial index retains a single current record without deleting old
-- duplicate rows from earlier versions of the app.
create or replace function public.upsert_health_service_attendance(p_payload jsonb)
returns public.health_service_attendance
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  current_row public.health_service_attendance%rowtype;
  target_row public.health_service_attendance%rowtype;
  service_key uuid;
  resident_key text;
  date_key date;
begin
  if auth.role() is not null and auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service attendance must be written through the authorized service.';
  end if;
  service_key := nullif(p_payload ->> 'service_id', '')::uuid;
  resident_key := nullif(p_payload ->> 'resident_id', '');
  date_key := nullif(p_payload ->> 'scheduled_date', '')::date;
  if service_key is null or resident_key is null or date_key is null then
    raise exception using errcode = '22023', message = 'A service, resident, and scheduled date are required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(service_key::text || ':' || resident_key || ':' || date_key::text, 0));
  select * into current_row
  from public.health_service_attendance
  where service_id = service_key and resident_id = resident_key
    and scheduled_date = date_key and is_current_record
  for update;

  if found then
    select * into target_row from jsonb_populate_record(current_row, p_payload);
    update public.health_service_attendance set
      attendance_status = target_row.attendance_status,
      attended_at = target_row.attended_at,
      recorded_by = target_row.recorded_by,
      recorded_by_name = target_row.recorded_by_name,
      notes = target_row.notes,
      service_provided = target_row.service_provided,
      assessment = target_row.assessment,
      recommendations = target_row.recommendations,
      follow_up_required = target_row.follow_up_required,
      follow_up_date = target_row.follow_up_date,
      provided_by = target_row.provided_by,
      provided_by_name = target_row.provided_by_name,
      service_provided_date = target_row.service_provided_date,
      service_completed_at = target_row.service_completed_at,
      correction_reason = target_row.correction_reason
    where id = current_row.id
    returning * into target_row;
  else
    select * into target_row from jsonb_populate_record(null::public.health_service_attendance, p_payload);
    insert into public.health_service_attendance(
      service_id, resident_id, scheduled_date, attendance_status, attended_at,
      recorded_by, recorded_by_name, notes, service_provided, assessment,
      recommendations, follow_up_required, follow_up_date, provided_by,
      provided_by_name, service_provided_date, service_completed_at,
      correction_reason, is_current_record
    ) values (
      service_key, resident_key, date_key, coalesce(target_row.attendance_status, 'scheduled'),
      target_row.attended_at, target_row.recorded_by, coalesce(target_row.recorded_by_name, ''),
      coalesce(target_row.notes, ''), coalesce(target_row.service_provided, ''),
      coalesce(target_row.assessment, ''), coalesce(target_row.recommendations, ''),
      coalesce(target_row.follow_up_required, false), target_row.follow_up_date,
      target_row.provided_by, coalesce(target_row.provided_by_name, ''),
      target_row.service_provided_date, target_row.service_completed_at,
      coalesce(target_row.correction_reason, ''), true
    ) returning * into target_row;
  end if;
  return target_row;
end;
$$;
revoke all on function public.upsert_health_service_attendance(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_health_service_attendance(jsonb) to service_role;

-- Server-side schedule. Visit plans have no individually booked time, so use
-- the service's daily end time on the planned date; legacy programs without a
-- time close at the end of the configured program date. Approved appointments
-- use their actual confirmed date/time and configured slot duration.
create or replace function public.mark_expired_health_service_attendance(p_now timestamptz default now())
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  plan_row record;
  plans_marked integer := 0;
  appointments_marked integer := 0;
  current_row public.health_service_attendance%rowtype;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('health-service-missed-sweep', 0)) then
    return jsonb_build_object('skipped', true, 'plansMarked', 0, 'appointmentsMarked', 0);
  end if;

  for plan_row in
    select p.service_id, p.resident_id, p.planned_date, p.barangay_id,
      s.end_date, s.end_time
    from public.visit_plans p
    join public.health_services s on s.id = p.service_id
    where p.status = 'Planned'
      and (p.planned_date + coalesce(s.end_time, time '23:59:59')) at time zone 'Asia/Manila' <= p_now
      and (s.start_date is null or p.planned_date >= s.start_date)
      and (s.end_date is null or p.planned_date <= s.end_date)
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      plan_row.service_id::text || ':' || plan_row.resident_id || ':' || plan_row.planned_date::text, 0));
    select * into current_row from public.health_service_attendance
      where service_id = plan_row.service_id and resident_id = plan_row.resident_id
        and scheduled_date = plan_row.planned_date and is_current_record for update;
    if not found then
      insert into public.health_service_attendance(
        service_id, resident_id, scheduled_date, attendance_status, notes,
        recorded_by_name, is_current_record
      ) values (
        plan_row.service_id, plan_row.resident_id, plan_row.planned_date,
        'missed', 'Automatically marked missed after the scheduled service window ended.',
        'System scheduler', true
      ) on conflict (service_id, resident_id, scheduled_date) where is_current_record do nothing;
      if found then plans_marked := plans_marked + 1; end if;
    elsif current_row.attendance_status = 'scheduled' then
      update public.health_service_attendance set attendance_status = 'missed',
        notes = case when notes = '' then 'Automatically marked missed after the scheduled service window ended.' else notes end,
        recorded_by_name = coalesce(nullif(recorded_by_name, ''), 'System scheduler')
      where id = current_row.id;
      plans_marked := plans_marked + 1;
    end if;
  end loop;

  update public.appointments a set status = 'missed',
    decision_reason = case when nullif(btrim(a.decision_reason), '') is null
      then 'Automatically marked missed after the confirmed appointment window ended.' else a.decision_reason end,
    decided_at = p_now
  where a.status = 'approved'
    and p_now >= (
      (coalesce(a.confirmed_date, a.requested_date)
      + coalesce(a.confirmed_time, a.requested_time)
      + make_interval(mins => coalesce((
        select min(s.slot_minutes)
        from public.appointment_schedules s
        where s.service_id = a.service_id
          and s.weekday = extract(dow from coalesce(a.confirmed_date, a.requested_date))::smallint
          and coalesce(a.confirmed_time, a.requested_time) >= s.start_time
          and coalesce(a.confirmed_time, a.requested_time) < s.end_time
          and (s.barangay_id is null or s.barangay_id = a.barangay_id)
      ), 30))) at time zone 'Asia/Manila'
    );
  get diagnostics appointments_marked = row_count;
  return jsonb_build_object('skipped', false, 'plansMarked', plans_marked,
    'appointmentsMarked', appointments_marked, 'evaluatedAt', p_now);
end;
$$;
revoke all on function public.mark_expired_health_service_attendance(timestamptz) from public, anon, authenticated;
grant execute on function public.mark_expired_health_service_attendance(timestamptz) to service_role;

do $$
declare existing_job bigint;
begin
  if not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is unavailable; automatic attendance scheduling was not installed.';
    return;
  end if;

  execute 'create extension if not exists pg_cron with schema pg_catalog';
  execute 'select jobid from cron.job where jobname = $1'
    into existing_job using 'mark-expired-health-service-attendance';
  if existing_job is not null then
    execute 'select cron.unschedule($1)' using existing_job;
  end if;
  execute 'select cron.schedule($1, $2, $3)'
    using 'mark-expired-health-service-attendance', '* * * * *',
      'select public.mark_expired_health_service_attendance();';
end;
$$;

notify pgrst, 'reload schema';
commit;

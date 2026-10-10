-- =============================================================================
-- KALUSAGAP — Resident appointment booking for barangay health services
--
-- Additive only. No existing table is modified, dropped or rewritten.
--
-- WHY NEW TABLES: an exhaustive search of the migration history shows:
--   * public.health_services        — the service CATALOG (reused here as the
--                                      bookable service, never duplicated).
--   * public.health_service_attendance — a staff-logged ATTENDANCE record
--                                      (scheduled/attended/absent/...). It has no
--                                      resident-request lifecycle, no slot
--                                      capacity, no reschedule-proposal workflow
--                                      and no availability configuration.
--   * public.follow_ups             — a staff-generated monitoring event with a
--                                      resident confirm/reject step (a distinct
--                                      concept, preserved untouched).
-- None of these model a RESIDENT-REQUESTED appointment with a Pending ->
-- Approved / Reschedule Proposed / Declined / Cancelled / Completed / Missed
-- lifecycle, backend slot-capacity enforcement and concurrency-safe booking.
-- This migration adds exactly that, referencing the existing health_services,
-- barangays, municipalities, residents and profiles rows (never copying them).
--
-- Scope follows the established rules (config/scope.js + profile_* helpers):
--   * a service belongs to a municipality (+ optional barangay);
--   * barangay-scoped staff (health_supervisor / bhw) manage appointments in
--     their OWN barangay; municipality-wide roles (mho / phn) see their
--     municipality; a resident only ever sees their own appointments.
-- Writes are performed by the service-role backend (role/scope enforced in
-- code); no user-token insert/update policy is granted — mirroring the
-- health_services / follow_ups approach, where the API is the sole write path.
-- =============================================================================

begin;

-- A counter for human-readable appointment references (APT-00001, ...).
insert into public.record_counters (name, value)
values ('appointments', 0)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Service availability configuration (operating days / hours / slots)
-- ---------------------------------------------------------------------------
create table if not exists public.appointment_schedules (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.health_services(id) on delete cascade,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  -- A schedule may be scoped to a specific barangay. NULL means it applies to
  -- the service's own barangay / municipality-wide service.
  barangay_id uuid references public.barangays(id) on delete set null,
  -- 0 = Sunday .. 6 = Saturday (matches Postgres extract(dow ...)).
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  -- Appointment duration / slot interval, in minutes.
  slot_minutes integer not null default 30 check (slot_minutes between 5 and 480),
  -- Maximum appointments bookable per generated time slot.
  capacity_per_slot integer not null default 1 check (capacity_per_slot between 1 and 100),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_schedules_time_order check (end_time > start_time)
);

comment on table public.appointment_schedules is
  'Bookable availability for a health service: operating weekday, hours, slot interval and per-slot capacity. Scoped by municipality/barangay.';

create index if not exists appointment_schedules_service_idx
  on public.appointment_schedules (service_id, weekday, active);
create index if not exists appointment_schedules_scope_idx
  on public.appointment_schedules (barangay_id, active);

-- ---------------------------------------------------------------------------
-- 2. Unavailable dates / temporary closures
-- ---------------------------------------------------------------------------
create table if not exists public.appointment_blackouts (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.health_services(id) on delete cascade,
  barangay_id uuid references public.barangays(id) on delete set null,
  blackout_date date not null,
  reason text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (service_id, barangay_id, blackout_date)
);

comment on table public.appointment_blackouts is
  'Dates on which a health service is unavailable for booking (closures/holidays).';

create index if not exists appointment_blackouts_lookup_idx
  on public.appointment_blackouts (service_id, blackout_date);

-- ---------------------------------------------------------------------------
-- 3. Appointment lifecycle
-- ---------------------------------------------------------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  resident_id text not null references public.residents(id) on delete cascade,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete restrict,
  service_id uuid not null references public.health_services(id) on delete restrict,
  -- What the resident asked for.
  requested_date date not null,
  requested_time time not null,
  -- The confirmed schedule once approved (kept distinct from the request).
  confirmed_date date,
  confirmed_time time,
  -- A staff-proposed alternative awaiting the resident's response.
  proposed_date date,
  proposed_time time,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'reschedule_proposed', 'declined', 'cancelled', 'completed', 'missed')),
  -- Optional resident-entered reason for the visit (non-clinical).
  reason text not null default '',
  -- Decline / cancellation / reschedule note recorded by the actor.
  decision_reason text not null default '',
  -- The staff profile responsible for the latest decision.
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.appointments is
  'Resident-requested barangay health-service appointments. Requested schedule is stored separately from the confirmed schedule; status transitions are enforced by the API.';

create index if not exists appointments_barangay_status_idx
  on public.appointments (barangay_id, status, requested_date);
create index if not exists appointments_resident_idx
  on public.appointments (resident_id, requested_date desc);
create index if not exists appointments_service_date_idx
  on public.appointments (service_id, requested_date);

create trigger appointment_schedules_updated
  before update on public.appointment_schedules
  for each row execute function public.set_updated_at();

create trigger appointments_updated
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Concurrency-safe booking RPC
--
-- Residents book through this function (invoked by the service-role backend
-- after it has resolved the caller's OWN resident record from the session).
-- A per-slot transaction advisory lock + a capacity re-count inside the same
-- transaction guarantee that simultaneous requests cannot overbook a slot,
-- regardless of the JS-level pre-check. Scope (service active + in the
-- resident's barangay/municipality), availability (a matching active schedule),
-- blackout dates and duplicate active requests are all re-validated here so the
-- database is authoritative even if a caller bypasses the service layer.
-- ---------------------------------------------------------------------------
create or replace function public.book_resident_appointment(
  p_resident_id text,
  p_service_id uuid,
  p_requested_date date,
  p_requested_time time,
  p_reason text default ''
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resident public.residents%rowtype;
  v_service public.health_services%rowtype;
  v_weekday smallint;
  v_capacity integer;
  v_taken integer;
  v_reference text;
  v_row public.appointments%rowtype;
begin
  select * into v_resident from public.residents where id = p_resident_id;
  if not found then raise exception 'RESIDENT_NOT_FOUND'; end if;

  select * into v_service from public.health_services where id = p_service_id;
  if not found or v_service.active is not true then raise exception 'SERVICE_UNAVAILABLE'; end if;

  -- The service must be offered to the resident's barangay / municipality.
  if v_service.municipality_id is not null and v_resident.municipality_id is not null
     and v_service.municipality_id <> v_resident.municipality_id then
    raise exception 'SERVICE_OUT_OF_SCOPE';
  end if;
  if v_service.barangay_id is not null and v_service.barangay_id <> v_resident.barangay_id then
    raise exception 'SERVICE_OUT_OF_SCOPE';
  end if;

  if p_requested_date < current_date then raise exception 'DATE_IN_PAST'; end if;

  v_weekday := extract(dow from p_requested_date)::smallint;

  -- Capacity for this slot comes from a matching active schedule row whose
  -- window covers the requested time.
  select coalesce(max(capacity_per_slot), 0) into v_capacity
  from public.appointment_schedules
  where service_id = p_service_id
    and active
    and weekday = v_weekday
    and (barangay_id is null or barangay_id = v_resident.barangay_id)
    and start_time <= p_requested_time
    and end_time > p_requested_time;
  if v_capacity <= 0 then raise exception 'SLOT_UNAVAILABLE'; end if;

  if exists (
    select 1 from public.appointment_blackouts
    where service_id = p_service_id
      and blackout_date = p_requested_date
      and (barangay_id is null or barangay_id = v_resident.barangay_id)
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  -- Serialize concurrent bookings for the exact same slot.
  perform pg_advisory_xact_lock(
    hashtextextended(p_service_id::text || ':' || p_requested_date::text || ':' || p_requested_time::text, 0)
  );

  -- A slot is consumed by any still-active appointment on that effective slot
  -- (confirmed schedule when present, else the requested schedule).
  select count(*) into v_taken
  from public.appointments
  where service_id = p_service_id
    and status in ('pending', 'approved', 'reschedule_proposed')
    and coalesce(confirmed_date, requested_date) = p_requested_date
    and coalesce(confirmed_time, requested_time) = p_requested_time;
  if v_taken >= v_capacity then raise exception 'SLOT_FULL'; end if;

  -- One active request per resident per service+slot.
  if exists (
    select 1 from public.appointments
    where resident_id = p_resident_id
      and service_id = p_service_id
      and status in ('pending', 'approved', 'reschedule_proposed')
      and requested_date = p_requested_date
      and requested_time = p_requested_time
  ) then
    raise exception 'DUPLICATE_APPOINTMENT';
  end if;

  v_reference := 'APT-' || lpad(public.increment_counter('appointments')::text, 5, '0');

  insert into public.appointments (
    reference, resident_id, municipality_id, barangay_id, service_id,
    requested_date, requested_time, status, reason
  ) values (
    v_reference, p_resident_id, v_resident.municipality_id, v_resident.barangay_id, p_service_id,
    p_requested_date, p_requested_time, 'pending', coalesce(nullif(btrim(p_reason), ''), '')
  ) returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.book_resident_appointment(text, uuid, date, time, text) from public, anon, authenticated;
grant execute on function public.book_resident_appointment(text, uuid, date, time, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Row Level Security
--
-- SELECT only (writes go through the service-role backend, which re-enforces
-- role + barangay/municipality scope in code — mirroring health_services and
-- follow_ups). A resident sees only their own appointments; staff see their
-- scope; admin sees all. Availability tables are staff-readable only (residents
-- never query them directly — the API computes availability for them).
-- ---------------------------------------------------------------------------
alter table public.appointments enable row level security;

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() in ('health_supervisor', 'bhw') and barangay_id = public.profile_barangay_id())
      )
    )
    or exists (
      select 1 from public.residents r
      where r.id = appointments.resident_id and r.auth_user_id = auth.uid()
    )
  );

alter table public.appointment_schedules enable row level security;

drop policy if exists appointment_schedules_select on public.appointment_schedules;
create policy appointment_schedules_select on public.appointment_schedules
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() in ('health_supervisor', 'bhw') and (barangay_id is null or barangay_id = public.profile_barangay_id()))
      )
    )
  );

alter table public.appointment_blackouts enable row level security;

drop policy if exists appointment_blackouts_select on public.appointment_blackouts;
create policy appointment_blackouts_select on public.appointment_blackouts
  for select to authenticated
  using (
    public.is_admin()
    or public.is_staff_active()
  );

commit;

-- rollback;
--   drop function if exists public.book_resident_appointment(text, uuid, date, time, text);
--   drop table if exists public.appointments;
--   drop table if exists public.appointment_blackouts;
--   drop table if exists public.appointment_schedules;
--   delete from public.record_counters where name = 'appointments';

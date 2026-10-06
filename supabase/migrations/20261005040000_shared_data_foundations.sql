-- Reviewed and applied. consultation_id matches visits.id (text).
-- Draft foundation schema for the shared data model required by §5–§22.
--
-- This migration is intentionally additive and not yet applied. It captures the
-- missing / partial foundation elements for the V10 requirements backlog:
--   * consultation -> follow-up linkage
--   * health service attendance tracking
--   * responsible personnel accountability on triage / consultation records
--
-- The authoring team must confirm the exact role matrix and workflow semantics
-- before any production application.

begin;

-- Consultation -> follow-up linkage (partial foundation)
-- A consultation record is the actual encounter; the follow-up is the scheduled
-- next monitoring event. The link is stored here so the connected-workflow can
-- remain distinct without collapsing the two records into one row.
alter table public.follow_ups
  add column if not exists consultation_id text references public.visits(id) on delete set null;

create index if not exists follow_ups_consultation_idx
  on public.follow_ups (consultation_id);

-- Health service attendance (missing table; required to connect service
-- schedules / program attendance to the relevant resident and service).
create table if not exists public.health_service_attendance (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.health_services(id) on delete cascade,
  resident_id text not null references public.residents(id) on delete cascade,
  scheduled_date date not null default current_date,
  attended_at timestamptz,
  attendance_status text not null default 'scheduled'
    check (attendance_status in ('scheduled', 'attended', 'absent', 'cancelled', 'walk_in')),
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_by_name text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists health_service_attendance_service_idx
  on public.health_service_attendance (service_id, scheduled_date);
create index if not exists health_service_attendance_resident_idx
  on public.health_service_attendance (resident_id, scheduled_date);

-- Triage / consultation accountability (partial foundation)
-- `recorded_by_*` tracks who entered the note; `responsible_personnel_*` tracks
-- who was assigned or accountable for the triage / clinical action.
alter table public.visits
  add column if not exists responsible_personnel_id uuid references public.profiles(id) on delete set null,
  add column if not exists responsible_personnel_name text not null default '';

create index if not exists visits_responsible_personnel_idx
  on public.visits (responsible_personnel_id);

-- RLS review block for the newly-added attendance table.
-- The exact read/write matrix must be validated against the existing role and
-- barangay scope rules before application; this is intentionally a review stub,
-- not an override of the current policy set.
alter table public.health_service_attendance enable row level security;

drop policy if exists health_service_attendance_select on public.health_service_attendance;
create policy health_service_attendance_select on public.health_service_attendance
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.residents r
      where r.id = health_service_attendance.resident_id
        and r.auth_user_id = auth.uid()
    )
    or (
      public.is_staff_active()
      and exists (
        select 1 from public.health_services s
        where s.id = health_service_attendance.service_id
          and (
            s.municipality_id = public.profile_municipality_id()
            or s.created_by = auth.uid()
          )
      )
    )
  );

-- Insert, update and delete policies remain intentionally undefined here.
-- This draft requires the project review board to confirm the exact permission
-- model before the new attendance table is used in production.

commit;

-- rollback;
--   drop policy if exists health_service_attendance_select on public.health_service_attendance;
--   alter table public.health_service_attendance disable row level security;
--   drop table if exists public.health_service_attendance;
--   drop index if exists public.follow_ups_consultation_idx;
--   drop index if exists public.health_service_attendance_service_idx;
--   drop index if exists public.health_service_attendance_resident_idx;
--   drop index if exists public.visits_responsible_personnel_idx;
--   alter table public.follow_ups drop column if exists consultation_id;
--   alter table public.visits drop column if exists responsible_personnel_name;
--   alter table public.visits drop column if exists responsible_personnel_id;
-- commit;

-- supabase/migrations/20261116000000_health_service_delivery_records.sql
-- Capture what was assessed and delivered during a scheduled health service.
-- These fields extend the existing resident/service attendance record so a
-- service is documented once and can be shown in the resident's Health Record.

alter table public.health_service_attendance
  add column if not exists service_provided text not null default '',
  add column if not exists assessment text not null default '',
  add column if not exists recommendations text not null default '',
  add column if not exists follow_up_required boolean not null default false,
  add column if not exists follow_up_date date,
  add column if not exists provided_by uuid references public.profiles(id) on delete set null,
  add column if not exists provided_by_name text not null default '';

comment on column public.health_service_attendance.service_provided is
  'Description of the program service or procedure delivered to the resident.';
comment on column public.health_service_attendance.assessment is
  'Assessment or findings recorded during the health service encounter.';
comment on column public.health_service_attendance.provided_by is
  'Authenticated personnel account that delivered the service.';

-- Keep an immunization recorded from a health-service session connected to
-- the canonical immunizations workflow and prevent duplicate linked doses.
alter table public.immunizations
  add column if not exists health_service_attendance_id uuid
    references public.health_service_attendance(id) on delete set null;

create unique index if not exists immunizations_health_service_attendance_unique
  on public.immunizations (health_service_attendance_id)
  where health_service_attendance_id is not null;

comment on column public.immunizations.health_service_attendance_id is
  'Optional source health-service attendance row; one canonical immunization record per delivered service attendance.';

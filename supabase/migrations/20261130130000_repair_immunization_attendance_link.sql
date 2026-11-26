-- supabase/migrations/20261130130000_repair_immunization_attendance_link.sql
-- Repair schema drift where the original delivery-record migration was marked
-- applied but the immunization link column or its unique index is absent.
-- This link lets the health-service roster show the canonical immunization
-- recorded for an attendance row.

alter table public.immunizations
  add column if not exists health_service_attendance_id uuid
    references public.health_service_attendance(id) on delete set null;

create unique index if not exists immunizations_health_service_attendance_unique
  on public.immunizations (health_service_attendance_id)
  where health_service_attendance_id is not null;

comment on column public.immunizations.health_service_attendance_id is
  'Optional source health-service attendance row; one canonical immunization record per delivered service attendance.';

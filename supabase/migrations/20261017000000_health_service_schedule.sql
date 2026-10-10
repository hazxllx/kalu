-- =============================================================================
-- KALUSAGAP — health service schedule (start/end date-time + registration deadline)
--
-- Additive only: adds the concrete scheduling fields the Add Health Service
-- modal collects so a service records WHEN it is delivered and until WHEN a
-- resident may register. No existing column, row, policy or trigger is modified
-- or removed, and the browser-only / appointment_schedules concepts are left
-- untouched (this does NOT introduce a separate scheduling system — it stores
-- the one-off service window directly on the service record).
--
-- All columns are NULLABLE so existing health services remain valid; the API
-- layer requires start date/time + end time on NEW services (see
-- backend/src/validators/healthServices.validators.js). Dates/times are stored
-- naive (local) to mirror how the modal's date/time pickers capture them.
-- =============================================================================

begin;

alter table public.health_services
  add column if not exists start_date date,
  add column if not exists start_time time without time zone,
  add column if not exists end_date date,
  add column if not exists end_time time without time zone,
  add column if not exists registration_deadline timestamp without time zone;

comment on column public.health_services.start_date is
  'Service start date (local). Null for legacy services created before scheduling.';
comment on column public.health_services.start_time is
  'Service start time (local, HH:MM).';
comment on column public.health_services.end_date is
  'Service end date (local). Null is treated by the app as ending on start_date.';
comment on column public.health_services.end_time is
  'Service end time (local, HH:MM).';
comment on column public.health_services.registration_deadline is
  'Optional last date-time (local) a resident may register. Must not be after the start.';

-- Guard the stored window without forcing legacy rows to carry a schedule:
-- when both ends are present the end must not precede the start.
alter table public.health_services
  drop constraint if exists health_services_schedule_order;
alter table public.health_services
  add constraint health_services_schedule_order
  check (
    start_date is null
    or end_date is null
    or end_time is null
    or start_time is null
    or (end_date > start_date)
    or (end_date = start_date and end_time >= start_time)
  );

commit;

-- =============================================================================
-- KALUSAGAP — Resident "I plan to visit" visit plans
--
-- Additive only. No existing table is modified destructively.
--
-- The resident portal is a READ-ONLY health service directory with a single,
-- lightweight intent action: a resident browses the services their barangay
-- health center (BHC) and the covering Rural Health Unit (RHU) actually offer,
-- and tells the health center "I plan to come on this day". This is NOT an
-- appointment: there is no slot capacity, no approve/decline/reschedule
-- workflow and no resident-visible status. The barangay appointment system
-- (public.appointments + appointment_schedules + appointment_blackouts) is a
-- separate, staff-owned (BHW) concept and is left completely untouched here.
--
-- WHY A NEW TABLE: public.appointments carries a full request lifecycle
-- (pending/approved/reschedule_proposed/declined/cancelled/completed/missed),
-- slot capacity and a staff decision trail. A VisitPlan has none of that — it
-- is a soft signal with exactly two internal states (Planned, Cancelled). The
-- two must not be merged. VisitPlans reuse the existing health_services catalog
-- and appointment_schedules / appointment_blackouts for availability, and the
-- existing notifications table to signal the barangay's BHW. Nothing is copied.
--
-- Scope follows the established rules: a service is offered to a resident when
-- it is active in the resident's municipality AND either belongs to the
-- resident's own barangay (delivered at the Barangay Health Center) or has no
-- barangay (municipality-wide, delivered at the Rural Health Unit). Writes go
-- through the service-role backend (role/scope enforced in code); no user-token
-- insert/update policy is granted — mirroring health_services / appointments.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Extend the EXISTING health_services catalog (additive, non-destructive).
--    Whether a service is attended as a walk-in or needs prior visit notice is
--    a directory-display concern. A nullable column with a safe default means
--    the BHW-facing health-services code is unaffected (it never reads it).
-- ---------------------------------------------------------------------------
alter table public.health_services
  add column if not exists visit_policy text not null default 'walk_in'
    check (visit_policy in ('walk_in', 'by_notice'));

comment on column public.health_services.visit_policy is
  'Resident-directory display hint: walk_in (just show up during hours) or by_notice (tell the health center in advance). Does not affect the staff appointment workflow.';

-- ---------------------------------------------------------------------------
-- 2. Visit plans — a resident intends to visit a service on a given day.
-- ---------------------------------------------------------------------------
create table if not exists public.visit_plans (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null references public.residents(id) on delete cascade,
  barangay_id uuid references public.barangays(id) on delete restrict,
  service_id uuid not null references public.health_services(id) on delete cascade,
  -- Where the service is delivered, derived from the service's scope at create
  -- time: 'BHC' when the service belongs to the resident's barangay, 'RHU' when
  -- it is a municipality-wide service.
  facility_type text not null check (facility_type in ('BHC', 'RHU')),
  planned_date date not null,
  -- Optional, non-clinical, sanitized note (e.g. "Bringing my child").
  note varchar(140),
  -- Internal only. Never surfaced to the resident as a workflow: a resident
  -- only ever sees a plan or no plan. Removing a plan sets it to 'Cancelled'.
  status text not null default 'Planned' check (status in ('Planned', 'Cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.visit_plans is
  'Resident visit intent for a barangay/RHU health service. A soft signal to the barangay health worker, NOT an appointment: no slot capacity, no approval workflow and no resident-visible status.';

create index if not exists visit_plans_resident_date_idx
  on public.visit_plans (resident_id, planned_date);
create index if not exists visit_plans_service_date_idx
  on public.visit_plans (service_id, planned_date);
create index if not exists visit_plans_barangay_status_idx
  on public.visit_plans (barangay_id, status);

create trigger visit_plans_updated
  before update on public.visit_plans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
--
-- SELECT only (writes go through the service-role backend, which re-enforces
-- ownership + barangay/municipality scope in code). A resident sees only their
-- own visit plans; barangay-scoped staff (bhw / health_supervisor) see their
-- barangay's plans as a soft signal; municipality-wide roles see their
-- municipality; admin sees all.
-- ---------------------------------------------------------------------------
alter table public.visit_plans enable row level security;

drop policy if exists visit_plans_select on public.visit_plans;
create policy visit_plans_select on public.visit_plans
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.residents r
      where r.id = visit_plans.resident_id and r.auth_user_id = auth.uid()
    )
    or (
      public.is_staff_active() and (
        (public.profile_role() in ('bhw', 'health_supervisor') and barangay_id = public.profile_barangay_id())
        or (
          public.profile_role() in ('mho', 'phn', 'rhu_personnel')
          and exists (
            select 1 from public.barangays b
            where b.id = visit_plans.barangay_id and b.municipality_id = public.profile_municipality_id()
          )
        )
      )
    )
  );

commit;

-- rollback:
--   drop table if exists public.visit_plans;
--   alter table public.health_services drop column if exists visit_policy;

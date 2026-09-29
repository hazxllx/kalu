-- =============================================================================
-- KALUSAGAP — health services catalog + personnel assignment
--
-- Replaces the browser-only Health Services catalog
-- (frontend/src/services/local/workflowStore.js "services" array +
-- dashboardData.barangayServices) with a real, scoped, database-backed model
-- so a service a PHN creates and assigns actually appears in the assigned
-- personnel's account (and only theirs / their scope).
--
-- WHY NEW TABLES: exhaustive search of the migration history shows no health
-- services or service-assignment entity. `facilities` and `barangays` already
-- exist and are correctly SEPARATE (RHU is a facility of type 'rhu', a Barangay
-- Health Station is type 'barangay_health_station'); this migration references
-- them rather than duplicating them, and never treats RHU as a barangay. No
-- existing table is modified.
--
-- A service is scoped by municipality (+ facility, + barangay when it belongs
-- to a Barangay Health Station). Personnel visibility is by assignment and by
-- role/barangay scope — services are NEVER globally visible.
-- =============================================================================

begin;

create table if not exists public.health_services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Logical grouping used by the UI (Maternal Services / TCLS / Immunization /
  -- Family Planning / Consultation / Other). M1/FHSIS is a reporting workflow
  -- and is intentionally NOT a health-service category here.
  category text not null default 'Other',
  description text not null default '',
  municipality_id uuid references public.municipalities(id) on delete restrict,
  facility_id uuid references public.facilities(id) on delete set null,
  barangay_id uuid references public.barangays(id) on delete set null,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.health_services is
  'Health service catalog scoped by municipality/facility/barangay. RHU vs Barangay Health Station is modeled via facilities.type, never as a barangay.';

create table if not exists public.health_service_assignments (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.health_services(id) on delete cascade,
  personnel_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  active boolean not null default true,
  unique (service_id, personnel_id)
);

comment on table public.health_service_assignments is
  'Assigns a health service to a specific personnel profile. An assigned service appears in that personnel account regardless of their barangay scope.';

create trigger health_services_updated
  before update on public.health_services
  for each row execute function public.set_updated_at();

create index if not exists health_services_scope_idx
  on public.health_services (municipality_id, barangay_id, category, active);
create index if not exists health_service_assignments_personnel_idx
  on public.health_service_assignments (personnel_id, active);
create index if not exists health_service_assignments_service_idx
  on public.health_service_assignments (service_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- health_services SELECT — visible when:
--   admin, OR
--   the service is in the caller's municipality AND its barangay is one the
--     caller covers (profile_covers_barangay is true for a municipality-wide
--     role on any barangay in their municipality, and only their own barangay
--     for a Health Supervisor / BHW; a NULL barangay is a municipality/RHU-wide
--     service visible to municipality-wide roles), OR
--   the caller is assigned to the service, OR
--   the caller created it.
-- Writes are performed by the service-role backend (role/scope enforced in
-- code); no user-token insert/update policy is granted.
-- ---------------------------------------------------------------------------
alter table public.health_services enable row level security;

drop policy if exists health_services_select on public.health_services;
create policy health_services_select on public.health_services
  for select to authenticated
  using (
    public.is_admin()
    or created_by = auth.uid()
    or (
      public.is_staff_active()
      and municipality_id = public.profile_municipality_id()
      and (
        (barangay_id is null and public.profile_role() in ('mho', 'phn', 'rhu_personnel'))
        or (barangay_id is not null and public.profile_covers_barangay(barangay_id))
      )
    )
    or exists (
      select 1 from public.health_service_assignments a
      where a.service_id = health_services.id
        and a.personnel_id = auth.uid()
        and a.active
    )
  );

alter table public.health_service_assignments enable row level security;

drop policy if exists health_service_assignments_select on public.health_service_assignments;
create policy health_service_assignments_select on public.health_service_assignments
  for select to authenticated
  using (
    public.is_admin()
    or personnel_id = auth.uid()
    or exists (
      select 1 from public.health_services s
      where s.id = health_service_assignments.service_id
        and (
          s.created_by = auth.uid()
          or (
            public.is_staff_active()
            and s.municipality_id = public.profile_municipality_id()
            and (s.barangay_id is null or public.profile_covers_barangay(s.barangay_id))
          )
        )
    )
  );

commit;

-- =============================================================================
-- KALUSAGAP — report submission workflow
--
-- Replaces the browser-only report state
-- (frontend/src/features/reports/pages/ReportsPage.jsx local React state and
-- frontend/src/services/local/municipalSubmissionsStore.js, sessionStorage key
-- "kalusagap.municipal-submissions.v2") with a real, persisted, role-routed
-- table so a report submitted by a PHN actually reaches the MHO, and a report
-- submitted by a Health Supervisor actually reaches the RHU.
--
-- WHY A NEW TABLE: exhaustive search of the migration history shows no report
-- delivery entity. `m1_report_meta` is an FHSIS aggregation header keyed by
-- (barangay, year, month) with a prepared/validated workflow and NO
-- sender/recipient routing — it is not a "submit a report to a recipient"
-- workflow and is intentionally left unchanged. No existing table is modified.
--
-- Recipient routing is by ROLE + municipality (+ optional barangay), matching
-- the existing role/municipality/barangay scope model. The recipient is a role
-- (e.g. the MHO for a PHN report, the RHU personnel for a Health Supervisor
-- report), never a hard-coded PHN.
-- =============================================================================

begin;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  report_type text not null,
  report_period text not null default '',
  title text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  -- Strongly typed to the existing role enum so role comparisons in the RLS
  -- policies below (public.profile_role() = recipient_role) are app_role =
  -- app_role, not the invalid app_role = text.
  sender_role public.app_role not null,
  recipient_role public.app_role not null,
  municipality_id uuid references public.municipalities(id) on delete restrict,
  barangay_id uuid references public.barangays(id) on delete set null,
  -- Draft -> Submitted -> Received -> Reviewed, with Rejected.
  status text not null default 'Submitted'
    check (status in ('Draft', 'Submitted', 'Received', 'Reviewed', 'Rejected')),
  remarks text not null default '',
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.reports is
  'Role-routed report submissions (e.g. PHN -> MHO, Health Supervisor -> RHU). Recipient is a role within the sender''s municipality/barangay scope.';

create trigger reports_updated
  before update on public.reports
  for each row execute function public.set_updated_at();

create index if not exists reports_recipient_idx
  on public.reports (recipient_role, municipality_id, status, created_at desc);
create index if not exists reports_sender_idx
  on public.reports (created_by, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
--   admin                              -> all
--   sender (created_by = auth.uid())   -> their own reports
--   recipient (profile_role() =        -> reports routed to their role within
--     recipient_role, same municipality    their municipality (+ barangay when set)
-- The backend uses the service-role client and additionally enforces the same
-- scope in code (defense in depth), so this policy is not the only boundary.
-- ---------------------------------------------------------------------------
alter table public.reports enable row level security;

drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports
  for select to authenticated
  using (
    public.is_admin()
    or created_by = auth.uid()
    or (
      public.is_staff_active()
      and public.profile_role() = recipient_role
      and municipality_id = public.profile_municipality_id()
      and (barangay_id is null or public.profile_covers_barangay(barangay_id))
    )
  );

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated
  with check (
    public.is_staff_active()
    and created_by = auth.uid()
    and public.profile_role() = sender_role
  );

drop policy if exists reports_update on public.reports;
create policy reports_update on public.reports
  for update to authenticated
  using (
    public.is_admin()
    or created_by = auth.uid()
    or (
      public.is_staff_active()
      and public.profile_role() = recipient_role
      and municipality_id = public.profile_municipality_id()
      and (barangay_id is null or public.profile_covers_barangay(barangay_id))
    )
  )
  with check (
    public.is_admin()
    or created_by = auth.uid()
    or (
      public.is_staff_active()
      and public.profile_role() = recipient_role
      and municipality_id = public.profile_municipality_id()
      and (barangay_id is null or public.profile_covers_barangay(barangay_id))
    )
  );

commit;

-- =============================================================================
-- KALUSAGAP — BUG-009: household risk-cluster workflow persistence
--
-- The household risk-cluster follow-up / assignment / escalation / resolution
-- workflow was tracked only in the browser (sessionStorage
-- `kalusagap.household-risk.v2`). This adds a normalized, per-household home for
-- that workflow state so it survives refresh, logout/login and another device,
-- and so barangay/municipality ownership is enforced server-side.
--
-- It does NOT duplicate the household system: it is a 1:1 workflow extension of
-- public.households (keyed by household_id). Risk CLASSIFICATION stays computed
-- on households; this table only holds the intervention workflow.
--
-- RLS mirrors public.households exactly:
--   mho / phn / rhu_personnel -> own municipality
--   health_supervisor / bhw   -> exactly their assigned barangay
--
-- Idempotent-friendly: guarded with IF NOT EXISTS / DROP POLICY IF EXISTS.
-- =============================================================================

begin;

create table if not exists public.household_risk_workflow (
  household_id text primary key references public.households(id) on delete cascade,
  workflow_status text not null default 'Monitoring',
  assigned_worker text not null default '',
  assigned_worker_role text not null default '',
  assignment_at timestamptz,
  escalation jsonb not null default '{}'::jsonb,
  follow_up_count integer not null default 0 check (follow_up_count >= 0),
  last_follow_up_at date,
  last_note text not null default '',
  history jsonb not null default '[]'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists household_risk_workflow_status_idx
  on public.household_risk_workflow(workflow_status);

drop trigger if exists household_risk_workflow_set_updated_at on public.household_risk_workflow;
create trigger household_risk_workflow_set_updated_at
  before update on public.household_risk_workflow
  for each row execute function public.set_updated_at();

alter table public.household_risk_workflow enable row level security;

-- Scope is derived from the parent household (never a client id), matching the
-- households scope rules exactly.
drop policy if exists household_risk_workflow_select on public.household_risk_workflow;
create policy household_risk_workflow_select on public.household_risk_workflow
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and exists (
        select 1 from public.households h
        where h.id = household_risk_workflow.household_id
          and (
            (public.profile_role() in ('mho', 'phn', 'rhu_personnel') and h.municipality_id = public.profile_municipality_id())
            or (public.profile_role() in ('health_supervisor', 'bhw') and h.barangay_id = public.profile_barangay_id())
          )
      )
    )
  );

drop policy if exists household_risk_workflow_insert on public.household_risk_workflow;
create policy household_risk_workflow_insert on public.household_risk_workflow
  for insert to authenticated
  with check (
    public.is_staff_active()
    and public.profile_role() in ('bhw', 'health_supervisor', 'phn')
    and exists (
      select 1 from public.households h
      where h.id = household_id and public.profile_covers_barangay(h.barangay_id)
    )
  );

drop policy if exists household_risk_workflow_update on public.household_risk_workflow;
create policy household_risk_workflow_update on public.household_risk_workflow
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('bhw', 'health_supervisor', 'phn')
      and exists (
        select 1 from public.households h
        where h.id = household_risk_workflow.household_id and public.profile_covers_barangay(h.barangay_id)
      )
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('bhw', 'health_supervisor', 'phn')
      and exists (
        select 1 from public.households h
        where h.id = household_id and public.profile_covers_barangay(h.barangay_id)
      )
    )
  );

commit;

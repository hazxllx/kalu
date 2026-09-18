-- =============================================================================
-- KALUSAGAP — Manual resident verification (Health Supervisor review)
--
-- Replaces the third-party KYC flow: residents self-register -> status is
-- 'pending' -> the assigned Health Supervisor approves or rejects -> the
-- resident sees the result and gains access once approved.
--
-- Runs AFTER:
--   20260903120000_create_rhu_patient_workflow.sql       (residents base table)
--   20260915100000_create_core_org_and_profiles.sql      (profiles, helpers)
--   20260915100100_accounts_documents_and_clinical_scope.sql (verification_status)
--
-- This migration:
--   1. moves residents.verification_status onto the manual-review status set
--      (pending / approved / rejected / resubmission_required), preserving data
--   2. adds the review audit columns (verified_by, verified_at,
--      rejection_reason, submitted_for_verification_at)
--   3. adds the resident_verification_logs audit table
--
-- It does NOT touch the Didit tables (identity_verifications /
-- didit_webhook_events). They are left in place but unused/deprecated.
--
-- Reversible: a rollback block is at the bottom of the file.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Status set: pending | approved | rejected | resubmission_required
-- ---------------------------------------------------------------------------
-- Existing values are migrated BEFORE the new constraint is added:
--   unverified -> pending      (needs review under the new workflow)
--   verified   -> approved     (already-approved records are preserved)
--   pending / rejected         (unchanged)
alter table public.residents drop constraint if exists residents_verification_status_check;

update public.residents set verification_status = 'pending'  where verification_status = 'unverified';
update public.residents set verification_status = 'approved' where verification_status = 'verified';

alter table public.residents
  alter column verification_status set default 'pending';

alter table public.residents
  add constraint residents_verification_status_check
  check (verification_status in ('pending', 'approved', 'rejected', 'resubmission_required'));

-- ---------------------------------------------------------------------------
-- 2. Review audit columns
-- ---------------------------------------------------------------------------
alter table public.residents
  add column if not exists verified_by uuid references public.profiles(id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists rejection_reason text not null default '',
  add column if not exists submitted_for_verification_at timestamptz;

-- Backfill the submission timestamp for anything still awaiting/again awaiting
-- review, so the reviewer sees a real "date submitted" for existing rows.
update public.residents
   set submitted_for_verification_at = created_at
 where submitted_for_verification_at is null
   and verification_status in ('pending', 'rejected', 'resubmission_required');

create index if not exists residents_verified_by_idx on public.residents(verified_by);
create index if not exists residents_submitted_for_verification_idx
  on public.residents(submitted_for_verification_at desc);

-- ---------------------------------------------------------------------------
-- 3. Verification audit log
-- ---------------------------------------------------------------------------
-- One immutable row per action. `reviewed_by` is the authenticated Health
-- Supervisor/PHN profile id; NULL for the resident's own 'submitted'/
-- 'resubmitted' actions. No update/delete policies exist, so a log entry can
-- never be altered through the API by a resident or a reviewer.
create table if not exists public.resident_verification_logs (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null references public.residents(id) on delete cascade,
  reviewed_by uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('submitted', 'approved', 'rejected', 'resubmitted')),
  reason text not null default '',
  previous_status text,
  new_status text not null,
  created_at timestamptz not null default now()
);

create index if not exists resident_verification_logs_resident_idx
  on public.resident_verification_logs(resident_id, created_at desc);
create index if not exists resident_verification_logs_reviewer_idx
  on public.resident_verification_logs(reviewed_by);
create index if not exists resident_verification_logs_created_idx
  on public.resident_verification_logs(created_at desc);

alter table public.resident_verification_logs enable row level security;

-- A resident may read their own verification history; staff may read logs for
-- residents inside their municipality/barangay scope; admins read all.
-- There are deliberately NO insert/update/delete policies: only the Express
-- backend (service-role key, after authenticate + authorize) writes logs.
drop policy if exists resident_verification_logs_select on public.resident_verification_logs;
create policy resident_verification_logs_select on public.resident_verification_logs
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.residents r
      where r.id = resident_verification_logs.resident_id
        and r.auth_user_id = auth.uid()
    )
    or (
      public.is_staff_active()
      and exists (
        select 1 from public.residents r
        where r.id = resident_verification_logs.resident_id
          and (
            (
              public.profile_role() in ('mho', 'phn', 'rhu_personnel')
              and r.municipality_id = public.profile_municipality_id()
            )
            or (
              public.profile_role() in ('health_supervisor', 'bhw')
              and r.barangay_id = public.profile_barangay_id()
            )
          )
      )
    )
  );

commit;

-- =============================================================================
-- ROLLBACK (run manually if this migration must be reverted)
-- =============================================================================
-- begin;
--   drop policy if exists resident_verification_logs_select on public.resident_verification_logs;
--   drop table if exists public.resident_verification_logs;
--   drop index if exists public.residents_submitted_for_verification_idx;
--   drop index if exists public.residents_verified_by_idx;
--   alter table public.residents
--     drop column if exists submitted_for_verification_at,
--     drop column if exists rejection_reason,
--     drop column if exists verified_at,
--     drop column if exists verified_by;
--   alter table public.residents drop constraint if exists residents_verification_status_check;
--   update public.residents set verification_status = 'verified' where verification_status = 'approved';
--   update public.residents set verification_status = 'unverified'
--     where verification_status in ('pending', 'resubmission_required');
--   alter table public.residents
--     alter column verification_status set default 'unverified';
--   alter table public.residents
--     add constraint residents_verification_status_check
--     check (verification_status in ('unverified', 'pending', 'verified', 'rejected'));
-- commit;

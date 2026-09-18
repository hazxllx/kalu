-- =============================================================================
-- KALUSAGAP — Didit identity verification (KYC)
--
-- Runs AFTER:
--   20260903120000_create_rhu_patient_workflow.sql  (residents, set_updated_at)
--   20260915100000_create_core_org_and_profiles.sql (roles, profiles helpers)
--   20260915100100_accounts_documents_and_clinical_scope.sql (residents scope)
--
-- This migration is ADDITIVE and NON-DESTRUCTIVE. It does NOT touch the
-- existing barangay/residency verification (`residents.verification_status`),
-- which remains a separate concern. Identity verification (KYC) gets its own
-- status column, its own attempt table and its own audit trail.
--
-- Privacy: KALUSAGAP never stores face images, liveness data or identity
-- documents from Didit. The hosted Didit flow holds those; this schema stores
-- only the session reference and a sanitized decision summary.
--
-- Reversibility: see the "ROLLBACK" block at the bottom of this file.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Identity verification status enum
-- ---------------------------------------------------------------------------
-- `unverified`  no successful verification yet (or never started)
-- `in_progress` a Didit session exists and the resident is completing it
-- `pending_review` Didit returned "In Review" (manual review)
-- `verified`    Didit returned "Approved"
-- `declined`    Didit returned "Declined"
-- `failed`      technical/validation failure before a Didit decision
-- `expired`     the session expired before completion
create type public.identity_verification_status as enum (
  'unverified',
  'in_progress',
  'pending_review',
  'verified',
  'declined',
  'failed',
  'expired'
);

-- ---------------------------------------------------------------------------
-- Extend residents with KYC fields (separate from `verification_status`)
-- ---------------------------------------------------------------------------
alter table public.residents
  add column identity_verification_status public.identity_verification_status not null default 'unverified',
  add column didit_session_id text,
  add column identity_verified_at timestamptz,
  add column identity_last_attempt_at timestamptz,
  add column identity_attempt_count integer not null default 0;

create index residents_identity_verification_status_idx
  on public.residents(identity_verification_status);

-- One Didit session may be attached to at most one resident.
create unique index residents_didit_session_id_key
  on public.residents(didit_session_id)
  where didit_session_id is not null;

-- ---------------------------------------------------------------------------
-- Identity verification attempts
-- ---------------------------------------------------------------------------
-- One row per Didit session. `decision` holds a SANITIZED subset of the Didit
-- decision needed for audit (status, feature outcomes, warnings, and the
-- identity fields Didit matched) — never portraits, document images or raw
-- biometric payloads.
create table public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  resident_id text references public.residents(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  didit_session_id text not null,
  didit_session_number integer,
  vendor_data text not null,
  status public.identity_verification_status not null default 'in_progress',
  -- Raw Didit status label (e.g. "Not Started", "Approved", "Kyc Expired").
  didit_status text not null default 'Not Started',
  decision jsonb,
  workflow_id uuid,
  workflow_version integer,
  failure_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz,
  constraint identity_verifications_session_unique unique (didit_session_id)
);

create index identity_verifications_resident_id_idx on public.identity_verifications(resident_id);
create index identity_verifications_auth_user_id_idx on public.identity_verifications(auth_user_id);
create index identity_verifications_status_idx on public.identity_verifications(status);
create index identity_verifications_created_at_idx on public.identity_verifications(created_at desc);

create trigger identity_verifications_set_updated_at
  before update on public.identity_verifications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Webhook idempotency
-- ---------------------------------------------------------------------------
-- Didit reuses `event_id` across retries. Recording it before processing makes
-- webhook handling idempotent: a replayed or duplicate event conflicts on the
-- primary key and is acknowledged without being applied twice.
create table public.didit_webhook_events (
  event_id text primary key,
  webhook_type text not null default '',
  didit_session_id text,
  status text not null default '',
  received_at timestamptz not null default now()
);

create index didit_webhook_events_session_id_idx on public.didit_webhook_events(didit_session_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Reads only. There are deliberately NO insert/update/delete policies: only the
-- Express backend (service-role key, after authenticate + authorize) may create
-- or change verification records. A resident can never write their own result.

alter table public.identity_verifications enable row level security;
alter table public.didit_webhook_events enable row level security;

-- A resident may read only their own attempts; staff may read attempts for
-- residents inside their municipality/barangay scope; admins read all.
create policy identity_verifications_select on public.identity_verifications
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.residents r
      where r.id = identity_verifications.resident_id
        and r.auth_user_id = auth.uid()
    )
    or (
      public.is_staff_active()
      and exists (
        select 1 from public.residents r
        where r.id = identity_verifications.resident_id
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

-- Webhook delivery metadata is operational data: admin-readable only.
create policy didit_webhook_events_select on public.didit_webhook_events
  for select to authenticated
  using (public.is_admin());

commit;

-- =============================================================================
-- ROLLBACK (run manually if this migration must be reverted)
-- =============================================================================
-- begin;
--   drop policy if exists didit_webhook_events_select on public.didit_webhook_events;
--   drop policy if exists identity_verifications_select on public.identity_verifications;
--   drop table if exists public.didit_webhook_events;
--   drop table if exists public.identity_verifications;
--   drop index if exists public.residents_didit_session_id_key;
--   drop index if exists public.residents_identity_verification_status_idx;
--   alter table public.residents
--     drop column if exists identity_attempt_count,
--     drop column if exists identity_last_attempt_at,
--     drop column if exists identity_verified_at,
--     drop column if exists didit_session_id,
--     drop column if exists identity_verification_status;
--   drop type if exists public.identity_verification_status;
-- commit;

-- =============================================================================
-- KALUSAGAP — Proof of Residency documents
--
-- Extends the existing `documents` table (migration 2) with proof-of-residency
-- workflow fields and adds RLS so residents can upload their own documents and
-- staff can review them within scope.
--
-- Runs AFTER:
--   20260915100100_accounts_documents_and_clinical_scope.sql  (documents table + bucket)
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Extend documents table for proof-of-residency workflow
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists document_type text not null default 'proof_of_residency'
    check (document_type in (
      'proof_of_residency',
      'barangay_certificate',
      'barangay_clearance',
      'government_id',
      'other'
    )),
  add column if not exists verification_status text not null default 'pending'
    check (verification_status in ('pending', 'approved', 'rejected', 'resubmission_required')),
  add column if not exists rejection_reason text not null default '',
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

-- Ensure resident_id is required for proof-of-residency documents
alter table public.documents
  add constraint documents_proof_residency_resident_required
    check (
      document_type <> 'proof_of_residency'
      or resident_id is not null
    );

-- ---------------------------------------------------------------------------
-- Storage bucket already created in migration 2 as `documents` (private).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- RLS — proof-of-residency documents
-- ---------------------------------------------------------------------------
-- Residents can upload their own documents and view them.
-- Staff can view/update documents for residents in their barangay/municipality scope.
-- Admin has full access.

create policy documents_resident_insert on public.documents
  for insert to authenticated
  with check (
    resident_id in (
      select r.id from public.residents r
      where r.auth_user_id = auth.uid()
    )
    and document_type = 'proof_of_residency'
    and verification_status = 'pending'
  );

create policy documents_resident_update on public.documents
  for update to authenticated
  using (
    resident_id in (
      select r.id from public.residents r
      where r.auth_user_id = auth.uid()
    )
    and verification_status = 'rejected'
  )
  with check (
    resident_id in (
      select r.id from public.residents r
      where r.auth_user_id = auth.uid()
    )
    and verification_status = 'pending'
  );

create policy documents_staff_select on public.documents
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.residents r
      where r.id = documents.resident_id
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
  );

create policy documents_staff_update on public.documents
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('health_supervisor', 'phn')
      and exists (
        select 1 from public.residents r
        where r.id = documents.resident_id
          and (
            (
              public.profile_role() in ('phn', 'mho', 'rhu_personnel')
              and r.municipality_id = public.profile_municipality_id()
            )
            or (
              public.profile_role() in ('health_supervisor', 'bhw')
              and r.barangay_id = public.profile_barangay_id()
            )
          )
      )
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('health_supervisor', 'phn')
      and exists (
        select 1 from public.residents r
        where r.id = documents.resident_id
          and (
            (
              public.profile_role() in ('phn', 'mho', 'rhu_personnel')
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

-- ---------------------------------------------------------------------------
-- Indexes for common queries
-- ---------------------------------------------------------------------------
create index if not exists documents_verification_status_idx
  on public.documents(verification_status);

create index if not exists documents_reviewed_by_idx
  on public.documents(reviewed_by);

commit;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- begin;
--   drop policy if exists documents_staff_update on public.documents;
--   drop policy if exists documents_staff_select on public.documents;
--   drop policy if exists documents_resident_update on public.documents;
--   drop policy if exists documents_resident_insert on public.documents;
--   drop index if exists documents_reviewed_by_idx;
--   drop index if exists documents_verification_status_idx;
--   alter table public.documents
--     drop constraint if exists documents_proof_residency_resident_required,
--     drop column if exists reviewed_at,
--     drop column if exists reviewed_by,
--     drop column if exists rejection_reason,
--     drop column if exists verification_status,
--     drop column if exists document_type;
--   drop policy if exists documents_update on public.documents;
--   drop policy if exists documents_select on public.documents;
--   drop policy if exists documents_delete on public.documents;
--   drop policy if exists documents_insert on public.documents;
--   drop table if exists public.documents;
-- commit;

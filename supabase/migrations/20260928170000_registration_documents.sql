-- =============================================================================
-- KALUSAGAP — personnel (staff) registration verification documents
--
-- The personnel (staff) registration flow previously persisted only document
-- LABELS in staff_account_requests.documents (JSONB), so the account approval
-- page had nothing viewable. This adds a real, private, file-backed document
-- table linked to the staff account request, mirroring the resident document
-- model (private 'documents' storage bucket + backend-mediated signed URLs).
--
-- NAMING: the name `public.registration_documents` is ALREADY TAKEN by an
-- existing VIEW over the resident `public.documents` table (see
-- 20260920210000_resident_registration_documents.sql and
-- 20260927100000_registration_documents_security_invoker.sql). To avoid
-- colliding with that view (which caused "registration_documents is not a
-- table"), this STAFF table is named `staff_registration_documents`.
--
-- WHY A NEW TABLE: the resident `public.documents` table is keyed to a resident
-- id and its own document-type enum, and its RLS is resident/verification
-- scoped — it is not appropriate for a staff APPLICANT who has no resident
-- record. A dedicated table keyed to staff_account_requests keeps the two
-- pipelines separate and correctly scoped. No existing table/view is modified.
--
-- Files themselves live in the existing private 'documents' storage bucket
-- (public=false) under the 'staff-documents/<request_id>/' prefix; only the
-- storage PATH is stored here, and downloads are always backend-mediated signed
-- URLs. No public URL is ever stored or exposed.
-- =============================================================================

begin;

create table if not exists public.staff_registration_documents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.staff_account_requests(id) on delete cascade,
  document_type text not null,
  storage_path text not null,
  original_filename text not null default '',
  mime_type text not null default '',
  file_size integer not null default 0,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.staff_registration_documents is
  'Verification documents uploaded during personnel (staff) registration. Files live in the private documents bucket; only the storage path is stored. Visible to the authorized approver of the parent request.';

create index if not exists staff_registration_documents_request_idx
  on public.staff_registration_documents (request_id, uploaded_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
--   admin                       -> all
--   authorized approver         -> documents for requests whose role they may
--     (can_approve_staff_role)     approve (PHN: HS/RHU; Health Supervisor:
--                                  BHW/Resident)
-- No insert/update/delete policy for user tokens: rows are written only by the
-- service-role backend during registration. An applicant (anon/pending) cannot
-- read or write these rows directly.
-- ---------------------------------------------------------------------------
alter table public.staff_registration_documents enable row level security;

drop policy if exists staff_registration_documents_select on public.staff_registration_documents;
create policy staff_registration_documents_select on public.staff_registration_documents
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.staff_account_requests r
      where r.id = staff_registration_documents.request_id
        and public.can_approve_staff_role(r.role)
    )
  );

commit;

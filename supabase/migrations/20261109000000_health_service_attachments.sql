-- =============================================================================
-- KALUSAGAP — health service attachments (memo and publication materials)
--
-- Stores references to official memoranda (PDF/DOC/DOCX) and publication
-- materials (JPG/PNG/WebP images) uploaded to Supabase Storage for health
-- services. Attachments are scoped by health_service_id and include metadata
-- (filename, MIME type, file size, storage path).
--
-- Each health service may have at most one memo and one pubmat attachment.
-- Attachments are optional and are deleted when their health service is deleted.
-- =============================================================================

begin;

create table if not exists public.health_service_attachments (
  id uuid primary key default gen_random_uuid(),
  health_service_id uuid not null references public.health_services(id) on delete cascade,
  attachment_type text not null check (attachment_type in ('memo', 'pubmat')),
  filename text not null,
  mime_type text not null,
  file_size integer not null,
  storage_path text not null unique,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Enforce at most one attachment of each type per service
  unique (health_service_id, attachment_type)
);

comment on table public.health_service_attachments is
  'Stores metadata for uploaded health service documents (official memoranda and publication materials).';

comment on column public.health_service_attachments.attachment_type is
  'Type of attachment: "memo" for official memorandum (PDF/DOC/DOCX) or "pubmat" for publication material (JPG/PNG/WebP).';

comment on column public.health_service_attachments.storage_path is
  'Supabase Storage path in the documents bucket: health-service-attachments/<service-id>/<type>.<ext>';

create trigger health_service_attachments_updated
  before update on public.health_service_attachments
  for each row execute function public.set_updated_at();

create index if not exists health_service_attachments_service_idx
  on public.health_service_attachments (health_service_id, attachment_type);
create index if not exists health_service_attachments_path_idx
  on public.health_service_attachments (storage_path);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- health_service_attachments SELECT — visible when:
--   admin, OR
--   the attachment's health_service is visible to the caller (via
--     health_services RLS policy).
-- Writes are performed by the service-role backend; no user-token
--   insert/update/delete policy is granted.
-- ---------------------------------------------------------------------------

alter table public.health_service_attachments enable row level security;

drop policy if exists health_service_attachments_select on public.health_service_attachments;
create policy health_service_attachments_select on public.health_service_attachments
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.health_services s
      where s.id = health_service_attachments.health_service_id
        and (
          s.created_by = auth.uid()
          or public.is_admin()
          or (
            public.is_staff_active()
            and s.municipality_id = public.profile_municipality_id()
            and (
              (s.barangay_id is null and public.profile_role() in ('mho', 'phn', 'rhu_personnel'))
              or (s.barangay_id is not null and public.profile_covers_barangay(s.barangay_id))
            )
          )
          or exists (
            select 1 from public.health_service_assignments a
            where a.service_id = s.id
              and a.personnel_id = auth.uid()
              and a.active
          )
        )
    )
  );

commit;

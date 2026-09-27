-- KALUSAGAP — QA fix: registration_documents view must not bypass RLS
--
-- FINDING (P1): the public.registration_documents view was created without
-- `security_invoker`, so Postgres evaluated it with the VIEW OWNER's rights.
-- Because no base table uses FORCE ROW LEVEL SECURITY, the owner bypasses the
-- documents table's per-owner/per-scope RLS policies. Any authenticated user
-- (including a resident-limited account) could therefore SELECT the view over
-- the public Data API and read EVERY resident's document metadata
-- (resident_id, file_name, storage_path, document_type, verification_status)
-- across all barangays.
--
-- FIX: recreate the view WITH (security_invoker = true) so the querying user's
-- own RLS policies on public.documents apply. Behaviour is unchanged for the
-- backend service-role path; the leak is closed on the direct Data API path.
--
-- Requires PostgreSQL 15+ (Supabase). No data migration; view definition only.
begin;

create or replace view public.registration_documents
with (security_invoker = true) as
select
  d.id,
  d.resident_id,
  d.document_type,
  d.file_name,
  d.storage_path,
  d.mime_type,
  d.size_bytes,
  d.verification_status,
  d.uploaded_by,
  d.created_at,
  d.updated_at
from public.documents d
where d.document_type in ('proof_of_residency','barangay_certificate','barangay_clearance','government_id','other');

grant select on public.registration_documents to authenticated;

commit;

-- KALUSAGAP — Resident registration document requirement
--
-- Adds a lightweight registration_documents view/helper so the registration
-- flow can require a proof-of-residency document without changing the existing
-- documents table schema. Uses the existing documents table + private bucket.
begin;

create or replace view public.registration_documents as
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

-- =============================================================================
-- KALUSAGAP — BUG-014: resident document storage_path integrity
--
-- documents_resident_insert / documents_resident_update let a resident set an
-- ARBITRARY storage_path on a row for their own resident_id. The backend always
-- generates the path server-side as
--   'resident-documents/<resident_id>/<documentId>.<ext>'
-- (storage.service.js), so RLS must pin a direct PostgREST insert/update to the
-- same server-owned, per-resident prefix. This blocks cross-user document
-- references and path traversal even though the bucket has no direct storage
-- policies.
--
-- Idempotent: safe to re-run.
-- =============================================================================

begin;

-- A resident may only insert a proof-of-residency row for their own resident
-- record AND only with a storage_path under their own server-owned folder.
drop policy if exists documents_resident_insert on public.documents;
create policy documents_resident_insert on public.documents
  for insert to authenticated
  with check (
    resident_id in (
      select r.id from public.residents r
      where r.auth_user_id = auth.uid()
    )
    and document_type = 'proof_of_residency'
    and verification_status = 'pending'
    -- BUG-014: bind the storage path to the resident's own server-owned prefix.
    and storage_path like ('resident-documents/' || resident_id || '/%')
    and position('..' in storage_path) = 0
  );

drop policy if exists documents_resident_update on public.documents;
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
    -- BUG-014: a resubmission cannot repoint the row at another path either.
    and storage_path like ('resident-documents/' || resident_id || '/%')
    and position('..' in storage_path) = 0
  );

commit;

-- =============================================================================
-- KALUSAGAP — Structured identity documents for resident registration
--
-- Extends the existing `documents` table with the Government ID front/back and
-- identity-photo document types plus a `government_id_type` column. A resident
-- submits: ID front, ID back, identity photo, and either a separate proof of
-- residency (or declares their government ID's address as residency proof).
--
-- File-size note: registration documents are capped at 10 MB (10485760 bytes).
-- The cap is enforced in the backend upload path (validators + storage); no DB
-- check constraint is added so already-stored legacy files remain valid.
--
-- Runs AFTER:
--   20260920100000_proof_of_residency_documents.sql
-- =============================================================================

begin;

-- Replace the original document_type allowlist with one that also covers the
-- structured identity verification documents. Drop every CHECK constraint on
-- the column (the original was auto-named by Postgres) so this stays safe
-- regardless of the exact constraint name.
do $$
declare
  rec record;
begin
  for rec in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where rel.relname = 'documents'
      and nsp.nspname = 'public'
      and con.contype = 'c'
      and exists (
        select 1
        from unnest(con.conkey) with ordinality k(attnum, ord)
        join pg_attribute a on a.attnum = k.attnum and a.attrelid = con.conrelid
        where a.attname = 'document_type'
      )
  loop
    execute format('alter table public.documents drop constraint %I', rec.conname);
  end loop;
end$$;

alter table public.documents
  add constraint documents_document_type_check check (document_type in (
    'proof_of_residency',
    'barangay_certificate',
    'barangay_clearance',
    'government_id',
    'other',
    'government_id_front',
    'government_id_back',
    'identity_photo'
  ));

-- Government ID type the resident selected (e.g. 'drivers_license'). Stored on
-- the ID front/back rows so the Health Supervisor can identify the ID.
-- Nullable: not applicable to proof-of-residency and other documents.
alter table public.documents
  add column if not exists government_id_type text;

comment on column public.documents.government_id_type is
  'Government ID type selected at registration (philsys, drivers_license, passport, umid, prc_id, postal_id, other). Set on government_id_front/back rows only; nullable elsewhere.';

comment on column public.documents.size_bytes is
  'File size in bytes. Registration uploads are capped at 10 MB (10485760) and enforced in the backend upload path.';

commit;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- begin;
--   alter table public.documents
--     drop constraint if exists documents_document_type_check,
--     drop column if exists government_id_type;
--   alter table public.documents
--     add constraint documents_document_type_check check (document_type in (
--       'proof_of_residency',
--       'barangay_certificate',
--       'barangay_clearance',
--       'government_id',
--       'other'
--     ));
-- commit;

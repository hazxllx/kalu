-- =============================================================================
-- KALUSAGAP — automated document screening result columns
--
-- Adds the outcome of the deterministic, rule-based document screening step to
-- the EXISTING public.documents table (the single resident/staff document
-- table). No new table, no new upload system and no change to existing
-- verification_status semantics:
--
--   verification_status   unchanged — the Staff/Health Supervisor manual
--                         workflow remains the source of truth.
--   screening_status      automated ADVISORY result, one of:
--                           'pending_manual_review'
--                           'automated_flagged'
--                           'automated_rejected'
--
-- This step performs READABILITY checks only (allowed file type, decodable
-- image, minimum resolution, brightness/contrast, presence of readable text and
-- configurable document-indicator phrases). It does NOT authenticate a
-- government ID and does NOT identify people or objects. An automated result
-- never permanently blocks authorized staff from viewing or deciding on a
-- document.
--
-- Additive and idempotent. No existing column, row or policy is modified or
-- removed. Existing rows keep NULL screening columns and remain valid.
-- =============================================================================

begin;

alter table public.documents
  add column if not exists screening_status text,
  add column if not exists screening_reason text,
  add column if not exists screening_quality text,
  add column if not exists screening_ocr_detected boolean,
  add column if not exists screening_checked_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_screening_status_check'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_screening_status_check
      check (
        screening_status is null
        or screening_status in ('pending_manual_review', 'automated_flagged', 'automated_rejected')
      );
  end if;
end$$;

comment on column public.documents.screening_status is
  'Advisory automated screening outcome (pending_manual_review | automated_flagged | automated_rejected). Readability only — never an authenticity decision.';
comment on column public.documents.screening_reason is
  'Machine-readable screening reason code (e.g. NO_MEANINGFUL_TEXT, TOO_DARK, DOCUMENT_INDICATORS_DETECTED, NO_DOCUMENT_INDICATORS). Not shown verbatim to residents.';
comment on column public.documents.screening_quality is
  'Deterministic image-quality outcome (VALID, LOW_QUALITY_BUT_PROCESSABLE, CLEARLY_UNUSABLE, BLANK_IMAGE, TOO_DARK, TOO_BRIGHT, INSUFFICIENT_RESOLUTION, UNREADABLE, NOT_ANALYZED).';
comment on column public.documents.screening_ocr_detected is
  'True when OCR extracted meaningful text. Stored as a boolean only; the OCR text itself is deliberately never persisted.';
comment on column public.documents.screening_checked_at is
  'When the automated screening ran for this document.';

-- Staff queues can filter/order by the automated result.
create index if not exists documents_screening_status_idx
  on public.documents(screening_status);

commit;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- begin;
--   drop index if exists public.documents_screening_status_idx;
--   alter table public.documents
--     drop constraint if exists documents_screening_status_check,
--     drop column if exists screening_status,
--     drop column if exists screening_reason,
--     drop column if exists screening_quality,
--     drop column if exists screening_ocr_detected,
--     drop column if exists screening_checked_at;
-- commit;

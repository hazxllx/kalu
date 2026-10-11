-- =============================================================================
-- KALUSAGAP — Health Personnel Registration fixes
--
-- Three database-level reinforcements for the personnel (staff) registration
-- workflow, matching the API validation in
-- backend/src/validators/staffAccounts.validators.js and the frontend rules in
-- frontend/src/features/registration/pages/PersonnelRegistration.jsx:
--
--   1. staff_account_requests.phone must be an exact 11-digit PH mobile
--      (09XXXXXXXXX) or empty. Previously the column had no format constraint
--      and the API truncated to 30 characters, so malformed numbers could be
--      stored. The API now rejects anything else; this constraint is the
--      database backstop.
--
--   2. staff_registration_documents gains an explicit review_status that
--      defaults to 'pending_manual_review'. A document is NEVER recorded as
--      verified merely because it was uploaded — account activation stays a
--      manual approver decision on staff_account_requests.status.
--
-- Additive and idempotent-friendly: no row is deleted and no existing account
-- is rewritten beyond harmless phone-separator normalization.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Contact number format on staff_account_requests
-- ---------------------------------------------------------------------------
-- Normalize any legacy values that become valid once separators are removed
-- (e.g. "0917 123 4567" -> "09171234567"). Values that still cannot satisfy
-- the rule are left untouched; the NOT VALID constraint below does not reject
-- pre-existing rows, only new INSERT/UPDATE, so a push never fails on history.
update public.staff_account_requests
  set phone = regexp_replace(phone, '[[:space:]().-]', '', 'g')
  where regexp_replace(phone, '[[:space:]().-]', '', 'g') ~ '^09[0-9]{9}$'
    and phone <> regexp_replace(phone, '[[:space:]().-]', '', 'g');

alter table public.staff_account_requests
  drop constraint if exists staff_account_requests_phone_format;

-- Empty is allowed (the column default is '') or an exact 11-digit 09 number.
-- NOT VALID: enforced on every new write; existing rows are not retroactively
-- validated so the migration is safe to apply to any current data set.
alter table public.staff_account_requests
  add constraint staff_account_requests_phone_format
  check (
    btrim(phone) = '' or phone ~ '^09[0-9]{9}$'
  ) not valid;

comment on constraint staff_account_requests_phone_format
  on public.staff_account_requests is
  'Contact number must be an exact 11-digit PH mobile (09XXXXXXXXX) or empty. Mirrors isStrictMobile in the API and the frontend contact-number rule.';

-- ---------------------------------------------------------------------------
-- 2. Explicit per-document review status
-- ---------------------------------------------------------------------------
alter table public.staff_registration_documents
  add column if not exists review_status text not null default 'pending_manual_review';

alter table public.staff_registration_documents
  drop constraint if exists staff_registration_documents_review_status_check;

alter table public.staff_registration_documents
  add constraint staff_registration_documents_review_status_check
  check (review_status in ('pending_manual_review', 'verified', 'rejected'));

comment on column public.staff_registration_documents.review_status is
  'Verification state of an uploaded personnel document. Defaults to pending_manual_review; a document is never auto-verified on upload. Only authorized personnel change it, and account activation remains gated on staff_account_requests.status.';

commit;

-- =============================================================================
-- KALUSAGAP — Validation constraints
--
-- Adds database-level guards that mirror the API validators. Each constraint
-- was checked against existing data first (all rows satisfy it) and uses
-- `drop constraint if exists` + `add constraint` so it can be re-run safely.
--
-- Related (already present, not duplicated here):
--   - residents.verification_status CHECK                 (migration 6)
--   - households.families >= 1, monthly_income >= 0       (migration 4)
--   - households enums (hh_status/approval/water/toilet/risk)  (migration 4)
--   - household_members.age >= 0, sex/philhealth enums    (migration 4)
--
-- Reversible: see the rollback block at the bottom.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- residents: names must not be blank
-- ---------------------------------------------------------------------------
alter table public.residents drop constraint if exists residents_first_name_not_blank;
alter table public.residents
  add constraint residents_first_name_not_blank check (length(btrim(first_name)) > 0);

alter table public.residents drop constraint if exists residents_last_name_not_blank;
alter table public.residents
  add constraint residents_last_name_not_blank check (length(btrim(last_name)) > 0);

-- ---------------------------------------------------------------------------
-- residents: contact number is empty or a PH mobile number
-- ---------------------------------------------------------------------------
-- Separators (space, parentheses, dot, hyphen) are tolerated so a number stored
-- as "0917 123 4567" is accepted alongside the canonical "09171234567".
alter table public.residents drop constraint if exists residents_cellphone_no_format;
alter table public.residents
  add constraint residents_cellphone_no_format check (
    length(btrim(cellphone_no)) = 0
    or regexp_replace(cellphone_no, '[[:space:]().-]', '', 'g') ~ '^(\+63|0)9[0-9]{9}$'
  );

-- ---------------------------------------------------------------------------
-- households: contact number format (optional field)
-- ---------------------------------------------------------------------------
alter table public.households drop constraint if exists households_contact_format;
alter table public.households
  add constraint households_contact_format check (
    length(btrim(contact)) = 0
    or regexp_replace(contact, '[[:space:]().-]', '', 'g') ~ '^(\+63|0)9[0-9]{9}$'
  );

-- ---------------------------------------------------------------------------
-- resident_verification_logs: a rejection must carry a reason
-- ---------------------------------------------------------------------------
-- 'rejected' is also used to record a resubmission request, which requires a
-- reason too. Resident 'submitted'/'resubmitted' rows may have an empty reason.
alter table public.resident_verification_logs drop constraint if exists resident_verification_logs_reject_reason;
alter table public.resident_verification_logs
  add constraint resident_verification_logs_reject_reason
  check (action <> 'rejected' or length(btrim(reason)) > 0);

commit;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- begin;
--   alter table public.resident_verification_logs drop constraint if exists resident_verification_logs_reject_reason;
--   alter table public.households drop constraint if exists households_contact_format;
--   alter table public.residents drop constraint if exists residents_cellphone_no_format;
--   alter table public.residents drop constraint if exists residents_last_name_not_blank;
--   alter table public.residents drop constraint if exists residents_first_name_not_blank;
-- commit;

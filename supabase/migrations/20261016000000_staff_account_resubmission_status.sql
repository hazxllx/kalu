-- Staff account requests: add a "resubmission_required" decision status.
--
-- Mirrors the resident verification workflow, which already supports
-- `resubmission_required` (see 20260919100000_manual_resident_verification.sql).
-- A Health Supervisor / PHN can now ask a personnel applicant to correct and
-- resubmit instead of only approving or rejecting.
--
-- The decision audit trigger (public.log_staff_account_decision) fires on any
-- status change and writes `upper(new.status) || '_STAFF_ACCOUNT'` into
-- public.health_audit_logs.action, whose column has no CHECK constraint, so a
-- new `RESUBMISSION_REQUIRED_STAFF_ACCOUNT` audit action is produced with no
-- further schema change.
--
-- The partial unique index `staff_account_requests_open_email_uniq` is scoped
-- to `status in ('pending','approved')`; `resubmission_required` is therefore
-- treated like a rejected row and does not block the applicant from submitting
-- a fresh request — matching the established "resubmission after rejection is
-- allowed" rule.

alter table public.staff_account_requests
  drop constraint if exists staff_account_requests_status_check;

alter table public.staff_account_requests
  add constraint staff_account_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'resubmission_required'));

-- KALUSAGAP — resident follow-up confirmation workflow
--
-- Additive only. Extends the existing public.follow_ups table (migration
-- 20260922100000) so a staff-created follow-up can require the resident to
-- confirm (approve) or reject it before it becomes an approved/scheduled
-- calendar event. No table is created or dropped; no existing row is rewritten.
--
-- State model (reuses follow_ups, per the audited single-source calendar):
--   requires_resident_response = true  ->  status 'Pending', resident_decision 'pending'
--   resident approves                  ->  status 'Scheduled', resident_decision 'approved'
--   resident rejects                   ->  status 'Cancelled', resident_decision 'rejected'
--
-- 'Pending' is added to the status CHECK (the frontend badge vocabulary already
-- includes it). The reviewer decision + timestamp + reason are written only by
-- the backend from the authenticated resident session (service-role); a resident
-- user-token still cannot UPDATE follow_ups directly — the existing staff-only
-- update RLS policy is intentionally left unchanged, so the API remains the sole
-- write boundary for resident decisions.

begin;

-- 1. Allow the 'Pending' lifecycle status (awaiting the resident's response).
alter table public.follow_ups drop constraint if exists follow_ups_status_check;
alter table public.follow_ups
  add constraint follow_ups_status_check
  check (status in ('Scheduled', 'Pending', 'Today', 'Upcoming', 'Ongoing', 'Completed', 'Missed', 'Cancelled'));

-- 2. Resident-confirmation columns.
alter table public.follow_ups
  add column if not exists requires_resident_response boolean not null default false,
  add column if not exists resident_decision text
    check (resident_decision is null or resident_decision in ('pending', 'approved', 'rejected')),
  add column if not exists resident_decision_at timestamptz,
  add column if not exists resident_decision_reason text not null default '';

-- 3. Helpful index for "awaiting my response" lookups.
create index if not exists follow_ups_resident_decision_idx
  on public.follow_ups(resident_id, resident_decision);

commit;

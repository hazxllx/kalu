-- Treat an unanswered resident schedule as confirmed by default while keeping
-- explicit resident responses and staff-reviewed schedule requests distinct.
begin;

alter table public.health_referrals
  alter column schedule_response_status set default 'Default Confirmed';
alter table public.follow_ups
  alter column schedule_response_status set default 'Default Confirmed';

alter table public.health_referrals
  drop constraint if exists health_referrals_schedule_response_status_check;
alter table public.health_referrals
  add constraint health_referrals_schedule_response_status_check
  check (schedule_response_status in (
    'Awaiting Response', 'Default Confirmed', 'Attendance Confirmed',
    'Reschedule Requested', 'Reschedule Approved', 'Reschedule Rejected',
    'Cancellation Requested', 'Cancellation Approved', 'Cancellation Rejected'
  ));

alter table public.follow_ups
  drop constraint if exists follow_ups_schedule_response_status_check;
alter table public.follow_ups
  add constraint follow_ups_schedule_response_status_check
  check (schedule_response_status in (
    'Awaiting Response', 'Default Confirmed', 'Attendance Confirmed',
    'Reschedule Requested', 'Reschedule Approved', 'Reschedule Rejected',
    'Cancellation Requested', 'Cancellation Approved', 'Cancellation Rejected'
  ));

-- Existing unanswered schedules adopt the same default; explicit responses and
-- requests already in progress are preserved.
update public.health_referrals
set schedule_response_status = 'Default Confirmed'
where schedule_response_status = 'Awaiting Response';

update public.follow_ups
set schedule_response_status = 'Default Confirmed'
where schedule_response_status = 'Awaiting Response';

-- Remove the old second confirmation state from active follow-ups. Attendance,
-- reschedule, and cancellation responses now use schedule_response_status.
update public.follow_ups
set requires_resident_response = false,
    resident_decision = null,
    resident_decision_at = null,
    resident_decision_reason = '',
    status = case when status = 'Pending' then 'Scheduled' else status end
where status not in ('Completed', 'Missed', 'Cancelled', 'Rejected')
  and (requires_resident_response or resident_decision = 'pending' or status = 'Pending');

comment on column public.health_referrals.schedule_response_status is
  'Resident appointment response, separate from care progress. New and unanswered schedules default to Default Confirmed; residents may still request changes.';
comment on column public.follow_ups.schedule_response_status is
  'Resident appointment response, separate from follow-up progress. New and unanswered schedules default to Default Confirmed; residents may still request changes.';

commit;
notify pgrst, 'reload schema';

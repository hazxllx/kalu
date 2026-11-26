-- supabase/migrations/20261201130000_restore_bhs_report_delivery.sql
-- Re-route still-pending BHS reports created under the previous RHU inbox
-- workflow to the PHN inbox. Preserve records that have already been received,
-- reviewed, accepted, returned, or rejected.

begin;

update public.reports
set recipient_role = 'phn',
    recipient_facility_id = null
where sender_role = 'health_supervisor'
  and recipient_role = 'rhu_personnel'
  and status = 'Submitted'
  and submitted_at is not null;

commit;

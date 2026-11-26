-- supabase/migrations/20261119000000_scope_submitted_report_reads.sql
begin;

drop policy reports_select on public.reports;
create policy reports_select on public.reports
  for select to authenticated
  using (
    public.is_staff_active()
    and public.profile_role() in ('health_supervisor', 'phn', 'mho', 'rhu_personnel')
    and public.personnel_actor_has_permission(auth.uid(), 'reports.view')
    and municipality_id = public.profile_municipality_id()
    and (public.profile_role() <> 'health_supervisor' or barangay_id = public.profile_barangay_id())
    and (public.profile_role() <> 'rhu_personnel' or public.profile_facility_id() is not null)
    and (
      (created_by = auth.uid() and sender_role = public.profile_role())
      or (created_by <> auth.uid() and status <> 'Draft' and (
        (recipient_role = public.profile_role() and (
          recipient_role <> 'rhu_personnel' or recipient_facility_id = public.profile_facility_id()
        ))
        or (recipient_role = 'rhu_personnel' and public.profile_role() in ('phn', 'mho'))
      ))
    )
  );

-- Preserve the existing status/routing checks and also require permission for
-- updates that do not reference a row column (and may not use SELECT RLS).
create policy reports_update_access on public.reports
  as restrictive for update to authenticated
  using (
    public.is_staff_active()
    and municipality_id = public.profile_municipality_id()
    and (public.profile_role() <> 'health_supervisor' or barangay_id = public.profile_barangay_id())
    and (
      (created_by = auth.uid() and sender_role = public.profile_role()
        and public.personnel_actor_has_permission(auth.uid(), 'reports.generate'))
      or (created_by <> auth.uid() and recipient_role = public.profile_role()
        and public.personnel_actor_has_permission(auth.uid(), 'reports.view'))
    )
  );

-- The parent report's RLS also governs visibility of its history.
drop policy report_status_history_select on public.report_status_history;
create policy report_status_history_select on public.report_status_history
  for select to authenticated
  using (exists (select 1 from public.reports r where r.id = report_status_history.report_id));

commit;

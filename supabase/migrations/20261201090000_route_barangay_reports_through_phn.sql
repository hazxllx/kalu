-- Route Health Supervisor (BHS-level) reports to the PHN, then PHN reports
-- upward to the MHO. MHO is a recipient/monitoring role only.

begin;

-- PHN receives barangay reports; MHO can monitor municipal report status
-- across reports addressed to PHN and older RHU routes. Monitoring does not
-- grant the observer permission to acknowledge or review another role's row.
drop policy if exists reports_select on public.reports;
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
        or (recipient_role = 'phn' and public.profile_role() = 'mho')
      ))
    )
  );

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated
  with check (
    public.is_staff_active()
    and created_by = auth.uid()
    and public.profile_role() = sender_role
    and municipality_id = public.profile_municipality_id()
    and content is not null
    and content_schema_version = 1
    and reviewed_by is null
    and reviewed_at is null
    and (
      (status = 'Draft' and submitted_at is null)
      or (status = 'Submitted' and submitted_at is not null)
    )
    and (
      (sender_role = 'health_supervisor' and barangay_id = public.profile_barangay_id())
      or (sender_role = 'phn' and barangay_id is null)
    )
    and (
      (
        sender_role = 'health_supervisor'
        and recipient_role = 'phn'
        and recipient_facility_id is null
        and (
          status = 'Draft'
          or exists (
            select 1 from public.profiles p
            where p.role = 'phn' and p.status = 'active'
              and p.municipality_id = reports.municipality_id
          )
        )
      )
      or (
        sender_role = 'phn'
        and recipient_role = 'mho'
        and recipient_facility_id is null
        and (
          status = 'Draft'
          or exists (
            select 1 from public.profiles p
            where p.role = 'mho' and p.status = 'active'
              and p.municipality_id = reports.municipality_id
          )
        )
      )
    )
  );

create or replace function public.guard_report_review_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if old.status = 'Needs Revision'
       and new.status = 'Submitted'
       and old.created_by = auth.uid() then
      if new.created_by is distinct from old.created_by
         or new.sender_role is distinct from old.sender_role
         or new.recipient_role is distinct from old.recipient_role
         or new.municipality_id is distinct from old.municipality_id
         or new.barangay_id is distinct from old.barangay_id
         or new.report_type is distinct from old.report_type
         or new.report_period is distinct from old.report_period
         or new.submitted_at is null
         or new.reviewed_by is not null
         or new.reviewed_at is not null
         or new.received_by is not null
         or new.received_at is not null then
        raise exception 'reports: invalid report resubmission';
      end if;
      return new;
    end if;

    if new.created_by is distinct from old.created_by
       or new.sender_role is distinct from old.sender_role
       or new.recipient_role is distinct from old.recipient_role
       or new.municipality_id is distinct from old.municipality_id
       or new.barangay_id is distinct from old.barangay_id
       or new.report_type is distinct from old.report_type
       or new.report_period is distinct from old.report_period
       or new.title is distinct from old.title
       or new.content is distinct from old.content
       or new.content_schema_version is distinct from old.content_schema_version
       or new.submitted_at is distinct from old.submitted_at then
      raise exception 'reports: routing and submitted report details are immutable';
    end if;

    if old.status = 'Submitted' and new.status = 'Received'
       and old.received_by is null and old.received_at is null
       and new.recipient_role = 'rhu_personnel'
       and (
         public.profile_role() = 'rhu_personnel'
         or public.profile_role() = 'phn'
       )
       and new.received_by = auth.uid()
       and new.received_at is not null then
      if public.profile_role() = 'rhu_personnel'
         and new.recipient_facility_id is distinct from public.profile_facility_id() then
        raise exception 'reports: receipt is outside the assigned RHU facility';
      end if;
    elsif new.status is distinct from old.status then
      if new.created_by = auth.uid() then
        raise exception 'reports: senders cannot review their own submissions';
      end if;
      if old.status = 'Submitted' and new.status = 'Received' then
        null;
      elsif (old.status = 'Received' and new.status in ('Reviewed', 'Needs Revision', 'Rejected')
             and new.recipient_role = 'rhu_personnel'
             and public.profile_role() = 'rhu_personnel') then
        null;
      elsif (old.status = 'Received' and new.status in ('Reviewed', 'Needs Revision', 'Rejected')
             and new.recipient_role = 'phn'
             and public.profile_role() = 'phn') then
        null;
      elsif (old.status = 'Received' and new.status in ('Reviewed', 'Needs Revision', 'Rejected')
             and new.recipient_role = 'mho'
             and public.profile_role() = 'mho') then
        null;
      else
        raise exception 'reports: invalid status transition';
      end if;
      if new.status <> 'Received' and new.reviewed_by is distinct from auth.uid() then
        raise exception 'reports: review actor must match the authenticated user';
      end if;
    end if;

    if new.status in ('Needs Revision', 'Rejected')
       and nullif(btrim(new.remarks), '') is null then
      raise exception 'reports: a revision or rejection explanation is required';
    end if;
  end if;
  return new;
end;
$$;

comment on policy reports_insert on public.reports is
  'Only Health Supervisors may submit to PHN and PHN may submit to MHO; MHO is recipient-only.';

commit;

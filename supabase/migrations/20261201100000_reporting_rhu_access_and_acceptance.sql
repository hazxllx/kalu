-- supabase/migrations/20261201100000_reporting_rhu_access_and_acceptance.sql
-- Formal reporting is Health Supervisor -> PHN -> MHO. RHU clinical staff
-- retain their clinical workflows but no longer receive or review reports.
begin;

alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check
  check (status in ('Draft', 'Submitted', 'Received', 'Reviewed', 'Accepted', 'Needs Revision', 'Rejected'));

drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports
  for select to authenticated
  using (
    public.is_staff_active()
    and public.profile_role() in ('health_supervisor', 'phn', 'mho')
    and public.personnel_actor_has_permission(auth.uid(), 'reports.view')
    and municipality_id = public.profile_municipality_id()
    and (public.profile_role() <> 'health_supervisor' or barangay_id = public.profile_barangay_id())
    and (
      (created_by = auth.uid() and sender_role = public.profile_role())
      or (created_by <> auth.uid() and status <> 'Draft' and recipient_role = public.profile_role()
        and ((public.profile_role() = 'phn' and sender_role = 'health_supervisor')
          or (public.profile_role() = 'mho' and sender_role = 'phn')))
    )
  );

drop policy if exists reports_update_access on public.reports;
create policy reports_update_access on public.reports
  as restrictive for update to authenticated
  using (
    public.is_staff_active()
    and municipality_id = public.profile_municipality_id()
    and (public.profile_role() <> 'health_supervisor' or barangay_id = public.profile_barangay_id())
    and (
      (created_by = auth.uid() and sender_role = public.profile_role()
        and public.profile_role() in ('health_supervisor', 'phn')
        and public.personnel_actor_has_permission(auth.uid(), 'reports.generate'))
      or (created_by <> auth.uid() and recipient_role = public.profile_role()
        and public.profile_role() in ('phn', 'mho')
        and public.personnel_actor_has_permission(auth.uid(), 'reports.view'))
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
    if old.status = 'Needs Revision' and new.status = 'Submitted' and old.created_by = auth.uid() then
      if new.created_by is distinct from old.created_by
         or new.sender_role is distinct from old.sender_role
         or new.recipient_role is distinct from old.recipient_role
         or new.municipality_id is distinct from old.municipality_id
         or new.barangay_id is distinct from old.barangay_id
         or new.report_type is distinct from old.report_type
         or new.report_period is distinct from old.report_period
         or new.title is distinct from old.title
         or new.submitted_at is null
         or new.reviewed_by is not null or new.reviewed_at is not null
         or new.received_by is not null or new.received_at is not null then
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

    if new.status is not distinct from old.status then
      if new.remarks is distinct from old.remarks
         or new.reviewed_by is distinct from old.reviewed_by
         or new.reviewed_at is distinct from old.reviewed_at
         or new.received_by is distinct from old.received_by
         or new.received_at is distinct from old.received_at then
        raise exception 'reports: review details may only change with a valid status transition';
      end if;
      return new;
    end if;

    if new.created_by = auth.uid() then
      raise exception 'reports: senders cannot review their own submissions';
    end if;

    if old.status = 'Submitted' and new.status = 'Received'
       and old.recipient_role in ('phn', 'mho')
       and public.profile_role() = old.recipient_role
       and old.received_by is null and old.received_at is null
       and new.received_by = auth.uid() and new.received_at is not null
       and new.reviewed_by is not distinct from old.reviewed_by
       and new.reviewed_at is not distinct from old.reviewed_at then
      return new;
    end if;

    if old.recipient_role not in ('phn', 'mho')
       or public.profile_role() <> old.recipient_role
       or new.received_by is distinct from old.received_by
       or new.received_at is distinct from old.received_at
       or new.reviewed_by is distinct from auth.uid()
       or new.reviewed_at is null then
      raise exception 'reports: only the addressed PHN or MHO may review this report';
    end if;

    if not (
      (old.status = 'Received' and new.status in ('Reviewed', 'Needs Revision', 'Rejected'))
      or (old.status = 'Reviewed' and new.status in ('Accepted', 'Needs Revision', 'Rejected'))
    ) then
      raise exception 'reports: invalid status transition';
    end if;

    if new.status in ('Needs Revision', 'Rejected') and nullif(btrim(new.remarks), '') is null then
      raise exception 'reports: a revision or rejection explanation is required';
    end if;
  end if;
  return new;
end;
$$;

comment on policy reports_select on public.reports is
  'Health Supervisors read their own barangay reports; PHNs receive those reports and MHO receives PHN reports. RHU roles have no report access.';
commit;

-- The resident-risk screening wrapper delegates authorization to the
-- underlying function. Extend that same scope to RHU staff only for residents
-- inside the assigned RHU facility and municipality.
create or replace function public.resident_risk_for_ids_without_screening(p_resident_ids text[], p_actor_id uuid default null)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare actor public.profiles%rowtype; configuration jsonb; result jsonb;
begin
  if coalesce(cardinality(p_resident_ids), 0) > 1000 then
    raise exception using errcode = '22023', message = 'Risk detail requests must be paginated.';
  end if;
  if p_actor_id is not null then
    select * into actor from public.profiles where id = p_actor_id;
    if not found or not coalesce(actor.status::text = 'active' or
      (actor.role::text = 'resident' and actor.status::text = 'pending_verification'), false) then
      raise exception using errcode = '42501', message = 'An active authorized account is required.';
    end if;
  end if;
  configuration := public.analytics_risk_configuration();
  select coalesce(jsonb_agg(public.analytics_resident_risk(r.id, configuration, true)
    || jsonb_build_object('residentId', r.id) order by r.id), '[]'::jsonb) into result
  from public.residents r where r.id = any(p_resident_ids) and (
    p_actor_id is null
    or (actor.role::text = 'resident' and r.auth_user_id = actor.id)
    or (r.municipality_id = actor.municipality_id and (
      actor.role::text in ('mho', 'phn')
      or (actor.role::text in ('health_supervisor', 'bhw') and r.barangay_id = actor.barangay_id)
      or (actor.role::text = 'rhu_personnel' and exists (
        select 1 from public.facilities f
        where f.id = actor.facility_id and f.type = 'rhu'
          and f.municipality_id = actor.municipality_id
          and (f.barangay_id is null or f.barangay_id = r.barangay_id)
      ))
    ))
  );
  return result;
end;
$$;

revoke all on function public.resident_risk_for_ids_without_screening(text[], uuid) from public, anon, authenticated;
grant execute on function public.resident_risk_for_ids_without_screening(text[], uuid) to service_role;
notify pgrst, 'reload schema';

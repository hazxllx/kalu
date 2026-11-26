-- supabase/migrations/20261124100000_kft_followup_completion_and_rhu_receipt.sql
begin;

-- KFT-020: retain the staff account that completes a follow-up.
alter table public.follow_ups
  add column if not exists completed_by uuid references public.profiles(id) on delete set null;

create index if not exists follow_ups_completed_by_idx
  on public.follow_ups(completed_by, completed_at);

-- KFT-025: retain receipt separately from later review decisions.
alter table public.reports
  add column if not exists received_by uuid references public.profiles(id) on delete set null,
  add column if not exists received_at timestamptz;

comment on column public.reports.received_by is
  'Account that changed an RHU report from Submitted to Received.';
comment on column public.reports.received_at is
  'Exact timestamp when an RHU report was received.';

create or replace function public.guard_follow_up_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.status = 'Completed' and old.status is distinct from 'Completed' then
      if public.profile_role() not in ('health_supervisor', 'phn')
         or not public.personnel_actor_has_permission(auth.uid(), 'followups.complete') then
        raise exception 'follow-ups: only authorized staff may complete follow-ups'
          using errcode = '42501';
      end if;
      if new.completed_by is distinct from auth.uid()
         or new.completed_at is null then
        raise exception 'follow-ups: completion actor and timestamp are required'
          using errcode = '42501';
      end if;
    end if;
    if new.status is distinct from 'Completed'
       and old.status = 'Completed'
       and new.status is distinct from old.status then
      raise exception 'follow-ups: completed follow-ups are terminal'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists follow_up_completion_guard on public.follow_ups;
create trigger follow_up_completion_guard
  before update of status, completed_at, completed_by on public.follow_ups
  for each row execute function public.guard_follow_up_completion();

-- Preserve receipt identity and timestamp while later review status changes.
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

create or replace function public.record_report_status_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.report_status_history
      (report_id, actor_id, action, previous_status, new_status, explanation)
    values (
      new.id,
      new.created_by,
      case when new.status = 'Draft' then 'DRAFT_CREATED' else 'SUBMITTED' end,
      null,
      new.status,
      new.remarks
    );
  elsif new.status is distinct from old.status then
    insert into public.report_status_history
      (report_id, actor_id, action, previous_status, new_status, explanation)
    values (
      new.id,
      case
        when new.status = 'Received' then new.received_by
        when new.status = 'Submitted' and old.status = 'Needs Revision' then new.created_by
        else new.reviewed_by
      end,
      case when new.status = 'Submitted' and old.status = 'Needs Revision'
        then 'RESUBMITTED' else 'STATUS_CHANGED' end,
      old.status,
      new.status,
      case
        when new.status in ('Needs Revision', 'Rejected') then new.remarks
        when new.remarks is distinct from old.remarks then new.remarks
        else ''
      end
    );
  end if;
  return new;
end;
$$;

drop policy if exists reports_update_access on public.reports;
create policy reports_update_access on public.reports
  as restrictive for update to authenticated
  using (
    public.is_staff_active()
    and municipality_id = public.profile_municipality_id()
    and (
      (created_by = auth.uid() and sender_role = public.profile_role()
        and public.personnel_actor_has_permission(auth.uid(), 'reports.generate'))
      or (created_by <> auth.uid() and recipient_role = public.profile_role()
        and public.personnel_actor_has_permission(auth.uid(), 'reports.view'))
      or (
        created_by <> auth.uid()
        and recipient_role = 'rhu_personnel'
        and public.profile_role() = 'phn'
        and public.personnel_actor_has_permission(auth.uid(), 'reports.view')
      )
    )
  );

commit;

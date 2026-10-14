begin;

create table if not exists public.report_status_history (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  previous_status text,
  new_status text not null,
  explanation text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists report_status_history_report_idx
  on public.report_status_history (report_id, created_at, id);

alter table public.reports
  drop constraint if exists reports_status_check;
alter table public.reports
  add constraint reports_status_check
  check (status in ('Draft', 'Submitted', 'Received', 'Reviewed', 'Needs Revision', 'Rejected'));

alter table public.report_status_history enable row level security;
grant select on public.report_status_history to authenticated;
grant all on public.report_status_history to service_role;

drop policy if exists report_status_history_select on public.report_status_history;
create policy report_status_history_select on public.report_status_history
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.reports r
      where r.id = report_status_history.report_id
        and (
          r.created_by = auth.uid()
          or (
            public.is_staff_active()
            and r.municipality_id = public.profile_municipality_id()
            and (
              (public.profile_role() = r.recipient_role and r.recipient_role <> 'rhu_personnel')
              or (public.profile_role() = 'rhu_personnel' and r.recipient_role = 'rhu_personnel')
              or (public.profile_role() in ('phn', 'mho') and r.recipient_role = 'rhu_personnel')
            )
          )
        )
    )
  );

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
      case when new.status = 'Submitted' and old.status = 'Needs Revision'
        then new.created_by else new.reviewed_by end,
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

drop trigger if exists reports_status_history on public.reports;
create trigger reports_status_history
  after insert or update of status on public.reports
  for each row execute function public.record_report_status_history();

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
         or new.reviewed_at is not null then
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
    if new.reviewed_by is distinct from auth.uid() then
      raise exception 'reports: review actor must match the authenticated user';
    end if;
    if new.status is not distinct from old.status
       and (
         new.remarks is distinct from old.remarks
         or new.reviewed_by is distinct from old.reviewed_by
         or new.reviewed_at is distinct from old.reviewed_at
       ) then
      raise exception 'reports: review details may only change with a valid status transition';
    end if;
    if new.status is distinct from old.status then
      if new.created_by = auth.uid() then
        raise exception 'reports: senders cannot review their own submissions';
      end if;
      if (old.status = 'Submitted' and new.status <> 'Received')
         or (old.status = 'Received' and new.status not in ('Reviewed', 'Needs Revision', 'Rejected'))
         or old.status not in ('Submitted', 'Received') then
        raise exception 'reports: invalid status transition';
      end if;
      if new.recipient_role = 'mho' and public.profile_role() <> 'mho' then
        raise exception 'reports: only the MHO may decide reports addressed to the MHO';
      end if;
      if new.recipient_role = 'rhu_personnel' and public.profile_role() <> 'rhu_personnel' then
        raise exception 'reports: only RHU Personnel may decide reports addressed to the RHU';
      end if;
    end if;
    if new.status in ('Needs Revision', 'Rejected') and nullif(btrim(new.remarks), '') is null then
      raise exception 'reports: a revision or rejection explanation is required';
    end if;
  end if;
  return new;
end;
$$;

commit;

begin;

alter table public.reports
  add column if not exists recipient_facility_id uuid
    references public.facilities(id) on delete restrict;

comment on column public.reports.recipient_facility_id is
  'RHU facility authorized to receive this report; NULL for non-RHU recipients and legacy rows.';

create index if not exists reports_rhu_inbox_idx
  on public.reports (recipient_facility_id, status, submitted_at desc)
  where recipient_role = 'rhu_personnel';

drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports
  for select to authenticated
  using (
    public.is_admin()
    or created_by = auth.uid()
    or (
      public.is_staff_active()
      and municipality_id = public.profile_municipality_id()
      and (
        (
          public.profile_role() = 'rhu_personnel'
          and recipient_role = 'rhu_personnel'
          and recipient_facility_id = public.profile_facility_id()
          and status <> 'Draft'
        )
        or (
          public.profile_role() in ('phn', 'mho')
          and recipient_role = 'rhu_personnel'
          and status <> 'Draft'
        )
        or (
          recipient_role <> 'rhu_personnel'
          and public.profile_role() = recipient_role
          and (
            public.profile_role() in ('phn', 'mho')
            or barangay_id is null
            or public.profile_covers_barangay(barangay_id)
          )
        )
      )
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
      (public.profile_role() = 'health_supervisor' and barangay_id = public.profile_barangay_id())
      or (public.profile_role() <> 'health_supervisor' and barangay_id is null)
    )
    and (
      (sender_role = 'phn' and recipient_role = 'mho' and recipient_facility_id is null)
      or (sender_role = 'mho' and recipient_role = 'mho' and recipient_facility_id is null)
      or (
        sender_role = 'health_supervisor'
        and recipient_role = 'rhu_personnel'
        and recipient_facility_id is not null
        and exists (
          select 1
          from public.facilities f
          where f.id = reports.recipient_facility_id
            and f.municipality_id = reports.municipality_id
            and f.type = 'rhu'
            and exists (
              select 1
              from public.profiles p
              where p.role = 'rhu_personnel'
                and p.status = 'active'
                and p.municipality_id = reports.municipality_id
                and p.facility_id = f.id
            )
            and (
              (
                f.barangay_id = reports.barangay_id
                and (
                  select count(*)
                  from public.facilities exact_facility
                  where exact_facility.municipality_id = reports.municipality_id
                    and exact_facility.type = 'rhu'
                    and exact_facility.barangay_id = reports.barangay_id
                ) = 1
              )
              or (
                not exists (
                  select 1
                  from public.facilities exact_facility
                  where exact_facility.municipality_id = reports.municipality_id
                    and exact_facility.type = 'rhu'
                    and exact_facility.barangay_id = reports.barangay_id
                )
                and (
                  (
                    select count(*)
                    from public.facilities only_facility
                    where only_facility.municipality_id = reports.municipality_id
                      and only_facility.type = 'rhu'
                  ) = 1
                  or (
                    f.barangay_id is null
                    and (
                      select count(*)
                      from public.facilities unassigned_facility
                      where unassigned_facility.municipality_id = reports.municipality_id
                        and unassigned_facility.type = 'rhu'
                        and unassigned_facility.barangay_id is null
                    ) = 1
                  )
                )
              )
            )
        )
      )
    )
  );

drop policy if exists reports_update on public.reports;
create policy reports_update on public.reports
  for update to authenticated
  using (
    public.is_admin()
    or (
      created_by = auth.uid()
      and status in ('Draft', 'Needs Revision')
    )
    or (
      public.is_staff_active()
      and municipality_id = public.profile_municipality_id()
      and (
        (
          public.profile_role() = 'rhu_personnel'
          and recipient_role = 'rhu_personnel'
          and recipient_facility_id = public.profile_facility_id()
          and status in ('Submitted', 'Received')
        )
        or (
          recipient_role <> 'rhu_personnel'
          and public.profile_role() = recipient_role
          and status in ('Submitted', 'Received')
          and (
            public.profile_role() in ('phn', 'mho')
            or barangay_id is null
            or public.profile_covers_barangay(barangay_id)
          )
        )
      )
    )
  )
  with check (
    public.is_admin()
    or (created_by = auth.uid() and status = 'Submitted')
    or (
      public.is_staff_active()
      and municipality_id = public.profile_municipality_id()
      and status in ('Received', 'Reviewed', 'Needs Revision', 'Rejected')
      and (
        (
          public.profile_role() = 'rhu_personnel'
          and recipient_role = 'rhu_personnel'
          and recipient_facility_id = public.profile_facility_id()
        )
        or (
          recipient_role <> 'rhu_personnel'
          and public.profile_role() = recipient_role
          and (
            public.profile_role() in ('phn', 'mho')
            or barangay_id is null
            or public.profile_covers_barangay(barangay_id)
          )
        )
      )
    )
  );

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
              (
                public.profile_role() = 'rhu_personnel'
                and r.recipient_role = 'rhu_personnel'
                and r.recipient_facility_id = public.profile_facility_id()
              )
              or (
                public.profile_role() in ('phn', 'mho')
                and r.recipient_role = 'rhu_personnel'
              )
              or (
                r.recipient_role <> 'rhu_personnel'
                and public.profile_role() = r.recipient_role
              )
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
      case
        when new.status = 'Submitted' and old.status in ('Draft', 'Needs Revision') then new.created_by
        else new.reviewed_by
      end,
      case
        when new.status = 'Submitted' and old.status = 'Draft' then 'SUBMITTED'
        when new.status = 'Submitted' and old.status = 'Needs Revision' then 'RESUBMITTED'
        else 'STATUS_CHANGED'
      end,
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

create or replace function public.guard_report_review_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if old.status in ('Draft', 'Needs Revision')
     and new.status = 'Submitted'
     and old.created_by = auth.uid() then
    if new.created_by is distinct from old.created_by
       or new.sender_role is distinct from old.sender_role
       or new.recipient_role is distinct from old.recipient_role
       or new.recipient_facility_id is distinct from old.recipient_facility_id
       or new.municipality_id is distinct from old.municipality_id
       or new.barangay_id is distinct from old.barangay_id
       or new.report_type is distinct from old.report_type
       or new.report_period is distinct from old.report_period
       or new.title is distinct from old.title
       or (old.status = 'Draft' and (
         new.content is distinct from old.content
         or new.content_schema_version is distinct from old.content_schema_version
       ))
       or new.content is null
       or new.content_schema_version <> 1
       or new.submitted_at is null
       or new.reviewed_by is not null
       or new.reviewed_at is not null
       or new.remarks is distinct from old.remarks
       or new.sender_role is distinct from public.profile_role()
       or new.municipality_id is distinct from public.profile_municipality_id()
       or (
         new.sender_role = 'health_supervisor'
         and new.barangay_id is distinct from public.profile_barangay_id()
       ) then
      raise exception 'reports: invalid report submission';
    end if;
    return new;
  end if;

  if new.created_by is distinct from old.created_by
     or new.sender_role is distinct from old.sender_role
     or new.recipient_role is distinct from old.recipient_role
     or new.recipient_facility_id is distinct from old.recipient_facility_id
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
  if new.status is not distinct from old.status then
    if new.remarks is distinct from old.remarks
       or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at then
      raise exception 'reports: review details may only change with a valid status transition';
    end if;
    return new;
  end if;
  if new.created_by = auth.uid()
     or new.reviewed_at is null
     or (old.status = 'Submitted' and new.status <> 'Received')
     or (old.status = 'Received' and new.status not in ('Reviewed', 'Needs Revision', 'Rejected'))
     or old.status not in ('Submitted', 'Received') then
    raise exception 'reports: invalid status transition';
  end if;
  if new.recipient_role = 'rhu_personnel'
     and (
       public.profile_role() <> 'rhu_personnel'
       or new.recipient_facility_id is distinct from public.profile_facility_id()
     ) then
    raise exception 'reports: only personnel at the addressed RHU may review this report';
  end if;
  if new.recipient_role <> 'rhu_personnel'
     and public.profile_role() <> new.recipient_role then
    raise exception 'reports: only the addressed recipient may review this report';
  end if;
  if new.status in ('Needs Revision', 'Rejected') and nullif(btrim(new.remarks), '') is null then
    raise exception 'reports: a revision or rejection explanation is required';
  end if;
  return new;
end;
$$;

commit;

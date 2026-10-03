-- Keep report delivery aligned with the role-routed API workflow.
-- Health Supervisor reports are addressed to RHU. RHU Personnel cannot use the
-- report API, while PHN/MHO have scoped operational oversight.

begin;

drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.profile_role() <> 'rhu_personnel'
      and (
        created_by = auth.uid()
        or (
          public.is_staff_active()
          and municipality_id = public.profile_municipality_id()
          and (
            (
              public.profile_role() = recipient_role
              and recipient_role <> 'rhu_personnel'
              and (
                public.profile_role() in ('phn', 'mho')
                or barangay_id is null
                or public.profile_covers_barangay(barangay_id)
              )
            )
            or (
              public.profile_role() in ('phn', 'mho')
              and recipient_role = 'rhu_personnel'
              and status <> 'Draft'
            )
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
    and (
      (public.profile_role() = 'health_supervisor' and barangay_id = public.profile_barangay_id())
      or (public.profile_role() <> 'health_supervisor' and barangay_id is null)
    )
    and (
      (sender_role = 'phn' and recipient_role = 'mho')
      or (sender_role = 'health_supervisor' and recipient_role = 'rhu_personnel')
      or (sender_role = 'mho' and recipient_role = 'mho')
    )
  );

drop policy if exists reports_update on public.reports;
create policy reports_update on public.reports
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and (
        (public.profile_role() = recipient_role and recipient_role <> 'rhu_personnel')
        or (
          public.profile_role() in ('phn', 'mho')
          and recipient_role = 'rhu_personnel'
          and status <> 'Draft'
        )
      )
      and municipality_id = public.profile_municipality_id()
      and (
        public.profile_role() in ('phn', 'mho')
        or barangay_id is null
        or public.profile_covers_barangay(barangay_id)
      )
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and (
        (public.profile_role() = recipient_role and recipient_role <> 'rhu_personnel')
        or (
          public.profile_role() in ('phn', 'mho')
          and recipient_role = 'rhu_personnel'
          and status <> 'Draft'
        )
      )
      and municipality_id = public.profile_municipality_id()
      and (
        public.profile_role() in ('phn', 'mho')
        or barangay_id is null
        or public.profile_covers_barangay(barangay_id)
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
    if new.created_by is distinct from old.created_by
       or new.sender_role is distinct from old.sender_role
       or new.recipient_role is distinct from old.recipient_role
       or new.municipality_id is distinct from old.municipality_id
       or new.barangay_id is distinct from old.barangay_id
       or new.report_type is distinct from old.report_type
       or new.report_period is distinct from old.report_period
       or new.title is distinct from old.title
       or new.submitted_at is distinct from old.submitted_at then
      raise exception 'reports: routing and submitted report details are immutable';
    end if;
    if new.reviewed_by is distinct from auth.uid() then
      raise exception 'reports: review actor must match the authenticated user';
    end if;
    if old.status = 'Draft' or new.status not in ('Received', 'Reviewed', 'Rejected') then
      raise exception 'reports: invalid recipient status';
    end if;
    if new.status = 'Rejected' and nullif(btrim(new.remarks), '') is null then
      raise exception 'reports: rejection requires a reason';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists reports_guard_review_update on public.reports;
create trigger reports_guard_review_update
  before update on public.reports
  for each row execute function public.guard_report_review_update();

commit;
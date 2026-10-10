begin;

-- RHU Personnel are the routed recipients of Health Supervisor reports. They
-- must be able to read and review only reports explicitly addressed to their
-- role within their municipality.
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
          and status <> 'Draft'
        )
        or (
          public.profile_role() <> 'rhu_personnel'
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

drop policy if exists reports_update on public.reports;
create policy reports_update on public.reports
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and municipality_id = public.profile_municipality_id()
      and (
        (
          public.profile_role() = 'rhu_personnel'
          and recipient_role = 'rhu_personnel'
          and status <> 'Draft'
        )
        or (
          public.profile_role() <> 'rhu_personnel'
          and (
            (public.profile_role() = recipient_role and recipient_role <> 'rhu_personnel')
            or (
              public.profile_role() in ('phn', 'mho')
              and recipient_role = 'rhu_personnel'
              and status <> 'Draft'
            )
          )
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
    or (
      public.is_staff_active()
      and municipality_id = public.profile_municipality_id()
      and (
        (public.profile_role() = 'rhu_personnel' and recipient_role = 'rhu_personnel' and status <> 'Draft')
        or (
          public.profile_role() <> 'rhu_personnel'
          and (
            (public.profile_role() = recipient_role and recipient_role <> 'rhu_personnel')
            or (
              public.profile_role() in ('phn', 'mho')
              and recipient_role = 'rhu_personnel'
              and status <> 'Draft'
            )
          )
          and (
            public.profile_role() in ('phn', 'mho')
            or barangay_id is null
            or public.profile_covers_barangay(barangay_id)
          )
        )
      )
    )
  );

-- Prevent a sender from creating the same routed report more than once for a
-- reporting period. Drafts may be saved repeatedly; submitted reports may not.
create unique index if not exists reports_submitted_duplicate_idx
  on public.reports (created_by, report_type, report_period, recipient_role)
  where status <> 'Draft';

commit;

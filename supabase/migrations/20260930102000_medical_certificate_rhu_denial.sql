-- RHU Personnel are not authorized to access or prepare medical certificates.
-- Preserve the existing scope rules for every other role and add an explicit
-- database-layer exclusion for RHU Personnel.

begin;

drop policy if exists medical_certificates_select on public.medical_certificates;
create policy medical_certificates_select on public.medical_certificates
  for select to authenticated
  using (
    public.is_admin() or (
      public.is_staff_active()
      and public.profile_role() <> 'rhu_personnel'
      and (
        (public.profile_role() in ('mho', 'phn') and municipality_id = public.profile_municipality_id())
        or (public.profile_role() = 'health_supervisor' and barangay_id = public.profile_barangay_id())
      )
    ) or exists (
      select 1 from public.residents r
      where r.id = medical_certificates.resident_id and r.auth_user_id = auth.uid()
    )
  );

drop policy if exists medical_certificates_insert on public.medical_certificates;
create policy medical_certificates_insert on public.medical_certificates
  for insert to authenticated
  with check (
    public.is_staff_active()
    and public.profile_role() <> 'rhu_personnel'
    and public.profile_covers_barangay(barangay_id)
  );

drop policy if exists medical_certificates_update on public.medical_certificates;
create policy medical_certificates_update on public.medical_certificates
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() <> 'rhu_personnel'
      and public.profile_covers_barangay(barangay_id)
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() <> 'rhu_personnel'
      and public.profile_covers_barangay(barangay_id)
    )
  );

drop policy if exists medical_certificate_logs_select on public.medical_certificate_logs;
create policy medical_certificate_logs_select on public.medical_certificate_logs
  for select to authenticated
  using (
    public.is_admin() or (
      public.is_staff_active()
      and public.profile_role() <> 'rhu_personnel'
      and exists (
        select 1 from public.medical_certificates mc
        where mc.id = medical_certificate_logs.certificate_id
          and (
            (public.profile_role() in ('mho', 'phn') and mc.municipality_id = public.profile_municipality_id())
            or (public.profile_role() = 'health_supervisor' and mc.barangay_id = public.profile_barangay_id())
          )
      )
    ) or exists (
      select 1
      from public.medical_certificates mc
      join public.residents r on r.id = mc.resident_id
      where mc.id = medical_certificate_logs.certificate_id and r.auth_user_id = auth.uid()
    )
  );

commit;
-- Keep RHU Personnel's health-service reads behind the consultation-specific
-- backend endpoint. Other Health Services catalog readers retain their current
-- municipality/barangay scope; an RHU user may still read a service they
-- created or were explicitly assigned, but not the general municipality list.

begin;

drop policy if exists health_services_select on public.health_services;
create policy health_services_select on public.health_services
  for select to authenticated
  using (
    public.is_admin()
    or created_by = auth.uid()
    or (
      public.is_staff_active()
      and municipality_id = public.profile_municipality_id()
      and (
        (
          barangay_id is null
          and public.profile_role() in ('mho', 'phn')
        )
        or (
          barangay_id is not null
          and public.profile_role() in ('mho', 'phn', 'health_supervisor', 'bhw')
          and public.profile_covers_barangay(barangay_id)
        )
      )
    )
    or public.user_assigned_to_health_service(id)
  );

commit;

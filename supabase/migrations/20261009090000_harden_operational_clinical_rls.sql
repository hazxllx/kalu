-- KALUSAGAP - Restrict direct writes to operational clinical records
--
-- The Express API already excludes BHW from these workflows. These policies
-- make the same boundary apply to authenticated Supabase clients so the API
-- cannot be bypassed through PostgREST.

begin;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['follow_ups','tcl_entries','maternal_records','immunizations'] loop
    execute format('drop policy if exists %I_insert on public.%I', table_name, table_name);
    execute format('drop policy if exists %I_update on public.%I', table_name, table_name);

    execute format($policy$
      create policy %I_insert on public.%I
      for insert to authenticated
      with check (
        public.is_staff_active()
        and (
          (
            public.profile_role() in ('mho', 'phn', 'rhu_personnel')
            and municipality_id = public.profile_municipality_id()
          )
          or (
            public.profile_role() = 'health_supervisor'
            and public.profile_covers_barangay(barangay_id)
          )
        )
      )
    $policy$, table_name, table_name);

    execute format($policy$
      create policy %I_update on public.%I
      for update to authenticated
      using (
        public.is_admin()
        or (
          public.is_staff_active()
          and (
            (
              public.profile_role() in ('mho', 'phn', 'rhu_personnel')
              and municipality_id = public.profile_municipality_id()
            )
            or (
              public.profile_role() = 'health_supervisor'
              and public.profile_covers_barangay(barangay_id)
            )
          )
        )
      )
      with check (
        public.is_admin()
        or (
          public.is_staff_active()
          and (
            (
              public.profile_role() in ('mho', 'phn', 'rhu_personnel')
              and municipality_id = public.profile_municipality_id()
            )
            or (
              public.profile_role() = 'health_supervisor'
              and public.profile_covers_barangay(barangay_id)
            )
          )
        )
      )
    $policy$, table_name, table_name);
  end loop;
end $$;

commit;

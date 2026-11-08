-- =============================================================================
-- Harden health_referrals WRITE policies to match the READ boundary.
--
-- The read policy (20260928150200) restricts referrals to MHO / PHN /
-- Health Supervisor (plus residents reading their own), but the INSERT /
-- UPDATE / DELETE policies (20260923100000) still used
-- profile_covers_barangay(barangay_id), which is true for RHU Personnel
-- (municipality-wide) and BHW (own barangay). That let a BHW or RHU Personnel
-- write referral rows they cannot SELECT — an inconsistent, over-permissive
-- boundary.
--
-- This migration re-scopes the write policies to the same role set as the
-- read policy: mho, phn, health_supervisor (barangay-scoped for the Health
-- Supervisor), plus admin. BHW and RHU Personnel can no longer insert, update
-- or delete referrals. Residents never write referrals (they only read their
-- own), so no resident branch is added here.
-- =============================================================================

-- INSERT: only admin or the referral roles, scoped to the caller's barangay.
drop policy if exists health_referrals_insert on public.health_referrals;
create policy health_referrals_insert on public.health_referrals
  for insert to authenticated
  with check (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn') and public.profile_covers_barangay(barangay_id))
        or (public.profile_role() = 'health_supervisor' and public.profile_covers_barangay(barangay_id))
      )
    )
  );

-- UPDATE: same scope as INSERT.
drop policy if exists health_referrals_update on public.health_referrals;
create policy health_referrals_update on public.health_referrals
  for update to authenticated
  using (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn') and public.profile_covers_barangay(barangay_id))
        or (public.profile_role() = 'health_supervisor' and public.profile_covers_barangay(barangay_id))
      )
    )
  )
  with check (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn') and public.profile_covers_barangay(barangay_id))
        or (public.profile_role() = 'health_supervisor' and public.profile_covers_barangay(barangay_id))
      )
    )
  );

-- DELETE: same scope as INSERT/UPDATE.
drop policy if exists health_referrals_delete on public.health_referrals;
create policy health_referrals_delete on public.health_referrals
  for delete to authenticated
  using (
    public.is_admin() or (
      public.is_staff_active() and (
        (public.profile_role() in ('mho', 'phn') and public.profile_covers_barangay(barangay_id))
        or (public.profile_role() = 'health_supervisor' and public.profile_covers_barangay(barangay_id))
      )
    )
  );

-- Re-scope the security-definer personnel lookup functions so anon / any
-- authenticated client can no longer call them to read staff profile data
-- (email, position, license) without going through RLS. The backend uses the
-- service-role key, so grant EXECUTE to service_role only.
revoke execute on function public.get_facility_rhu_personnel(uuid) from public, anon, authenticated;
revoke execute on function public.get_consultation_attending_personnel(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_facility_rhu_personnel(uuid) to service_role;
grant execute on function public.get_consultation_attending_personnel(uuid, uuid) to service_role;

-- Lock down the search_path on these security-definer functions as defense in
-- depth so a caller cannot hijack object resolution.
alter function public.get_facility_rhu_personnel(uuid) set search_path = public;
alter function public.get_consultation_attending_personnel(uuid, uuid) set search_path = public;

commit;
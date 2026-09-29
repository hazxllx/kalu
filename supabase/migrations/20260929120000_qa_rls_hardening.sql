-- =============================================================================
-- KALUSAGAP — final-QA RLS hardening (forward-only, additive, non-destructive)
--
-- Two defects were surfaced by the authenticated PostgREST security probes run
-- during the client-presentation QA pass (real staff JWTs, live project):
--
-- 1. transfer_requests OTP secret columns were still SELECT-able by an
--    authenticated staff token via PostgREST (BUG-012 residue). The column
--    REVOKE from migration 20260929100100 was not in effect on the live schema
--    (a probe as PHN returned the otp_hash / otp_* columns with HTTP 200). This
--    migration re-applies the column-level REVOKE so the secret OTP material is
--    never returned to anon/authenticated; the service-role backend keeps access
--    for approve_transfer_request(). RLS still scopes WHICH rows are visible;
--    this closes the column-exposure gap on top of that.
--
-- 2. health_services_select and health_service_assignments_select referenced
--    each other's RLS-protected table inside their USING sub-queries, producing
--    "infinite recursion detected in policy for relation health_services" for
--    any direct authenticated read/write. The app uses the service-role backend
--    (RLS-bypassing) so the UI was unaffected, but direct authenticated access
--    failed closed with an error instead of a clean scope decision. The cycle is
--    broken with a SECURITY DEFINER helper so health_services_select no longer
--    re-enters the assignments policy. Visibility logic is unchanged.
--
-- Neither change weakens authorization: (1) removes a read privilege, (2) keeps
-- the identical visibility rule while removing the recursion. Idempotent.
-- =============================================================================

begin;

-- --- 1. Re-apply the OTP column REVOKE (BUG-012) ----------------------------
revoke select (otp_hash, otp_expires_at, otp_attempts, otp_verified_at, otp_locked_until)
  on public.transfer_requests from authenticated;
revoke select (otp_hash, otp_expires_at, otp_attempts, otp_verified_at, otp_locked_until)
  on public.transfer_requests from anon;

-- --- 2. Break the health_services <-> assignments policy recursion ----------
-- SECURITY DEFINER: reads health_service_assignments WITHOUT re-triggering that
-- table's RLS policy (which itself reads health_services), so evaluating
-- health_services_select no longer forms a cycle.
create or replace function public.user_assigned_to_health_service(p_service_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.health_service_assignments a
    where a.service_id = p_service_id
      and a.personnel_id = auth.uid()
      and a.active
  );
$$;

comment on function public.user_assigned_to_health_service(uuid) is
  'True when the current auth user has an active assignment to the given health service. SECURITY DEFINER to avoid RLS recursion between health_services and health_service_assignments.';

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
        (barangay_id is null and public.profile_role() in ('mho', 'phn', 'rhu_personnel'))
        or (barangay_id is not null and public.profile_covers_barangay(barangay_id))
      )
    )
    or public.user_assigned_to_health_service(id)
  );

commit;

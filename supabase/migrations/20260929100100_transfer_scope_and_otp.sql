-- =============================================================================
-- KALUSAGAP — BUG-005 + BUG-012: transfer-request scope + OTP secret protection
--
-- BUG-012: transfer_requests carries OTP secret material (otp_hash,
--   otp_expires_at, otp_attempts, otp_verified_at, otp_locked_until). The
--   staff SELECT policy allowed any active mho/phn/health_supervisor to read
--   EVERY column of EVERY row via direct PostgREST. Two fixes:
--     1. REVOKE column-level SELECT on the OTP columns from anon/authenticated
--        so a direct PostgREST read can never return them (service_role keeps
--        access for server-side OTP handling inside approve_transfer_request()).
--     2. barangay-scope the staff SELECT policy (BUG-005) so a Health
--        Supervisor only sees requests whose origin or destination barangay is
--        their own assigned barangay.
--
-- BUG-005: listQueue/getForReview/reject/approve are additionally scoped in the
--   service layer (transfer.service.js). This migration is the matching DB-layer
--   defense so a direct authenticated PostgREST read is constrained too.
--
-- Idempotent: safe to re-run.
-- =============================================================================

begin;

-- --- BUG-012: OTP columns are never readable by application clients ---------
-- Column-level privileges apply on top of RLS. authenticated/anon lose SELECT
-- on the secret columns entirely; service_role (the backend) is unaffected.
revoke select (otp_hash, otp_expires_at, otp_attempts, otp_verified_at, otp_locked_until)
  on public.transfer_requests from authenticated;
revoke select (otp_hash, otp_expires_at, otp_attempts, otp_verified_at, otp_locked_until)
  on public.transfer_requests from anon;

-- --- BUG-005: barangay-scope the staff read policy --------------------------
drop policy if exists transfer_requests_select on public.transfer_requests;
create policy transfer_requests_select on public.transfer_requests
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.is_admin()
    or (
      public.is_staff_active()
      and public.profile_role() in ('mho', 'phn')
    )
    or (
      public.is_staff_active()
      and public.profile_role() = 'health_supervisor'
      and (
        from_barangay_id = public.profile_barangay_id()
        or to_barangay_id = public.profile_barangay_id()
      )
    )
  );

-- The transfer audit-log read policy is scoped the same way: a Health
-- Supervisor only sees audit rows for requests touching their barangay.
drop policy if exists transfer_request_audit_select on public.transfer_request_audit_logs;
create policy transfer_request_audit_select on public.transfer_request_audit_logs
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.transfer_requests tr
      where tr.id = transfer_request_audit_logs.transfer_request_id
        and tr.auth_user_id = auth.uid()
    )
    or (
      public.is_staff_active()
      and public.profile_role() in ('mho', 'phn')
    )
    or (
      public.is_staff_active()
      and public.profile_role() = 'health_supervisor'
      and exists (
        select 1 from public.transfer_requests tr
        where tr.id = transfer_request_audit_logs.transfer_request_id
          and (
            tr.from_barangay_id = public.profile_barangay_id()
            or tr.to_barangay_id = public.profile_barangay_id()
          )
      )
    )
  );

-- Transfer documents follow the same barangay scope for the Health Supervisor.
drop policy if exists documents_transfer_select on public.documents;
create policy documents_transfer_select on public.documents
  for select to authenticated
  using (
    exists (
      select 1 from public.transfer_requests tr
      where tr.id = documents.transfer_request_id
        and (
          tr.auth_user_id = auth.uid()
          or public.is_admin()
          or (public.is_staff_active() and public.profile_role() in ('mho', 'phn'))
          or (
            public.is_staff_active()
            and public.profile_role() = 'health_supervisor'
            and (
              tr.from_barangay_id = public.profile_barangay_id()
              or tr.to_barangay_id = public.profile_barangay_id()
            )
          )
        )
    )
  );

commit;

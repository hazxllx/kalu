-- =============================================================================
-- KALUSAGAP — transfer_requests OTP column exposure, correct fix (BUG-012)
--
-- Migrations 20260929100100 and 20260929120000 issued a column-level
--   REVOKE SELECT (otp_hash, ...) ON transfer_requests FROM authenticated
-- but a live authenticated PostgREST probe still returned the OTP columns.
--
-- ROOT CAUSE: Supabase grants the `authenticated` (and `anon`) role a
-- TABLE-LEVEL SELECT on public tables. In PostgreSQL a table-level SELECT
-- privilege covers every column, so a subsequent column-level REVOKE is a
-- no-op — the broad grant still permits the columns. To actually restrict
-- specific columns the table-level SELECT must be revoked first and SELECT
-- re-granted on ONLY the non-secret columns.
--
-- This migration does exactly that for `authenticated`: it removes the
-- table-wide SELECT and re-grants SELECT on every transfer_requests column
-- EXCEPT the five OTP secret columns (otp_hash, otp_expires_at, otp_attempts,
-- otp_verified_at, otp_locked_until). Row visibility is unchanged (RLS policy
-- transfer_requests_select still applies); the service-role backend keeps full
-- access for approve_transfer_request(). Non-secret reads (a resident checking
-- their own transfer status, staff queue reads) continue to work.
--
-- `anon` cannot read any transfer_requests row (RLS returns none and requests
-- without a JWT are rejected 401), so no anon change is required here.
--
-- Idempotent. Additive/strengthening only — no authorization is weakened.
-- =============================================================================

begin;

revoke select on public.transfer_requests from authenticated;

grant select (
  id,
  auth_user_id,
  status,
  target_resident_id,
  submitted_at,
  reviewed_by,
  reviewed_at,
  rejection_reason,
  created_at,
  updated_at,
  resident_id,
  from_barangay_id,
  to_barangay_id,
  reason
) on public.transfer_requests to authenticated;

commit;

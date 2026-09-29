-- =============================================================================
-- KALUSAGAP — BUG-017: remove the legacy public.jwt_role() helper
--
-- jwt_role() (20260903120000) reads the application role from client-reachable
-- JWT claims (auth.jwt() -> 'app_metadata' ->> 'role' / -> 'role'). The app
-- NEVER sets app_metadata.role — authorization is resolved from the profiles
-- table via profile_role()/is_staff_active()/etc. Every policy that once used
-- jwt_role() (residents/visits/referrals in the first migration) was dropped and
-- replaced with the profile-based, scope-aware policies in
-- 20260915100100_accounts_documents_and_clinical_scope.sql.
--
-- A repository-wide search confirms jwt_role() is referenced by no current
-- policy, function, or application code. Dropping it removes a landmine: a
-- future policy could accidentally trust client-controlled role metadata.
--
-- Idempotent: safe to re-run.
-- =============================================================================

begin;

drop function if exists public.jwt_role();

commit;

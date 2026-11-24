-- Remove any legacy third-party identity-verification objects on databases
-- that applied the original integration migrations.

begin;

drop table if exists public.didit_webhook_events;
drop table if exists public.identity_verifications;

alter table public.residents
  drop column if exists identity_attempt_count,
  drop column if exists identity_last_attempt_at,
  drop column if exists identity_verified_at,
  drop column if exists didit_session_id,
  drop column if exists identity_verification_status;

drop index if exists public.residents_didit_session_id_key;
drop index if exists public.residents_identity_verification_status_idx;
drop type if exists public.identity_verification_status;

commit;

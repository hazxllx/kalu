-- KALUSAGAP — enforce one resident record per authenticated account
--
-- Additive, non-destructive integrity hardening for resident data isolation
-- (notifications, follow-ups, health records). No table/row is created, dropped
-- or rewritten and no RLS policy is changed.
--
-- Background: notification/follow-up/health-record ownership is enforced by
-- residents.auth_user_id = auth.uid() (RLS) and by the backend list queries.
-- That is only sound if a single auth account maps to at most one resident row.
-- residents.auth_user_id previously had a NON-unique index only, so two resident
-- rows could theoretically share one auth account (via the registration-claim
-- and transfer-linking flows), which would make a signed-in resident correctly
-- but surprisingly receive every linked resident's notifications/follow-ups.
--
-- This adds a partial UNIQUE index (nulls excluded) so one auth account can link
-- to at most one resident. It is applied only when no duplicate links already
-- exist; if duplicates are present it is skipped with a WARNING (never deleting
-- data or blocking deployment) so the duplicates can be resolved and the
-- migration re-run.

begin;

do $$
begin
  if exists (
    select 1
    from public.residents
    where auth_user_id is not null
    group by auth_user_id
    having count(*) > 1
  ) then
    raise warning 'residents.auth_user_id has duplicate links; unique index NOT created. Resolve duplicates (select auth_user_id, count(*) from public.residents where auth_user_id is not null group by 1 having count(*) > 1) then re-run this migration.';
  else
    create unique index if not exists residents_auth_user_id_unique
      on public.residents(auth_user_id) where auth_user_id is not null;
  end if;
end $$;

commit;

-- =============================================================================
-- KALUSAGAP — permanent account deletion guard
--
-- Permanent account deletion is a two-system operation: the authentication
-- identity lives in Supabase Auth (auth.users) and the application profile lives
-- in public.profiles. Because `public.profiles.id references auth.users(id) on
-- delete cascade`, deleting the auth user atomically removes the profile too, and
-- every operational / clinical / audit reference to the account is defined with
-- `on delete set null` (e.g. residents.auth_user_id, *.created_by, *.reviewed_by,
-- health_audit_logs.actor_id). Deletion therefore PRESERVES resident,
-- consultation, referral, visit and audit records while unlinking the removed
-- account — nothing is cascade-deleted to make the removal succeed.
--
-- This migration adds a single transactional GUARD function that re-verifies, in
-- the database and under an advisory lock, every safety invariant before the
-- backend performs the irreversible Auth deletion:
--   * the actor is an active administrator (defence in depth; the API already
--     requires the admin role + accounts.delete permission),
--   * the target account exists,
--   * an administrator cannot delete their own account,
--   * the last active administrator cannot be deleted.
-- The function performs NO mutation and returns a snapshot the backend uses for
-- the audit record written after a confirmed deletion. Keeping the guard separate
-- from the Auth deletion is deliberate: the audit entry is only written once the
-- account is actually gone, so a failed deletion can never leave a false
-- "deleted" record behind.
--
-- Executable by service_role only (the backend runs it after
-- authenticate + authorize(admin, accounts.delete)).
-- =============================================================================

begin;

create or replace function public.admin_assert_account_deletable(
  p_target_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles%rowtype;
begin
  -- Serialise with the other account-lifecycle RPCs (provision / update) so the
  -- last-admin invariant cannot be raced by a concurrent demotion.
  perform pg_advisory_xact_lock(734920184);

  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and role = 'admin' and status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An active administrator is required.';
  end if;

  select * into v_target from public.profiles where id = p_target_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'User account not found.';
  end if;

  if p_actor_id = p_target_id then
    raise exception using errcode = '23514', message = 'You cannot delete your own administrator account.';
  end if;

  if v_target.role = 'admin'
     and v_target.status = 'active'
     and not exists (
       select 1 from public.profiles
       where role = 'admin' and status = 'active' and id <> p_target_id
     ) then
    raise exception using errcode = '23514',
      message = 'This action would remove the system''s last active Administrator account and cannot be completed.';
  end if;

  return jsonb_build_object(
    'id', v_target.id,
    'email', v_target.email,
    'full_name', v_target.full_name,
    'role', v_target.role,
    'status', v_target.status,
    'municipality_id', v_target.municipality_id,
    'barangay_id', v_target.barangay_id,
    'facility_id', v_target.facility_id
  );
end;
$$;

revoke all on function public.admin_assert_account_deletable(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_assert_account_deletable(uuid, uuid) to service_role;

commit;

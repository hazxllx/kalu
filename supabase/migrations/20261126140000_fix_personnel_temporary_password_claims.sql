-- supabase/migrations/20261126140000_fix_personnel_temporary_password_claims.sql
-- A valid, unconsumed invitation proof is not itself an active password change.
-- Only a live invitation-recovery claim should conflict with the temporary-password
-- login flow. Expired temporary-password claims are also safely reclaimed here.
create or replace function public.begin_personnel_temporary_password_change(
  p_target_id uuid,
  p_password_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.personnel_accounts%rowtype;
  v_claim_id uuid;
  v_lease_id uuid;
  v_attempt integer;
begin
  if p_password_digest !~ '^[0-9a-f]{64}$' then return null; end if;
  perform pg_advisory_xact_lock(734920184);

  select * into v_account
  from public.personnel_accounts
  where account_id = p_target_id
  for update;

  if not found
    or v_account.approval_status <> 'approved'
    or v_account.suspended_at is not null
    or not v_account.must_change_password then return null; end if;

  -- Reuse only the same live claim. A stale claim is recoverable.
  if v_account.temporary_password_change_claim_id is not null
    and v_account.temporary_password_change_lease_expires_at > now()
    and v_account.temporary_password_change_password_digest <> p_password_digest then
    return null;
  end if;

  -- An invitation proof may exist because this is the intended first-time flow.
  -- Block only an invitation recovery that has actually claimed the account.
  if exists (
    select 1 from public.personnel_invitation_recovery_proofs
    where account_id = p_target_id
      and consumed_at is null
      and claim_id is not null
      and lease_expires_at > now()
  ) then return null; end if;

  if v_account.temporary_password_change_claim_id is not null
    and v_account.temporary_password_change_lease_expires_at > now() then
    v_claim_id := v_account.temporary_password_change_claim_id;
  else
    v_claim_id := gen_random_uuid();
  end if;
  v_lease_id := gen_random_uuid();
  v_attempt := v_account.temporary_password_change_auth_attempt_count + 1;

  update public.personnel_accounts set
    temporary_password_change_claim_id = v_claim_id,
    temporary_password_change_password_digest = p_password_digest,
    temporary_password_change_claimed_at = coalesce(temporary_password_change_claimed_at, now()),
    temporary_password_change_lease_id = v_lease_id,
    temporary_password_change_lease_expires_at = now() + interval '1 minute',
    temporary_password_change_auth_attempt_count = v_attempt
  where account_id = p_target_id;

  return jsonb_build_object('claimId', v_claim_id, 'leaseId', v_lease_id, 'attempt', v_attempt);
end;
$$;

notify pgrst, 'reload schema';

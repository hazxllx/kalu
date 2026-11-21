begin;

alter table public.personnel_accounts
  add column temporary_password_change_claim_id uuid,
  add column temporary_password_change_password_digest text,
  add column temporary_password_change_claimed_at timestamptz,
  add column temporary_password_change_lease_id uuid,
  add column temporary_password_change_lease_expires_at timestamptz,
  add column temporary_password_change_auth_attempt_count integer not null default 0;

alter table public.personnel_notification_outbox
  add column link_generation_started_at timestamptz;

create table public.personnel_invitation_recovery_proofs (
  account_id uuid primary key references public.personnel_accounts(account_id) on delete cascade,
  notification_id uuid not null unique references public.personnel_notification_outbox(id) on delete cascade,
  token_digest text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  claim_id uuid,
  claimed_password_digest text,
  claimed_at timestamptz,
  lease_id uuid,
  lease_expires_at timestamptz,
  auth_updated_at_before timestamptz,
  auth_attempt_count integer not null default 0
);

alter table public.personnel_invitation_recovery_proofs enable row level security;

revoke all on public.personnel_invitation_recovery_proofs
from public, anon, authenticated;

grant all on public.personnel_invitation_recovery_proofs
to service_role;


-- ============================================================
-- INVITATION RECOVERY PROOF CLEANUP
-- ============================================================

create function public.clear_personnel_invitation_recovery_proof()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('failed', 'cancelled') then
    update public.personnel_invitation_recovery_proofs
    set
      token_digest = null,
      consumed_at = coalesce(consumed_at, now()),
      claim_id = null,
      claimed_password_digest = null,
      claimed_at = null
    where notification_id = new.id
      and token_digest is not null;
  end if;

  return new;
end;
$$;


create trigger personnel_invitation_recovery_outbox_guard
  after update of status on public.personnel_notification_outbox
  for each row
  when (new.status in ('failed', 'cancelled'))
  execute function public.clear_personnel_invitation_recovery_proof();


-- ============================================================
-- NOTIFICATION LINK GENERATION GUARD
-- ============================================================

create function public.guard_personnel_notification_link_generation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('pending', 'processing', 'failed')
    and new.status = 'cancelled'
    and old.link_generation_started_at is not null
    and new.link_generation_started_at is not null then

    raise exception using
      errcode = '40001',
      message = 'A personnel notification link is being generated; retry the lifecycle action.';
  end if;

  return new;
end;
$$;


create trigger personnel_notification_link_generation_guard
  before update of status on public.personnel_notification_outbox
  for each row
  execute function public.guard_personnel_notification_link_generation();


create function public.clear_personnel_notification_link_generation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('sending', 'sent', 'failed', 'cancelled', 'delivery_unknown')
    and old.link_generation_started_at is not null then

    update public.personnel_notification_outbox
    set link_generation_started_at = null
    where id = new.id;
  end if;

  return new;
end;
$$;


create trigger personnel_notification_link_generation_cleanup
  after update of status on public.personnel_notification_outbox
  for each row
  execute function public.clear_personnel_notification_link_generation();


-- ============================================================
-- PREPARE PERSONNEL NOTIFICATION LINK
-- ============================================================

create function public.prepare_personnel_notification_link(
  p_notification_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.personnel_notification_outbox%rowtype;
  v_account public.personnel_accounts%rowtype;
begin
  perform pg_advisory_xact_lock(734920184);

  select *
  into v_job
  from public.personnel_notification_outbox
  where id = p_notification_id
    and status = 'processing'
    and claim_token = p_claim_token
  for update;

  if not found
    or v_job.event_type not in ('approved', 'reactivated', 'invitation') then
    return false;
  end if;

  select *
  into v_account
  from public.personnel_accounts
  where account_id = v_job.account_id
  for update;

  if not found
    or v_account.approval_status <> 'approved'
    or v_account.suspended_at is not null
    or not v_account.setup_required
    or v_account.setup_completed_at is not null then

    update public.personnel_notification_outbox
    set
      status = 'cancelled',
      next_attempt_at = null,
      link_generation_started_at = null
    where id = v_job.id;

    return false;
  end if;

  if v_account.must_change_password
    and exists (
      select 1
      from public.personnel_accounts
      where account_id = v_job.account_id
        and temporary_password_change_lease_expires_at > now()
    ) then
    return false;
  end if;

  update public.personnel_notification_outbox
  set link_generation_started_at = now()
  where id = v_job.id;

  return true;
end;
$$;


-- ============================================================
-- CLAIM PERSONNEL NOTIFICATIONS
-- ============================================================

create or replace function public.claim_personnel_notifications(
  p_limit integer default 10,
  p_target_id uuid default null
)
returns setof public.personnel_notification_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.personnel_notification_outbox
  set
    status = 'delivery_unknown',
    next_attempt_at = null,
    last_error_code = 'SMTP_ACCEPTANCE_UNKNOWN'
  where status = 'sending'
    and claimed_at < now() - interval '5 minutes';

  update public.personnel_notification_outbox
  set
    status = 'failed',
    claim_token = null,
    claimed_at = null,
    next_attempt_at = case
      when attempts < 8 then now()
      else null
    end,
    last_error_code = 'PROCESSING_LEASE_EXPIRED'
  where status = 'processing'
    and claimed_at < now() - interval '5 minutes'
    and link_generation_started_at is null;

  return query
    with due as (
      select j.id
      from public.personnel_notification_outbox j
      where j.status in ('pending', 'failed')
        and j.next_attempt_at <= now()
        and j.attempts < 8
        and (p_target_id is null or j.account_id = p_target_id)
      order by j.next_attempt_at, j.created_at, j.id
      limit greatest(1, least(coalesce(p_limit, 10), 100))
      for update skip locked
    )
    update public.personnel_notification_outbox j
    set
      status = 'processing',
      claim_token = gen_random_uuid(),
      claimed_at = now(),
      attempts = j.attempts + 1,
      next_attempt_at = null
    from due
    where j.id = due.id
    returning j.*;
end;
$$;


-- ============================================================
-- BEGIN PERSONNEL NOTIFICATION SEND
-- ============================================================

create or replace function public.begin_personnel_notification_send(
  p_notification_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.personnel_notification_outbox%rowtype;
  v_account public.personnel_accounts%rowtype;
  v_valid boolean;
begin
  select *
  into v_job
  from public.personnel_notification_outbox
  where id = p_notification_id
    and status = 'processing'
    and claim_token = p_claim_token
  for update;

  if not found then
    return false;
  end if;

  select *
  into v_account
  from public.personnel_accounts
  where account_id = v_job.account_id;

  v_valid := found and case
    when v_job.event_type = 'invitation' then
      v_account.approval_status = 'approved'
      and v_account.suspended_at is null
      and v_account.setup_required
      and v_account.setup_completed_at is null
      and v_job.link_generation_started_at is not null
      and (
        not v_account.must_change_password
        or exists (
          select 1
          from public.personnel_invitation_recovery_proofs proof
          where proof.account_id = v_job.account_id
            and proof.notification_id = v_job.id
            and proof.token_digest is not null
            and proof.consumed_at is null
            and proof.expires_at > now()
        )
      )

    when v_job.event_type in ('approved', 'reactivated') then
      v_account.approval_status = 'approved'
      and v_account.suspended_at is null

    when v_job.event_type = 'rejected' then
      v_account.approval_status = 'rejected'

    when v_job.event_type = 'suspended' then
      v_account.suspended_at is not null

    else false
  end;

  if not coalesce(v_valid, false) then
    update public.personnel_notification_outbox
    set
      status = 'cancelled',
      next_attempt_at = null,
      link_generation_started_at = null
    where id = v_job.id;

    return false;
  end if;

  update public.personnel_notification_outbox
  set
    status = 'sending',
    claimed_at = now(),
    link_generation_started_at = null
  where id = v_job.id;

  return true;
end;
$$;


-- ============================================================
-- REGISTER PERSONNEL INVITATION RECOVERY
-- ============================================================

create function public.register_personnel_invitation_recovery(
  p_notification_id uuid,
  p_claim_token uuid,
  p_token_digest text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.personnel_notification_outbox%rowtype;
  v_account public.personnel_accounts%rowtype;
  v_existing public.personnel_invitation_recovery_proofs%rowtype;
begin
  if p_token_digest !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  perform pg_advisory_xact_lock(734920184);

  select *
  into v_job
  from public.personnel_notification_outbox
  where id = p_notification_id
    and status = 'processing'
    and claim_token = p_claim_token
  for update;

  if not found
    or v_job.event_type <> 'invitation'
    or v_job.link_generation_started_at is null then
    return false;
  end if;

  select *
  into v_account
  from public.personnel_accounts
  where account_id = v_job.account_id;

  if not found
    or v_account.approval_status <> 'approved'
    or v_account.suspended_at is not null
    or not v_account.setup_required
    or v_account.setup_completed_at is not null
    or not v_account.must_change_password
    or (
      v_account.temporary_password_change_claim_id is not null
      and v_account.temporary_password_change_claimed_at >
        now() - interval '10 minutes'
    ) then
    return false;
  end if;

  if v_account.temporary_password_change_claim_id is not null then
    update public.personnel_accounts
    set
      temporary_password_change_claim_id = null,
      temporary_password_change_password_digest = null,
      temporary_password_change_claimed_at = null
    where account_id = v_account.account_id;
  end if;

  select *
  into v_existing
  from public.personnel_invitation_recovery_proofs
  where account_id = v_job.account_id
  for update;

  if found
    and v_existing.consumed_at is null
    and v_existing.claim_id is not null
    and v_existing.claimed_at > now() - interval '10 minutes' then
    return false;
  end if;

  insert into public.personnel_invitation_recovery_proofs (
    account_id,
    notification_id,
    token_digest,
    expires_at,
    consumed_at,
    claim_id,
    claimed_password_digest,
    claimed_at,
    lease_id,
    lease_expires_at,
    auth_attempt_count
  )
  values (
    v_job.account_id,
    v_job.id,
    p_token_digest,
    now() + interval '1 hour',
    null,
    null,
    null,
    null,
    null,
    null,
    0
  )
  on conflict (account_id) do update
  set
    notification_id = excluded.notification_id,
    token_digest = excluded.token_digest,
    expires_at = excluded.expires_at,
    consumed_at = null,
    claim_id = null,
    claimed_password_digest = null,
    claimed_at = null,
    lease_id = null,
    lease_expires_at = null,
    auth_attempt_count = 0;

  return true;
end;
$$;


-- ============================================================
-- BEGIN TEMPORARY PASSWORD CHANGE
-- ============================================================

create function public.begin_personnel_temporary_password_change(
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
  if p_password_digest !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  perform pg_advisory_xact_lock(734920184);

  select *
  into v_account
  from public.personnel_accounts
  where account_id = p_target_id
  for update;

  if not found
    or v_account.approval_status <> 'approved'
    or v_account.suspended_at is not null
    or not v_account.must_change_password then
    return null;
  end if;

  if v_account.temporary_password_change_claim_id is not null then
    if v_account.temporary_password_change_password_digest <> p_password_digest
      or v_account.temporary_password_change_lease_expires_at > now() then
      return null;
    end if;

    v_claim_id := v_account.temporary_password_change_claim_id;
  else
    if v_account.temporary_password_expires_at is null
      or v_account.temporary_password_expires_at <= now() then
      return null;
    end if;

    v_claim_id := gen_random_uuid();
  end if;

  if exists (
    select 1
    from public.personnel_invitation_recovery_proofs
    where account_id = p_target_id
      and consumed_at is null
      and (claim_id is not null or expires_at > now())
  ) then
    return null;
  end if;

  v_lease_id := gen_random_uuid();
  v_attempt := v_account.temporary_password_change_auth_attempt_count + 1;

  update public.personnel_accounts
  set
    temporary_password_change_claim_id = v_claim_id,
    temporary_password_change_password_digest = p_password_digest,
    temporary_password_change_claimed_at =
      coalesce(temporary_password_change_claimed_at, now()),
    temporary_password_change_lease_id = v_lease_id,
    temporary_password_change_lease_expires_at = now() + interval '1 minute',
    temporary_password_change_auth_attempt_count = v_attempt
  where account_id = p_target_id;

  return jsonb_build_object(
    'claimId', v_claim_id,
    'leaseId', v_lease_id,
    'attempt', v_attempt
  );
end;
$$;


-- ============================================================
-- RELEASE TEMPORARY PASSWORD CHANGE
-- ============================================================

create function public.release_personnel_temporary_password_change(
  p_target_id uuid,
  p_claim_id uuid,
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.personnel_accounts
  set
    temporary_password_change_claim_id = null,
    temporary_password_change_password_digest = null,
    temporary_password_change_claimed_at = null,
    temporary_password_change_lease_id = null,
    temporary_password_change_lease_expires_at = null,
    temporary_password_change_auth_attempt_count = 0
  where account_id = p_target_id
    and must_change_password
    and temporary_password_change_claim_id = p_claim_id
    and temporary_password_change_lease_id = p_lease_id;

  return found;
end;
$$;


-- ============================================================
-- RELEASE TEMPORARY PASSWORD CHANGE LEASE
-- ============================================================

create function public.release_personnel_temporary_password_change_lease(
  p_target_id uuid,
  p_claim_id uuid,
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.personnel_accounts
  set
    temporary_password_change_lease_id = null,
    temporary_password_change_lease_expires_at = null
  where account_id = p_target_id
    and must_change_password
    and temporary_password_change_claim_id = p_claim_id
    and temporary_password_change_lease_id = p_lease_id;

  return found;
end;
$$;


-- ============================================================
-- CLEAR TEMPORARY PASSWORD CHANGE CLAIM
-- ============================================================

create function public.clear_temporary_password_change_claim()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not new.must_change_password then
    new.temporary_password_change_claim_id := null;
    new.temporary_password_change_password_digest := null;
    new.temporary_password_change_claimed_at := null;
    new.temporary_password_change_lease_id := null;
    new.temporary_password_change_lease_expires_at := null;
    new.temporary_password_change_auth_attempt_count := 0;
  end if;

  return new;
end;
$$;


create trigger personnel_temporary_password_claim_cleanup
  before update of must_change_password on public.personnel_accounts
  for each row
  when (not new.must_change_password)
  execute function public.clear_temporary_password_change_claim();


-- ============================================================
-- COMPLETE TEMPORARY PERSONNEL PASSWORD CHANGE
-- ============================================================

create or replace function public.complete_temporary_personnel_password_change(
  p_target_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_account public.personnel_accounts%rowtype;
  v_before jsonb;
  v_status text;
begin
  perform pg_advisory_xact_lock(734920184);

  select *
  into v_profile
  from public.profiles
  where id = p_target_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Personnel account not found.';
  end if;

  select *
  into v_account
  from public.personnel_accounts
  where account_id = p_target_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Personnel account not found.';
  end if;

  if not v_account.must_change_password then
    raise exception using
      errcode = '23514',
      message = 'This account does not require a temporary-password change.';
  end if;

  if v_account.temporary_password_expires_at is not null
    and v_account.temporary_password_expires_at <= now()
    and v_account.temporary_password_change_claim_id is null then

    raise exception using
      errcode = '42501',
      message = 'The temporary password has expired. Contact your administrator.';
  end if;

  if v_account.approval_status <> 'approved'
    or v_account.suspended_at is not null then

    raise exception using
      errcode = '42501',
      message = 'Only an approved, unsuspended account can complete this password change.';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = p_target_id
      and email_confirmed_at is not null
  ) then

    raise exception using
      errcode = '42501',
      message = 'The account email must be confirmed before completing this password change.';
  end if;

  v_before := public.personnel_profile_json(p_target_id);

  v_status := case
    when v_account.activation_requested then 'active'
    else 'disabled'
  end;

  if v_status = 'active' then
    perform public.personnel_assert_activation_scope(p_target_id);
  end if;

  update public.personnel_accounts
  set
    must_change_password = false,
    setup_required = false,
    setup_completed_at = now(),
    password_changed_at = now(),
    temporary_password_expires_at = null,
    updated_by = p_target_id,
    updated_at = now(),
    version = version + 1
  where account_id = p_target_id;

  perform set_config('app.admin_account_rpc', 'true', true);

  update public.profiles
  set status = v_status
  where id = p_target_id;

  perform public.personnel_audit(
    p_target_id,
    p_target_id,
    'ACCOUNT_TEMPORARY_PASSWORD_CHANGED',
    v_before,
    public.personnel_profile_json(p_target_id),
    jsonb_build_object(
      'temporary_password_assigned_by',
      v_account.temporary_password_assigned_by
    )
  );

  if v_status = 'active' then
    perform public.personnel_audit(
      p_target_id,
      coalesce(
        v_account.activation_requested_by,
        v_account.approved_by,
        v_account.created_by
      ),
      'ACCOUNT_ACTIVATED',
      v_before,
      public.personnel_profile_json(p_target_id),
      jsonb_build_object('password_change_completed_by', p_target_id)
    );
  end if;

  return public.personnel_profile_json(p_target_id);
end;
$$;


-- ============================================================
-- COMPLETE CLAIMED TEMPORARY PERSONNEL PASSWORD CHANGE
-- ============================================================

create function public.complete_claimed_temporary_personnel_password_change(
  p_target_id uuid,
  p_claim_id uuid,
  p_lease_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.personnel_accounts%rowtype;
begin
  perform pg_advisory_xact_lock(734920184);

  select *
  into v_account
  from public.personnel_accounts
  where account_id = p_target_id
  for update;

  if not found
    or v_account.temporary_password_change_claim_id is distinct from p_claim_id
    or v_account.temporary_password_change_lease_id is distinct from p_lease_id
    or v_account.temporary_password_change_lease_expires_at <= now()
    or v_account.temporary_password_change_password_digest is null then

    raise exception using
      errcode = '42501',
      message = 'The temporary-password change claim is missing or expired.';
  end if;

  return public.complete_temporary_personnel_password_change(p_target_id);
end;
$$;


-- ============================================================
-- BEGIN PERSONNEL INVITATION RECOVERY
-- ============================================================

create function public.begin_personnel_invitation_recovery(
  p_target_id uuid,
  p_token_digest text,
  p_password_digest text,
  p_auth_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proof public.personnel_invitation_recovery_proofs%rowtype;
  v_account public.personnel_accounts%rowtype;
  v_claim_id uuid;
  v_lease_id uuid;
  v_attempt integer;
begin
  if p_token_digest !~ '^[0-9a-f]{64}$'
    or p_password_digest !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  perform pg_advisory_xact_lock(734920184);

  select *
  into v_proof
  from public.personnel_invitation_recovery_proofs
  where account_id = p_target_id
    and token_digest = p_token_digest
    and consumed_at is null
  for update;

  if not found then
    return null;
  end if;

  select *
  into v_account
  from public.personnel_accounts
  where account_id = p_target_id;

  if not found
    or v_account.approval_status <> 'approved'
    or v_account.suspended_at is not null
    or not v_account.setup_required
    or v_account.setup_completed_at is not null
    or not v_account.must_change_password
    or v_account.temporary_password_change_claim_id is not null then
    return null;
  end if;

  if v_proof.claim_id is not null then
    if v_proof.claimed_password_digest = p_password_digest then
      if v_proof.lease_expires_at > now() then
        return null;
      end if;

      v_claim_id := v_proof.claim_id;
    else
      return null;
    end if;
  else
    if v_proof.expires_at <= now() then
      return null;
    end if;

    v_claim_id := gen_random_uuid();
    v_proof.auth_updated_at_before := p_auth_updated_at;
    v_proof.auth_attempt_count := 0;
  end if;

  if v_proof.claim_id is not null
    and v_proof.expires_at <= now() then

    v_lease_id := gen_random_uuid();
    v_attempt := v_proof.auth_attempt_count + 1;

    update public.personnel_invitation_recovery_proofs
    set
      lease_id = v_lease_id,
      lease_expires_at = now() + interval '1 minute',
      auth_attempt_count = v_attempt
    where account_id = p_target_id;

    return jsonb_build_object(
      'claimId', v_claim_id,
      'leaseId', v_lease_id,
      'attempt', v_attempt,
      'authUpdatedAtBefore', v_proof.auth_updated_at_before,
      'allowAuthUpdate', false
    );
  end if;

  if v_proof.claim_id is not null then
    v_proof.auth_updated_at_before := v_proof.auth_updated_at_before;
  end if;

  if v_proof.claim_id is not null
    and v_proof.claimed_password_digest <> p_password_digest then
    return null;
  end if;

  if v_proof.claim_id is null
    and v_proof.expires_at <= now() then
    return null;
  end if;

  if v_proof.claim_id is null then
    v_claim_id := gen_random_uuid();
  end if;

  v_lease_id := gen_random_uuid();
  v_attempt := v_proof.auth_attempt_count + 1;

  update public.personnel_invitation_recovery_proofs
  set
    claim_id = v_claim_id,
    claimed_password_digest = p_password_digest,
    claimed_at = coalesce(claimed_at, now()),
    lease_id = v_lease_id,
    lease_expires_at = now() + interval '1 minute',
    auth_updated_at_before = coalesce(auth_updated_at_before, p_auth_updated_at),
    auth_attempt_count = v_attempt
  where account_id = p_target_id;

  return jsonb_build_object(
    'claimId', v_claim_id,
    'leaseId', v_lease_id,
    'attempt', v_attempt,
    'authUpdatedAtBefore',
      coalesce(v_proof.auth_updated_at_before, p_auth_updated_at),
    'allowAuthUpdate', v_proof.expires_at > now()
  );
end;
$$;


-- ============================================================
-- GET PERSONNEL INVITATION RECOVERY OWNER
-- IMPORTANT: Only one closing $$; before this function.
-- ============================================================

create function public.get_personnel_invitation_recovery_owner(
  p_token_digest text
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select proof.account_id
  from public.personnel_invitation_recovery_proofs proof
  join public.personnel_accounts account
    on account.account_id = proof.account_id
  join auth.users auth_user
    on auth_user.id = proof.account_id
  where proof.token_digest = p_token_digest
    and proof.consumed_at is null
    and proof.claim_id is not null
    and proof.claimed_password_digest is not null
    and account.approval_status = 'approved'
    and account.suspended_at is null
    and account.setup_required
    and account.setup_completed_at is null
    and account.must_change_password
    and auth_user.email_confirmed_at is not null
  limit 1;
$$;


-- ============================================================
-- COMPLETE PERSONNEL INVITATION RECOVERY
-- ============================================================

create function public.complete_personnel_invitation_recovery(
  p_target_id uuid,
  p_token_digest text,
  p_claim_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_account public.personnel_accounts%rowtype;
  v_proof public.personnel_invitation_recovery_proofs%rowtype;
  v_before jsonb;
  v_status text;
begin
  perform pg_advisory_xact_lock(734920184);

  select *
  into v_profile
  from public.profiles
  where id = p_target_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Personnel account not found.';
  end if;

  select *
  into v_account
  from public.personnel_accounts
  where account_id = p_target_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Personnel account not found.';
  end if;

  select *
  into v_proof
  from public.personnel_invitation_recovery_proofs
  where account_id = p_target_id
    and token_digest = p_token_digest
    and consumed_at is null
    and claim_id = p_claim_id
  for update;

  if not found or v_proof.claimed_password_digest is null then
    raise exception using
      errcode = '42501',
      message = 'A valid invitation recovery proof is required.';
  end if;

  if v_account.approval_status <> 'approved'
    or v_account.suspended_at is not null
    or not v_account.setup_required
    or v_account.setup_completed_at is not null
    or not v_account.must_change_password then

    raise exception using
      errcode = '42501',
      message = 'Only an approved, unsuspended account awaiting setup can be recovered.';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = p_target_id
      and email_confirmed_at is not null
  ) then

    raise exception using
      errcode = '42501',
      message = 'Verify the account email before completing password setup.';
  end if;

  v_before := public.personnel_profile_json(p_target_id);

  v_status := case
    when v_account.activation_requested then 'active'
    else 'disabled'
  end;

  if v_status = 'active' then
    perform public.personnel_assert_activation_scope(p_target_id);
  end if;

  update public.personnel_accounts
  set
    must_change_password = false,
    setup_required = false,
    setup_completed_at = now(),
    password_changed_at = now(),
    temporary_password_expires_at = null,
    updated_by = p_target_id,
    updated_at = now(),
    version = version + 1
  where account_id = p_target_id;

  perform set_config('app.admin_account_rpc', 'true', true);

  update public.profiles
  set status = v_status
  where id = p_target_id;

  update public.personnel_invitation_recovery_proofs
  set
    token_digest = null,
    consumed_at = now(),
    claim_id = null,
    claimed_password_digest = null,
    claimed_at = null
  where account_id = p_target_id;

  perform public.personnel_audit(
    p_target_id,
    p_target_id,
    'ACCOUNT_TEMPORARY_PASSWORD_RECOVERED',
    v_before,
    public.personnel_profile_json(p_target_id),
    jsonb_build_object(
      'temporary_password_assigned_by',
      v_account.temporary_password_assigned_by,
      'recovery_notification_id',
      v_proof.notification_id
    )
  );

  if v_status = 'active' then
    perform public.personnel_audit(
      p_target_id,
      coalesce(
        v_account.activation_requested_by,
        v_account.approved_by,
        v_account.created_by
      ),
      'ACCOUNT_ACTIVATED',
      v_before,
      public.personnel_profile_json(p_target_id),
      jsonb_build_object('password_recovery_completed_by', p_target_id)
    );
  end if;

  return public.personnel_profile_json(p_target_id);
end;
$$;


-- ============================================================
-- RELEASE PERSONNEL INVITATION RECOVERY
-- ============================================================

create function public.release_personnel_invitation_recovery(
  p_target_id uuid,
  p_token_digest text,
  p_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.personnel_invitation_recovery_proofs
  set
    claim_id = null,
    claimed_password_digest = null,
    claimed_at = null
  where account_id = p_target_id
    and token_digest = p_token_digest
    and consumed_at is null
    and claim_id = p_claim_id;

  return found;
end;
$$;


-- ============================================================
-- FUNCTION PERMISSIONS
-- ============================================================

revoke all on function public.clear_personnel_invitation_recovery_proof()
from public, anon, authenticated;

revoke all on function public.clear_temporary_password_change_claim()
from public, anon, authenticated;

revoke all on function public.register_personnel_invitation_recovery(uuid, uuid, text)
from public, anon, authenticated;

revoke all on function public.begin_personnel_notification_send(uuid, uuid)
from public, anon, authenticated;

revoke all on function public.prepare_personnel_notification_link(uuid, uuid)
from public, anon, authenticated;

revoke all on function public.claim_personnel_notifications(integer, uuid)
from public, anon, authenticated;

revoke all on function public.release_personnel_temporary_password_change_lease(uuid, uuid, uuid)
from public, anon, authenticated;

revoke all on function public.begin_personnel_temporary_password_change(uuid, text)
from public, anon, authenticated;

revoke all on function public.release_personnel_temporary_password_change(uuid, uuid, uuid)
from public, anon, authenticated;

revoke all on function public.complete_claimed_temporary_personnel_password_change(uuid, uuid, uuid)
from public, anon, authenticated;

revoke all on function public.begin_personnel_invitation_recovery(uuid, text, text, timestamptz)
from public, anon, authenticated;

revoke all on function public.get_personnel_invitation_recovery_owner(text)
from public, anon, authenticated;

revoke all on function public.complete_personnel_invitation_recovery(uuid, text, uuid)
from public, anon, authenticated;

revoke all on function public.release_personnel_invitation_recovery(uuid, text, uuid)
from public, anon, authenticated;


-- ============================================================
-- SERVICE ROLE PERMISSIONS
-- ============================================================

grant execute on function public.register_personnel_invitation_recovery(uuid, uuid, text)
to service_role;

grant execute on function public.begin_personnel_notification_send(uuid, uuid)
to service_role;

grant execute on function public.prepare_personnel_notification_link(uuid, uuid)
to service_role;

grant execute on function public.claim_personnel_notifications(integer, uuid)
to service_role;

grant execute on function public.release_personnel_temporary_password_change_lease(uuid, uuid, uuid)
to service_role;

grant execute on function public.begin_personnel_temporary_password_change(uuid, text)
to service_role;

grant execute on function public.release_personnel_temporary_password_change(uuid, uuid, uuid)
to service_role;

grant execute on function public.complete_claimed_temporary_personnel_password_change(uuid, uuid, uuid)
to service_role;

grant execute on function public.begin_personnel_invitation_recovery(uuid, text, text, timestamptz)
to service_role;

grant execute on function public.get_personnel_invitation_recovery_owner(text)
to service_role;

grant execute on function public.complete_personnel_invitation_recovery(uuid, text, uuid)
to service_role;

grant execute on function public.release_personnel_invitation_recovery(uuid, text, uuid)
to service_role;


notify pgrst, 'reload schema';

commit;
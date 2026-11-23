begin;

-- Let scoped account managers resend setup invitations to personnel accounts
-- they are authorized to manage. Keep the resend atomic, audited, and safe when
-- an earlier mail send has an uncertain outcome.
create or replace function public.manager_resend_personnel_invitation(
  p_target_id uuid,
  p_actor_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_account public.personnel_accounts%rowtype;
  v_operation public.personnel_account_operations%rowtype;
  v_before jsonb;
  v_input jsonb := jsonb_build_object('action', 'invite', 'reason', '', 'activate', true);
begin
  perform pg_advisory_xact_lock(734920184);
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'An account operation id is required.';
  end if;

  select * into v_actor from public.profiles
    where id = p_actor_id and status = 'active' and role in ('phn', 'health_supervisor') for update;
  if not found then
    raise exception using errcode = '42501', message = 'An active PHN or Health Supervisor is required.';
  end if;

  select * into v_target from public.profiles where id = p_target_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Personnel account not found.'; end if;
  if (v_actor.role = 'phn' and not (
        v_target.role in ('health_supervisor', 'rhu_personnel')
        and v_actor.municipality_id is not null
        and v_target.municipality_id = v_actor.municipality_id
      )) or (v_actor.role = 'health_supervisor' and not (
        v_target.role = 'bhw'
        and v_actor.barangay_id is not null
        and v_target.barangay_id = v_actor.barangay_id
        and v_target.municipality_id = v_actor.municipality_id
      )) then
    raise exception using errcode = 'P0002', message = 'Personnel account not found in your authorized scope.';
  end if;

  select * into v_account from public.personnel_accounts where account_id = p_target_id for update;
  if not found then raise exception using errcode = '23514', message = 'This account has no personnel lifecycle record.'; end if;
  if v_account.approval_status <> 'approved' or not v_account.setup_required or v_account.suspended_at is not null then
    raise exception using errcode = '23514', message = 'Only approved, unsuspended accounts awaiting password setup can receive a new setup link.';
  end if;
  if exists (select 1 from public.personnel_notification_outbox where account_id = p_target_id
    and status in ('sending', 'delivery_unknown') and event_type in ('approved', 'reactivated', 'invitation')) then
    raise exception using errcode = '23514', message = 'Review the uncertain email outcome with the mail provider before sending another setup link.';
  end if;

  select * into v_operation from public.personnel_account_operations where id = p_operation_id for update;
  if found then
    if v_operation.actor_id is distinct from p_actor_id or v_operation.account_id <> p_target_id
      or v_operation.action <> 'invite' or v_operation.input <> v_input then
      raise exception using errcode = '23505', message = 'This operation id belongs to a different account action.';
    end if;
    if v_operation.completed_at is not null then return public.personnel_profile_json(p_target_id); end if;
  else
    insert into public.personnel_account_operations(id, actor_id, account_id, action, input)
      values (p_operation_id, p_actor_id, p_target_id, 'invite', v_input);
  end if;

  v_before := public.personnel_profile_json(p_target_id);
  perform public.personnel_cancel_unsent_email(p_target_id);
  perform public.personnel_queue_email(p_target_id, p_actor_id, 'invitation', '', p_operation_id);
  perform public.personnel_audit(
    p_target_id,
    p_actor_id,
    'ACCOUNT_INVITATION_REQUESTED',
    v_before,
    public.personnel_profile_json(p_target_id),
    jsonb_build_object('operation_id', p_operation_id, 'reason', '')
  );
  update public.personnel_account_operations set completed_at = now() where id = p_operation_id;
  return public.personnel_profile_json(p_target_id);
end;
$$;

revoke all on function public.manager_resend_personnel_invitation(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.manager_resend_personnel_invitation(uuid, uuid, uuid) to service_role;

commit;

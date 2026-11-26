-- supabase/migrations/20261117000000_admin_temporary_personnel_password.sql
begin;

alter table public.personnel_accounts
  add column must_change_password boolean not null default false,
  add column temporary_password_assigned_by uuid references public.profiles(id) on delete set null,
  add column temporary_password_assigned_at timestamptz,
  add column password_changed_at timestamptz;

create or replace function public.admin_create_personnel_account(p_actor_id uuid, p_operation_id uuid, p_profile jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_operation public.personnel_account_operations%rowtype;
  v_approval text;
  v_activate boolean;
  v_must_change boolean;
  v_stations text[];
begin
  perform pg_advisory_xact_lock(734920184);
  perform public.personnel_assert_admin(p_actor_id, array['accounts.create', 'accounts.roles.manage']);
  select * into v_operation from public.personnel_account_operations where id = p_operation_id for update;
  if not found or v_operation.actor_id is distinct from p_actor_id or v_operation.action <> 'create' or v_operation.input <> p_profile then
    raise exception using errcode = '42501', message = 'A matching administrator account reservation is required.';
  end if;
  if v_operation.completed_at is not null then return public.personnel_profile_json(v_operation.account_id); end if;

  v_approval := coalesce(p_profile ->> 'approval_status', 'approved');
  v_activate := coalesce((p_profile ->> 'activation_requested')::boolean, true);
  v_must_change := coalesce((p_profile ->> 'must_change_password')::boolean, false);
  if v_activate then perform public.personnel_assert_admin(p_actor_id, array['accounts.deactivate']); end if;
  if v_approval = 'approved' then perform public.personnel_assert_admin(p_actor_id, array['accounts.personnel.approve']); end if;
  if v_must_change then
    perform public.personnel_assert_admin(p_actor_id, array['accounts.personnel.approve']);
    if p_profile ->> 'role' not in ('mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw') then
      raise exception using errcode = '22023', message = 'Temporary passwords are limited to health personnel accounts.';
    end if;
  end if;
  if not exists (select 1 from auth.users u where u.id = v_operation.account_id
    and lower(btrim(u.email)) = lower(btrim(p_profile ->> 'email'))
    and u.raw_app_meta_data ->> 'personnel_managed' = 'true'
    and (not v_must_change or u.email_confirmed_at is not null)) then
    raise exception using errcode = '23514', message = 'The reserved Supabase Auth identity has not been securely created.';
  end if;
  if exists (select 1 from public.personnel_accounts where account_id = v_operation.account_id) then
    raise exception using errcode = '23505', message = 'This identity has already been provisioned by a different operation.';
  end if;
  if exists (select 1 from public.residents where auth_user_id = v_operation.account_id) then
    raise exception using errcode = '23514', message = 'This identity is now linked to a resident record. Preserve and reconcile the existing account instead of replacing its role.';
  end if;
  select array_agg(value) into v_stations from jsonb_array_elements_text(coalesce(p_profile -> 'rhu_stations', '[]'::jsonb));
  perform public.personnel_validate_stations((p_profile ->> 'role')::public.app_role, coalesce(v_stations, '{}'::text[]));
  perform public.admin_provision_profile(v_operation.account_id, p_actor_id, p_profile || jsonb_build_object('status', 'disabled'));
  insert into public.personnel_accounts(
    account_id, approval_status, activation_requested, activation_requested_by, setup_required,
    must_change_password, temporary_password_assigned_by, temporary_password_assigned_at,
    approved_by, approved_at, created_by, updated_by
  )
  values (
    v_operation.account_id, v_approval, v_activate, p_actor_id, true,
    v_must_change, case when v_must_change then p_actor_id end,
    case when v_must_change then now() end,
    case when v_approval = 'approved' then p_actor_id end,
    case when v_approval = 'approved' then now() end, p_actor_id, p_actor_id
  );
  update public.profiles set rhu_stations = coalesce(v_stations, '{}'::text[]),
    status = case when v_approval = 'pending' then 'pending_verification' else 'disabled' end
    where id = v_operation.account_id;
  update public.health_audit_logs h set metadata = h.metadata || jsonb_build_object(
    'operation_id', p_operation_id, 'new', public.personnel_profile_json(v_operation.account_id),
    'actor', jsonb_build_object('id', p_actor_id, 'name', actor.full_name, 'role', actor.role))
  from public.profiles actor where actor.id = p_actor_id and h.actor_id = p_actor_id
    and h.entity_type = 'profiles' and h.entity_id = v_operation.account_id::text and h.action = 'ACCOUNT_CREATED'
    and h.created_at >= transaction_timestamp() and not (h.metadata ? 'operation_id');
  if v_approval = 'approved' then
    perform public.personnel_audit(v_operation.account_id, p_actor_id, 'ACCOUNT_APPROVED', null,
      public.personnel_profile_json(v_operation.account_id),
      jsonb_build_object('operation_id', p_operation_id, 'activation_deferred_until_setup', true));
    perform public.personnel_queue_email(v_operation.account_id, p_actor_id, 'approved', '', p_operation_id);
  end if;
  update public.personnel_account_operations set completed_at = now() where id = p_operation_id;
  return public.personnel_profile_json(v_operation.account_id);
end;
$$;

create or replace function public.personnel_session_is_usable()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((select
    case when p.role in ('resident', 'resident-limited') then p.status in ('active', 'pending_verification')
    else p.status = 'active' and (a.account_id is null or
      (a.approval_status = 'approved' and not a.setup_required
        and not a.must_change_password and a.suspended_at is null)) end
    from public.profiles p left join public.personnel_accounts a on a.account_id = p.id
    where p.id = auth.uid()), false);
$$;

create function public.complete_temporary_personnel_password_change(p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_account public.personnel_accounts%rowtype;
  v_before jsonb;
  v_status text;
begin
  perform pg_advisory_xact_lock(734920184);
  select * into v_profile from public.profiles where id = p_target_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Personnel account not found.'; end if;
  select * into v_account from public.personnel_accounts where account_id = p_target_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Personnel account not found.'; end if;
  if not v_account.must_change_password then
    raise exception using errcode = '23514', message = 'This account does not require a temporary-password change.';
  end if;
  if v_account.approval_status <> 'approved' or v_account.suspended_at is not null then
    raise exception using errcode = '42501', message = 'Only an approved, unsuspended account can complete this password change.';
  end if;
  if not exists (select 1 from auth.users where id = p_target_id and email_confirmed_at is not null) then
    raise exception using errcode = '42501', message = 'The account email must be confirmed before completing this password change.';
  end if;

  v_before := public.personnel_profile_json(p_target_id);
  v_status := case when v_account.activation_requested then 'active' else 'disabled' end;
  if v_status = 'active' then perform public.personnel_assert_activation_scope(p_target_id); end if;
  update public.personnel_accounts set
    must_change_password = false,
    setup_required = false,
    setup_completed_at = now(),
    password_changed_at = now(),
    updated_by = p_target_id,
    updated_at = now(),
    version = version + 1
    where account_id = p_target_id;
  perform set_config('app.admin_account_rpc', 'true', true);
  update public.profiles set status = v_status where id = p_target_id;
  perform public.personnel_audit(p_target_id, p_target_id, 'ACCOUNT_TEMPORARY_PASSWORD_CHANGED', v_before,
    public.personnel_profile_json(p_target_id),
    jsonb_build_object('temporary_password_assigned_by', v_account.temporary_password_assigned_by));
  if v_status = 'active' then
    perform public.personnel_audit(p_target_id,
      coalesce(v_account.activation_requested_by, v_account.approved_by, v_account.created_by),
      'ACCOUNT_ACTIVATED', v_before, public.personnel_profile_json(p_target_id),
      jsonb_build_object('password_change_completed_by', p_target_id));
  end if;
  return public.personnel_profile_json(p_target_id);
end;
$$;

revoke all on function public.complete_temporary_personnel_password_change(uuid) from public, anon, authenticated;
grant execute on function public.complete_temporary_personnel_password_change(uuid) to service_role;

notify pgrst, 'reload schema';
commit;

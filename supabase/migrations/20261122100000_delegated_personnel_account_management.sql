-- supabase/migrations/20261122100000_delegated_personnel_account_management.sql
begin;

-- Delegated health-personnel management uses the existing personnel account
-- operation, audit, invitation, and activation machinery. It deliberately
-- does not touch the resident registration or linking workflows.

create function public.personnel_assert_delegated_scope(
  p_actor_id uuid,
  p_role text,
  p_municipality_id uuid,
  p_barangay_id uuid,
  p_facility_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
begin
  select * into v_actor from public.profiles where id = p_actor_id;
  if not found or v_actor.status <> 'active' then
    raise exception using errcode = '42501', message = 'An active health personnel account is required.';
  end if;
  if not exists (
    select 1 from public.personnel_accounts a where a.account_id = p_actor_id
      and a.approval_status = 'approved' and not a.setup_required
      and not a.must_change_password and a.suspended_at is null
  ) then
    raise exception using errcode = '42501', message = 'Complete account setup before managing personnel.';
  end if;

  if v_actor.role = 'phn' then
    if p_role not in ('health_supervisor', 'rhu_personnel')
        or v_actor.municipality_id is null or p_municipality_id is distinct from v_actor.municipality_id then
      raise exception using errcode = '42501', message = 'PHN personnel access is limited to Health Supervisor and RHU Personnel accounts in the assigned municipality.';
    end if;
    if not exists (select 1 from public.municipalities m where m.id = p_municipality_id and m.is_active) then
      raise exception using errcode = '22023', message = 'Choose an active municipality.';
    end if;
    if p_role = 'health_supervisor' and not exists (
      select 1 from public.barangays b where b.id = p_barangay_id
        and b.municipality_id = p_municipality_id and b.status = 'Active'
        and public.is_approved_barangay_name(b.name)
    ) then
      raise exception using errcode = '22023', message = 'Choose an approved active barangay in your municipality.';
    end if;
    if p_role = 'rhu_personnel' and not exists (
      select 1 from public.facilities f where f.id = p_facility_id
        and f.municipality_id = p_municipality_id and f.type = 'rhu'
    ) then
      raise exception using errcode = '22023', message = 'Choose an RHU facility in your municipality.';
    end if;
  elsif v_actor.role = 'health_supervisor' then
    if p_role <> 'bhw' or v_actor.barangay_id is null
        or p_barangay_id is distinct from v_actor.barangay_id
        or p_municipality_id is distinct from v_actor.municipality_id then
      raise exception using errcode = '42501', message = 'Health Supervisors can manage BHW accounts in their assigned barangay only.';
    end if;
    if not exists (
      select 1 from public.barangays b where b.id = p_barangay_id
        and b.municipality_id = p_municipality_id and b.status = 'Active'
        and public.is_approved_barangay_name(b.name)
    ) then
      raise exception using errcode = '22023', message = 'The assigned barangay must be approved and active.';
    end if;
  else
    raise exception using errcode = '42501', message = 'This role cannot manage health personnel accounts.';
  end if;
end;
$$;

create function public.delegated_reserve_personnel_account(
  p_actor_id uuid,
  p_operation_id uuid,
  p_profile jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.personnel_account_operations%rowtype;
  v_role text;
  v_municipality_id uuid;
  v_barangay_id uuid;
  v_facility_id uuid;
  v_stations text[];
begin
  perform pg_advisory_xact_lock(734920184);
  if p_operation_id is null then raise exception using errcode = '22023', message = 'An account operation id is required.'; end if;
  v_role := p_profile ->> 'role';
  v_municipality_id := nullif(p_profile ->> 'municipality_id', '')::uuid;
  v_barangay_id := nullif(p_profile ->> 'barangay_id', '')::uuid;
  v_facility_id := nullif(p_profile ->> 'facility_id', '')::uuid;
  perform public.personnel_assert_delegated_scope(p_actor_id, v_role, v_municipality_id, v_barangay_id, v_facility_id);
  if coalesce(p_profile ->> 'approval_status', 'approved') <> 'approved'
      or not coalesce((p_profile ->> 'activation_requested')::boolean, true)
      or not coalesce((p_profile ->> 'must_change_password')::boolean, false) then
    raise exception using errcode = '22023', message = 'Delegated personnel accounts must use the existing approved credential setup.';
  end if;
  if nullif(btrim(p_profile ->> 'full_name'), '') is null or length(p_profile ->> 'full_name') > 120
      or coalesce(p_profile ->> 'email', '') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or length(p_profile ->> 'email') > 255 then
    raise exception using errcode = '22023', message = 'Valid personnel name and email are required.';
  end if;
  if p_profile ?| array['password', 'token', 'action_link', 'service_role_key'] then
    raise exception using errcode = '22023', message = 'Credentials must not be stored in account operations.';
  end if;
  select array_agg(value) into v_stations from jsonb_array_elements_text(coalesce(p_profile -> 'rhu_stations', '[]'::jsonb));
  perform public.personnel_validate_stations(v_role::public.app_role, coalesce(v_stations, '{}'::text[]));

  select * into v_operation from public.personnel_account_operations where id = p_operation_id;
  if found then
    if v_operation.actor_id is distinct from p_actor_id or v_operation.action <> 'create' or v_operation.input <> p_profile then
      raise exception using errcode = '23505', message = 'This operation id belongs to a different account request.';
    end if;
    return jsonb_build_object('target_id', v_operation.account_id, 'completed', v_operation.completed_at is not null);
  end if;
  if exists (select 1 from auth.users where lower(btrim(email)) = lower(btrim(p_profile ->> 'email')))
      or exists (select 1 from public.profiles where lower(btrim(email)) = lower(btrim(p_profile ->> 'email'))) then
    raise exception using errcode = '23505', message = 'An account with this email already exists. Manage its existing identity.';
  end if;
  insert into public.personnel_account_operations(id, actor_id, account_id, action, input)
    values (p_operation_id, p_actor_id, gen_random_uuid(), 'create', p_profile) returning * into v_operation;
  return jsonb_build_object('target_id', v_operation.account_id, 'completed', false);
end;
$$;

create function public.delegated_create_personnel_account(
  p_actor_id uuid,
  p_operation_id uuid,
  p_profile jsonb,
  p_temporary_password_ciphertext text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.personnel_account_operations%rowtype;
  v_role text;
  v_municipality_id uuid;
  v_barangay_id uuid;
  v_facility_id uuid;
  v_stations text[];
  v_approval text;
  v_activate boolean;
begin
  perform pg_advisory_xact_lock(734920184);
  select * into v_operation from public.personnel_account_operations where id = p_operation_id for update;
  if not found or v_operation.actor_id is distinct from p_actor_id
      or v_operation.action <> 'create' or v_operation.input <> p_profile then
    raise exception using errcode = '42501', message = 'A matching delegated personnel reservation is required.';
  end if;
  if v_operation.completed_at is not null then return public.personnel_profile_json(v_operation.account_id); end if;
  v_role := p_profile ->> 'role';
  v_municipality_id := nullif(p_profile ->> 'municipality_id', '')::uuid;
  v_barangay_id := nullif(p_profile ->> 'barangay_id', '')::uuid;
  v_facility_id := nullif(p_profile ->> 'facility_id', '')::uuid;
  perform public.personnel_assert_delegated_scope(p_actor_id, v_role, v_municipality_id, v_barangay_id, v_facility_id);
  v_approval := coalesce(p_profile ->> 'approval_status', 'approved');
  v_activate := coalesce((p_profile ->> 'activation_requested')::boolean, true);
  if v_approval <> 'approved' or not v_activate
      or not coalesce((p_profile ->> 'must_change_password')::boolean, false)
      or p_temporary_password_ciphertext is null then
    raise exception using errcode = '22023', message = 'Delegated personnel accounts must be approved and activated through secure password setup.';
  end if;
  if not exists (
    select 1 from auth.users u where u.id = v_operation.account_id
      and lower(btrim(u.email)) = lower(btrim(p_profile ->> 'email'))
      and u.raw_app_meta_data ->> 'personnel_managed' = 'true'
      and u.email_confirmed_at is not null
  ) then
    raise exception using errcode = '23514', message = 'The reserved Supabase Auth identity has not been securely created.';
  end if;
  if exists (select 1 from public.personnel_accounts where account_id = v_operation.account_id)
      or exists (select 1 from public.residents where auth_user_id = v_operation.account_id) then
    raise exception using errcode = '23505', message = 'This identity is already linked to an existing account or resident record.';
  end if;
  select array_agg(value) into v_stations from jsonb_array_elements_text(coalesce(p_profile -> 'rhu_stations', '[]'::jsonb));
  perform public.personnel_validate_stations(v_role::public.app_role, coalesce(v_stations, '{}'::text[]));
  perform set_config('app.admin_account_rpc', 'true', true);
  update public.profiles set
    full_name = p_profile ->> 'full_name', email = lower(btrim(p_profile ->> 'email')),
    role = v_role::public.app_role, status = 'disabled',
    municipality_id = v_municipality_id, barangay_id = v_barangay_id, facility_id = v_facility_id,
    contact = coalesce(p_profile ->> 'contact', ''), position = coalesce(p_profile ->> 'position', ''),
    license_no = coalesce(p_profile ->> 'license_no', ''), rhu_stations = coalesce(v_stations, '{}'::text[])
    where id = v_operation.account_id;
  if not found then raise exception using errcode = '23514', message = 'Supabase Auth did not create the reserved profile.'; end if;
  insert into public.personnel_accounts(
    account_id, approval_status, activation_requested, activation_requested_by,
    setup_required, must_change_password, temporary_password_assigned_by,
    temporary_password_assigned_at, temporary_password_expires_at,
    approved_by, approved_at, created_by, updated_by
  ) values (
    v_operation.account_id, 'approved', true, p_actor_id,
    true, true, p_actor_id, now(), now() + interval '10 minutes',
    p_actor_id, now(), p_actor_id, p_actor_id
  );
  perform public.personnel_audit(v_operation.account_id, p_actor_id, 'ACCOUNT_CREATED', null,
    public.personnel_profile_json(v_operation.account_id), jsonb_build_object('operation_id', p_operation_id));
  perform public.personnel_audit(v_operation.account_id, p_actor_id, 'ACCOUNT_APPROVED', null,
    public.personnel_profile_json(v_operation.account_id), jsonb_build_object('operation_id', p_operation_id, 'activation_deferred_until_setup', true));
  perform public.personnel_queue_email(v_operation.account_id, p_actor_id, 'approved', '', p_operation_id);
  update public.personnel_notification_outbox set temporary_password_ciphertext = p_temporary_password_ciphertext
    where operation_id = p_operation_id;
  update public.personnel_account_operations set completed_at = now() where id = p_operation_id;
  return public.personnel_profile_json(v_operation.account_id);
end;
$$;

create function public.delegated_update_personnel_account(
  p_target_id uuid,
  p_actor_id uuid,
  p_profile jsonb,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.profiles%rowtype;
  v_account public.personnel_accounts%rowtype;
  v_operation public.personnel_account_operations%rowtype;
  v_before jsonb;
  v_requested_status text;
  v_actual_status text;
  v_event text;
  v_action text;
  v_reason text;
begin
  perform pg_advisory_xact_lock(734920184);
  if p_operation_id is null then raise exception using errcode = '22023', message = 'An account operation id is required.'; end if;
  select * into v_operation from public.personnel_account_operations where id = p_operation_id for update;
  if found then
    if v_operation.actor_id is distinct from p_actor_id or v_operation.account_id is distinct from p_target_id
        or v_operation.action <> 'edit' or (v_operation.input - 'expected_version') <> (p_profile - 'expected_version') then
      raise exception using errcode = '23505', message = 'This operation id belongs to a different account edit.';
    end if;
    if v_operation.completed_at is not null then return public.personnel_profile_json(p_target_id); end if;
  else
    insert into public.personnel_account_operations(id, actor_id, account_id, action, input)
      values (p_operation_id, p_actor_id, p_target_id, 'edit', p_profile);
  end if;
  select * into v_existing from public.profiles where id = p_target_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Personnel account not found.'; end if;
  select * into v_account from public.personnel_accounts where account_id = p_target_id for update;
  if not found then raise exception using errcode = '23514', message = 'This account has no personnel lifecycle record.'; end if;
  perform public.personnel_assert_delegated_scope(p_actor_id, v_existing.role::text, v_existing.municipality_id, v_existing.barangay_id, v_existing.facility_id);
  if v_existing.role::text is distinct from p_profile ->> 'role'
      or nullif(p_profile ->> 'municipality_id', '')::uuid is distinct from v_existing.municipality_id
      or nullif(p_profile ->> 'barangay_id', '')::uuid is distinct from v_existing.barangay_id
      or nullif(p_profile ->> 'facility_id', '')::uuid is distinct from v_existing.facility_id
      or coalesce(array(select jsonb_array_elements_text(coalesce(p_profile -> 'rhu_stations', '[]'::jsonb))), '{}'::text[]) is distinct from v_existing.rhu_stations then
    raise exception using errcode = '42501', message = 'Delegated managers cannot change personnel role or assignments.';
  end if;
  if p_profile ? 'approval_status' or p_profile ? 'email' or p_profile ? 'password'
      or p_profile ? 'token' or p_profile ? 'action_link' or p_profile ? 'service_role_key' then
    raise exception using errcode = '22023', message = 'This field cannot be changed through delegated personnel management.';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_profile) as field(key)
    where key not in ('full_name', 'contact', 'position', 'license_no', 'role', 'municipality_id',
      'barangay_id', 'facility_id', 'rhu_stations', 'status', 'expected_version', 'suspension_reason')
  ) then
    raise exception using errcode = '22023', message = 'The update contains fields unavailable to delegated personnel managers.';
  end if;
  if p_profile ? 'expected_version' and (p_profile ->> 'expected_version')::integer is distinct from v_account.version then
    raise exception using errcode = '40001', message = 'The account changed. Refresh the personnel list and try again.';
  end if;
  v_before := public.personnel_profile_json(p_target_id);
  v_requested_status := coalesce(p_profile ->> 'status', v_existing.status);
  v_actual_status := v_existing.status;
  if v_requested_status not in ('active', 'disabled') then
    raise exception using errcode = '22023', message = 'Choose Active or Deactivated.';
  end if;
  if v_requested_status = 'active' and v_existing.status <> 'active' then
    if v_account.approval_status <> 'approved' then raise exception using errcode = '23514', message = 'Approve this account before activating it.'; end if;
    update public.personnel_accounts set activation_requested = true, activation_requested_by = p_actor_id,
      suspended_at = null, suspended_by = null, suspension_reason = '' where account_id = p_target_id;
    v_account.activation_requested := true;
    v_account.suspended_at := null;
    v_actual_status := case when v_account.setup_required or v_account.must_change_password then 'disabled' else 'active' end;
    if v_actual_status = 'active' then perform public.personnel_assert_activation_scope(p_target_id); end if;
    v_action := 'ACCOUNT_REACTIVATED'; v_event := 'reactivated';
  elsif v_requested_status = 'disabled' and (v_existing.status <> 'disabled' or v_account.activation_requested) then
    v_reason := coalesce(nullif(btrim(p_profile ->> 'suspension_reason'), ''), 'Access suspended by a delegated health personnel manager.');
    update public.personnel_accounts set activation_requested = false,
      suspended_at = case when approval_status = 'approved' then now() else suspended_at end,
      suspended_by = case when approval_status = 'approved' then p_actor_id else suspended_by end,
      suspension_reason = case when approval_status = 'approved' then v_reason else suspension_reason end
      where account_id = p_target_id;
    v_account.activation_requested := false;
    v_actual_status := 'disabled'; v_action := 'ACCOUNT_SUSPENDED'; v_event := 'suspended';
  end if;
  perform set_config('app.admin_account_rpc', 'true', true);
  update public.profiles set
    full_name = coalesce(p_profile ->> 'full_name', full_name),
    contact = coalesce(p_profile ->> 'contact', contact),
    position = coalesce(p_profile ->> 'position', position),
    license_no = coalesce(p_profile ->> 'license_no', license_no),
    status = v_actual_status
    where id = p_target_id;
  update public.personnel_accounts set updated_by = p_actor_id, updated_at = now(), version = version + 1 where account_id = p_target_id;
  perform public.personnel_sync_legacy_request(p_target_id, p_actor_id);
  if v_action is not null then
    perform public.personnel_cancel_unsent_email(p_target_id);
    perform public.personnel_queue_email(p_target_id, p_actor_id, v_event, coalesce(v_reason, ''), p_operation_id);
    perform public.personnel_audit(p_target_id, p_actor_id, v_action, v_before,
      public.personnel_profile_json(p_target_id), jsonb_build_object('operation_id', p_operation_id));
  elsif coalesce(p_profile ->> 'full_name', v_existing.full_name) is distinct from v_existing.full_name
      or coalesce(p_profile ->> 'contact', v_existing.contact) is distinct from v_existing.contact
      or coalesce(p_profile ->> 'position', v_existing.position) is distinct from v_existing.position
      or coalesce(p_profile ->> 'license_no', v_existing.license_no) is distinct from v_existing.license_no then
    perform public.personnel_audit(p_target_id, p_actor_id, 'ACCOUNT_PROFILE_UPDATED', v_before,
      public.personnel_profile_json(p_target_id), jsonb_build_object('operation_id', p_operation_id));
  end if;
  update public.personnel_account_operations set completed_at = now() where id = p_operation_id;
  return public.personnel_profile_json(p_target_id);
end;
$$;

revoke all on function public.personnel_assert_delegated_scope(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.delegated_reserve_personnel_account(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.delegated_create_personnel_account(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.delegated_update_personnel_account(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.delegated_reserve_personnel_account(uuid, uuid, jsonb) to service_role;
grant execute on function public.delegated_create_personnel_account(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.delegated_update_personnel_account(uuid, uuid, jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
commit;

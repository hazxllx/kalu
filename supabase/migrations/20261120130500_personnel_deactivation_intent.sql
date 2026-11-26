-- supabase/migrations/20261120130500_personnel_deactivation_intent.sql
begin;

-- A requested disable must also cancel activation deferred until account setup.
create or replace function public.admin_update_personnel_account(p_target_id uuid, p_actor_id uuid, p_profile jsonb, p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_existing public.profiles%rowtype; v_updated public.profiles%rowtype; v_account public.personnel_accounts%rowtype;
  v_operation public.personnel_account_operations%rowtype; v_role public.app_role; v_stations text[];
  v_status text; v_requested_status text; v_before jsonb; v_event text; v_lifecycle_action text; v_reason text;
begin
  perform pg_advisory_xact_lock(734920184);
  perform public.personnel_assert_admin(p_actor_id, '{}'::text[]);
  if p_operation_id is null then raise exception using errcode = '22023', message = 'An account operation id is required.'; end if;
  select * into v_operation from public.personnel_account_operations where id = p_operation_id for update;
  if found then
    if v_operation.actor_id is distinct from p_actor_id or v_operation.account_id <> p_target_id
      or v_operation.action <> 'edit'
      or (v_operation.input - 'expected_version') <> (p_profile - 'expected_version') then
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
  if p_profile ? 'expected_version' and (p_profile ->> 'expected_version')::integer is distinct from v_account.version then
    raise exception using errcode = '40001', message = 'The account state changed. Refresh the account before retrying.';
  end if;
  if p_profile ?| array['password', 'token', 'action_link', 'service_role_key'] then
    raise exception using errcode = '22023', message = 'Credentials must not be stored in account operations.';
  end if;
  v_before := public.personnel_profile_json(p_target_id);
  v_role := coalesce((p_profile ->> 'role')::public.app_role, v_existing.role);
  if v_role is distinct from v_existing.role then perform public.personnel_assert_admin(p_actor_id, array['accounts.roles.manage']); end if;
  if p_profile ? 'approval_status' and p_profile ->> 'approval_status' <> v_account.approval_status then
    raise exception using errcode = '22023', message = 'Use an explicit approval or rejection decision.';
  end if;
  if p_profile ? 'rhu_stations' then
    select array_agg(value) into v_stations from jsonb_array_elements_text(p_profile -> 'rhu_stations');
    v_stations := coalesce(v_stations, '{}'::text[]);
  else v_stations := v_existing.rhu_stations;
  end if;
  if v_role is distinct from v_existing.role and v_role not in ('rhu_personnel', 'health_supervisor') then v_stations := '{}'::text[]; end if;
  if v_role is distinct from v_existing.role or v_stations is distinct from v_existing.rhu_stations
    or (p_profile ? 'facility_id' and nullif(p_profile ->> 'facility_id', '')::uuid is distinct from v_existing.facility_id) then
    perform public.personnel_validate_stations(v_role, v_stations);
  end if;
  if v_stations is distinct from v_existing.rhu_stations
    or (p_profile ? 'municipality_id' and nullif(p_profile ->> 'municipality_id', '')::uuid is distinct from v_existing.municipality_id)
    or (p_profile ? 'barangay_id' and nullif(p_profile ->> 'barangay_id', '')::uuid is distinct from v_existing.barangay_id)
    or (p_profile ? 'facility_id' and nullif(p_profile ->> 'facility_id', '')::uuid is distinct from v_existing.facility_id) then
    perform public.personnel_assert_admin(p_actor_id, array['accounts.roles.manage']);
  end if;
  if v_role is distinct from v_existing.role or v_stations is distinct from v_existing.rhu_stations
    or coalesce(p_profile ->> 'full_name', v_existing.full_name) is distinct from v_existing.full_name
    or coalesce(p_profile ->> 'position', v_existing.position) is distinct from v_existing.position
    or coalesce(p_profile ->> 'license_no', v_existing.license_no) is distinct from v_existing.license_no
    or coalesce(p_profile ->> 'contact', v_existing.contact) is distinct from v_existing.contact
    or (p_profile ? 'municipality_id' and nullif(p_profile ->> 'municipality_id', '')::uuid is distinct from v_existing.municipality_id)
    or (p_profile ? 'barangay_id' and nullif(p_profile ->> 'barangay_id', '')::uuid is distinct from v_existing.barangay_id)
    or (p_profile ? 'facility_id' and nullif(p_profile ->> 'facility_id', '')::uuid is distinct from v_existing.facility_id) then
    perform public.personnel_assert_admin(p_actor_id, array['accounts.edit']);
  end if;
  v_requested_status := coalesce(p_profile ->> 'status', v_existing.status);
  v_status := v_requested_status;
  if v_requested_status is distinct from v_existing.status
    or (p_profile ->> 'status' = 'disabled' and v_account.activation_requested) then
    perform public.personnel_assert_admin(p_actor_id, array['accounts.deactivate']);
    if v_requested_status = 'active' then
      if v_account.approval_status <> 'approved' then raise exception using errcode = '23514', message = 'Approve the account before activating it.'; end if;
      update public.personnel_accounts set activation_requested = true, activation_requested_by = p_actor_id,
        suspended_at = null, suspended_by = null, suspension_reason = '' where account_id = p_target_id;
      v_status := case when v_account.setup_required then 'disabled' else 'active' end;
      v_lifecycle_action := 'ACCOUNT_REACTIVATED'; v_event := 'reactivated';
    elsif v_requested_status = 'disabled' then
      v_reason := coalesce(nullif(btrim(p_profile ->> 'suspension_reason'), ''), 'Access suspended by an administrator.');
      update public.personnel_accounts set activation_requested = false,
        suspended_at = case when approval_status = 'approved' then now() else suspended_at end,
        suspended_by = case when approval_status = 'approved' then p_actor_id else suspended_by end,
        suspension_reason = case when approval_status = 'approved' then v_reason else suspension_reason end
        where account_id = p_target_id;
      v_lifecycle_action := case when v_account.approval_status = 'approved' then 'ACCOUNT_SUSPENDED' else 'ACCOUNT_ACTIVATION_WITHHELD' end;
      if v_account.approval_status = 'approved' then v_event := 'suspended'; end if;
    else raise exception using errcode = '22023', message = 'Personnel verification status is managed by approval decisions.';
    end if;
  end if;
  -- Existing assignment validation and last-administrator safeguards are reused.
  perform public.admin_update_profile(p_target_id, p_actor_id, p_profile || jsonb_build_object('status', v_status));
  update public.profiles set rhu_stations = v_stations where id = p_target_id returning * into v_updated;
  if v_status = 'active' and v_existing.status <> 'active' then perform public.personnel_assert_activation_scope(p_target_id); end if;
  update public.personnel_accounts set updated_by = p_actor_id, updated_at = now(), version = version + 1 where account_id = p_target_id;
  update public.health_audit_logs h set metadata = h.metadata || jsonb_build_object(
    'operation_id', p_operation_id, 'new', public.personnel_profile_json(p_target_id),
    'actor', jsonb_build_object('id', p_actor_id, 'name', actor.full_name, 'role', actor.role))
  from public.profiles actor where actor.id = p_actor_id and h.actor_id = p_actor_id
    and h.entity_type = 'profiles' and h.entity_id = p_target_id::text
    and h.created_at >= transaction_timestamp() and not (h.metadata ? 'operation_id');
  perform public.personnel_sync_legacy_request(p_target_id, p_actor_id);
  if v_existing.barangay_id is distinct from v_updated.barangay_id
    or v_existing.municipality_id is distinct from v_updated.municipality_id
    or v_existing.facility_id is distinct from v_updated.facility_id then
    perform public.personnel_audit(p_target_id, p_actor_id, 'ACCOUNT_ASSIGNMENT_CHANGED', v_before,
      public.personnel_profile_json(p_target_id), jsonb_build_object('operation_id', p_operation_id));
  end if;
  if v_existing.rhu_stations is distinct from v_updated.rhu_stations then
    perform public.personnel_audit(p_target_id, p_actor_id, 'ACCOUNT_STATIONS_CHANGED', v_before,
      public.personnel_profile_json(p_target_id), jsonb_build_object('operation_id', p_operation_id));
  end if;
  if v_lifecycle_action is not null then
    perform public.personnel_cancel_unsent_email(p_target_id);
    if v_event is not null then perform public.personnel_queue_email(p_target_id, p_actor_id, v_event, coalesce(v_reason, ''), p_operation_id); end if;
    perform public.personnel_audit(p_target_id, p_actor_id, v_lifecycle_action, v_before,
      public.personnel_profile_json(p_target_id), jsonb_build_object('operation_id', p_operation_id));
  end if;
  update public.personnel_account_operations set completed_at = now() where id = p_operation_id;
  return public.personnel_profile_json(p_target_id);
end;
$$;

-- Pending resident identities use the resident edit path without assigning staff roles.
create or replace function public.admin_update_profile(
  p_target_id uuid,
  p_actor_id uuid,
  p_profile jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.profiles%rowtype;
  v_updated public.profiles%rowtype;
  v_role public.app_role;
  v_status text;
  v_municipality_id uuid;
  v_barangay_id uuid;
  v_facility_id uuid;
  v_action text;
begin
  perform pg_advisory_xact_lock(734920184);

  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and role = 'admin' and status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An active administrator is required.';
  end if;

  select * into v_existing from public.profiles where id = p_target_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'User account not found.';
  end if;

  v_role := coalesce(nullif(p_profile ->> 'role', '')::public.app_role, v_existing.role);
  v_status := coalesce(nullif(p_profile ->> 'status', ''), v_existing.status);
  if v_role = 'resident-limited' and v_role is distinct from v_existing.role then
    raise exception using errcode = '22023', message = 'Resident (Pending Verification) is a system-managed role.';
  end if;
  if v_role not in ('admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw', 'resident', 'resident-limited') then
    raise exception using errcode = '22023', message = 'The selected role is invalid.';
  end if;
  if v_status not in ('active', 'disabled', 'pending_verification') then
    raise exception using errcode = '22023', message = 'The selected account status is invalid.';
  end if;
  if (v_role in ('resident', 'resident-limited')) is distinct from (v_existing.role in ('resident', 'resident-limited')) then
    raise exception using errcode = '22023', message = 'Resident accounts and staff roles must use their existing registration and linking workflows.';
  end if;

  if p_actor_id = p_target_id and (v_role <> 'admin' or v_status <> 'active') then
    raise exception using errcode = '23514', message = 'You cannot change or deactivate your own administrator access.';
  end if;
  if v_existing.role = 'admin'
     and v_existing.status = 'active'
     and (v_role <> 'admin' or v_status <> 'active')
     and not exists (
       select 1 from public.profiles
       where role = 'admin' and status = 'active' and id <> p_target_id
     ) then
    raise exception using errcode = '23514', message = 'This action would remove the system''s last Administrator account and cannot be completed.';
  end if;

  v_municipality_id := nullif(p_profile ->> 'municipality_id', '')::uuid;
  v_barangay_id := nullif(p_profile ->> 'barangay_id', '')::uuid;
  v_facility_id := nullif(p_profile ->> 'facility_id', '')::uuid;

  if v_role is not distinct from v_existing.role
     and v_municipality_id is not distinct from v_existing.municipality_id
     and v_barangay_id is not distinct from v_existing.barangay_id
     and v_facility_id is not distinct from v_existing.facility_id then
    v_municipality_id := v_existing.municipality_id;
    v_barangay_id := v_existing.barangay_id;
    v_facility_id := v_existing.facility_id;
  elsif v_role in ('health_supervisor', 'bhw') then
    if v_barangay_id is null then
      raise exception using errcode = '22023', message = 'A barangay assignment is required for this role.';
    end if;
    select b.municipality_id into v_municipality_id
    from public.barangays b
    join public.municipalities m on m.id = b.municipality_id and m.is_active
    where b.id = v_barangay_id and b.status = 'Active';
    if not found then
      raise exception using errcode = '22023', message = 'Select a valid active barangay.';
    end if;
    if v_facility_id is not null then
      raise exception using errcode = '22023', message = 'A barangay-scoped role cannot have a facility assignment.';
    end if;
  elsif v_role = 'rhu_personnel' then
    if v_facility_id is null then
      raise exception using errcode = '22023', message = 'A facility assignment is required for RHU Personnel.';
    end if;
    select f.municipality_id into v_municipality_id
    from public.facilities f
    join public.municipalities m on m.id = f.municipality_id and m.is_active
    where f.id = v_facility_id and f.type = 'rhu';
    if not found then
      raise exception using errcode = '22023', message = 'Select a valid facility.';
    end if;
    if v_barangay_id is not null then
      raise exception using errcode = '22023', message = 'RHU Personnel must use a facility assignment, not a barangay assignment.';
    end if;
  elsif v_role in ('mho', 'phn') then
    if v_municipality_id is null or not exists (
      select 1 from public.municipalities where id = v_municipality_id and is_active
    ) then
      raise exception using errcode = '22023', message = 'Select a valid active municipality.';
    end if;
    if v_barangay_id is not null or v_facility_id is not null then
      raise exception using errcode = '22023', message = 'This role uses municipality-wide scope only.';
    end if;
  elsif v_role = 'admin' then
    v_municipality_id := null;
    v_barangay_id := null;
    v_facility_id := null;
  elsif v_role in ('resident', 'resident-limited') then
    if v_existing.role not in ('resident', 'resident-limited') or not exists (
      select 1 from public.residents where auth_user_id = p_target_id
    ) then
      raise exception using errcode = '22023', message = 'Resident accounts must use the resident registration workflow.';
    end if;
  end if;

  perform set_config('app.admin_account_rpc', 'true', true);
  update public.profiles
  set full_name = case when p_profile ? 'full_name' then trim(p_profile ->> 'full_name') else full_name end,
      contact = case when p_profile ? 'contact' then coalesce(p_profile ->> 'contact', '') else contact end,
      position = case when p_profile ? 'position' then coalesce(p_profile ->> 'position', '') else position end,
      license_no = case when p_profile ? 'license_no' then coalesce(p_profile ->> 'license_no', '') else license_no end,
      role = v_role,
      status = v_status,
      municipality_id = v_municipality_id,
      barangay_id = v_barangay_id,
      facility_id = v_facility_id,
      updated_at = now()
  where id = p_target_id
  returning * into v_updated;

  v_action := case
    when v_existing.role is distinct from v_updated.role then 'ACCOUNT_ROLE_CHANGED'
    when v_existing.status <> 'disabled' and v_updated.status = 'disabled' then 'ACCOUNT_DEACTIVATED'
    when v_existing.status = 'disabled' and v_updated.status <> 'disabled' then 'ACCOUNT_REACTIVATED'
    else 'ACCOUNT_UPDATED'
  end;
  insert into public.health_audit_logs (
    actor_id, action, entity_type, entity_id, municipality_id, barangay_id, metadata
  ) values (
    p_actor_id,
    v_action,
    'profiles',
    p_target_id::text,
    v_updated.municipality_id,
    v_updated.barangay_id,
    jsonb_build_object(
      'email', v_updated.email,
      'previous', jsonb_build_object(
        'full_name', v_existing.full_name,
        'role', v_existing.role,
        'status', v_existing.status,
        'contact', v_existing.contact,
        'municipality_id', v_existing.municipality_id,
        'barangay_id', v_existing.barangay_id,
        'facility_id', v_existing.facility_id
      ),
      'new', jsonb_build_object(
        'full_name', v_updated.full_name,
        'role', v_updated.role,
        'status', v_updated.status,
        'contact', v_updated.contact,
        'municipality_id', v_updated.municipality_id,
        'barangay_id', v_updated.barangay_id,
        'facility_id', v_updated.facility_id
      )
    )
  );

  return to_jsonb(v_updated);
end;
$$;

notify pgrst, 'reload schema';
commit;

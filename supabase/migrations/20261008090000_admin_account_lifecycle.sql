begin;

create or replace function public.admin_provision_profile(
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
  v_profile public.profiles%rowtype;
  v_role public.app_role;
  v_status text;
  v_municipality_id uuid;
  v_barangay_id uuid;
  v_facility_id uuid;
begin
  perform pg_advisory_xact_lock(734920184);

  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and role = 'admin' and status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An active administrator is required.';
  end if;

  if p_profile ? 'role' then
    v_role := (p_profile ->> 'role')::public.app_role;
  else
    raise exception using errcode = '22023', message = 'A role is required.';
  end if;
  if v_role = 'resident' or v_role = 'resident-limited' then
    raise exception using errcode = '22023', message = 'Resident accounts must use the resident registration workflow.';
  end if;
  if v_role not in ('admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw') then
    raise exception using errcode = '22023', message = 'The selected role cannot be provisioned here.';
  end if;

  v_status := coalesce(p_profile ->> 'status', 'active');
  if v_status not in ('active', 'disabled') then
    raise exception using errcode = '22023', message = 'Choose Active or Disabled for a new account.';
  end if;

  v_municipality_id := nullif(p_profile ->> 'municipality_id', '')::uuid;
  v_barangay_id := nullif(p_profile ->> 'barangay_id', '')::uuid;
  v_facility_id := nullif(p_profile ->> 'facility_id', '')::uuid;

  if v_role in ('health_supervisor', 'bhw') then
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
  else
    v_municipality_id := null;
    v_barangay_id := null;
    v_facility_id := null;
  end if;

  perform set_config('app.admin_account_rpc', 'true', true);
  update public.profiles
  set email = lower(trim(p_profile ->> 'email')),
      full_name = trim(p_profile ->> 'full_name'),
      role = v_role,
      status = v_status,
      contact = coalesce(p_profile ->> 'contact', ''),
      municipality_id = v_municipality_id,
      barangay_id = v_barangay_id,
      facility_id = v_facility_id,
      position = coalesce(p_profile ->> 'position', ''),
      license_no = coalesce(p_profile ->> 'license_no', ''),
      updated_at = now()
  where id = p_target_id
  returning * into v_profile;

  if not found then
    raise exception using errcode = 'P0002', message = 'The invited account profile was not created.';
  end if;

  insert into public.health_audit_logs (
    actor_id, action, entity_type, entity_id, municipality_id, barangay_id, metadata
  ) values (
    p_actor_id,
    'ACCOUNT_CREATED',
    'profiles',
    p_target_id::text,
    v_profile.municipality_id,
    v_profile.barangay_id,
    jsonb_build_object(
      'email', v_profile.email,
      'full_name', v_profile.full_name,
      'role', v_profile.role,
      'status', v_profile.status,
      'municipality_id', v_profile.municipality_id,
      'barangay_id', v_profile.barangay_id,
      'facility_id', v_profile.facility_id
    )
  );

  return to_jsonb(v_profile);
end;
$$;

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
  if v_role = 'resident-limited' then
    raise exception using errcode = '22023', message = 'Resident (Pending Verification) is a system-managed role.';
  end if;
  if v_role not in ('admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw', 'resident') then
    raise exception using errcode = '22023', message = 'The selected role is invalid.';
  end if;
  if v_status not in ('active', 'disabled', 'pending_verification') then
    raise exception using errcode = '22023', message = 'The selected account status is invalid.';
  end if;
  if (v_role = 'resident') is distinct from (v_existing.role = 'resident') then
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
  elsif v_role = 'resident' then
    if v_existing.role <> 'resident' or not exists (
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

create or replace function public.log_profile_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.admin_account_rpc', true) = 'true' then
    return new;
  end if;
  if new.status is distinct from old.status or new.role is distinct from old.role then
    insert into public.health_audit_logs
      (actor_id, action, entity_type, entity_id, municipality_id, barangay_id, metadata)
    values (
      auth.uid(),
      case
        when new.status = 'active' and old.status = 'pending_verification' then 'ACCOUNT_APPROVED'
        when new.status = 'disabled' then 'ACCOUNT_DISABLED'
        when new.role is distinct from old.role then 'ACCOUNT_ROLE_CHANGED'
        else 'ACCOUNT_STATUS_CHANGED'
      end,
      'profiles',
      new.id::text,
      new.municipality_id,
      new.barangay_id,
      jsonb_build_object(
        'email', new.email,
        'full_name', new.full_name,
        'previous_status', old.status,
        'new_status', new.status,
        'previous_role', old.role::text,
        'new_role', new.role::text
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function public.admin_provision_profile(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_update_profile(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_provision_profile(uuid, uuid, jsonb) to service_role;
grant execute on function public.admin_update_profile(uuid, uuid, jsonb) to service_role;

commit;

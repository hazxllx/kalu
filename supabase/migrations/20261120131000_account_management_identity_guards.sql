-- supabase/migrations/20261120131000_account_management_identity_guards.sql
begin;

-- Permission changes must use the API's verified permission and audit checks.
drop policy if exists role_permissions_insert on public.role_permissions;
drop policy if exists role_permissions_update on public.role_permissions;
drop policy if exists role_permissions_delete on public.role_permissions;
revoke insert, update, delete, truncate, references, trigger on public.role_permissions from public, anon, authenticated;

create function public.admin_save_role_permissions(p_actor_id uuid, p_role public.app_role, p_permissions jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_entry record; v_previous boolean; v_changed integer := 0;
begin
  perform pg_advisory_xact_lock(734920184);
  perform public.personnel_assert_admin(p_actor_id, array['accounts.roles.manage']);
  if p_role is null or p_role = 'resident-limited' then
    raise exception using errcode = '22023', message = 'Unknown or unmanaged role.';
  end if;
  if jsonb_typeof(p_permissions) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'A permissions map is required.';
  end if;
  if p_role = 'admin' and p_permissions -> 'accounts.roles.manage' = 'false'::jsonb then
    raise exception using errcode = '23514', message = 'The administrator role must retain permission management access.';
  end if;
  for v_entry in select key, value from jsonb_each(p_permissions) loop
    if jsonb_typeof(v_entry.value) <> 'boolean' then
      raise exception using errcode = '22023', message = 'Permission values must be true or false.';
    end if;
    select granted into v_previous from public.role_permissions
      where role = p_role and permission_id = v_entry.key for update;
    insert into public.role_permissions(role, permission_id, granted, updated_by, updated_at)
      values (p_role, v_entry.key, v_entry.value::text::boolean, p_actor_id, now())
      on conflict (role, permission_id) do update set granted = excluded.granted,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    if v_previous is distinct from v_entry.value::text::boolean then
      insert into public.health_audit_logs(actor_id, action, entity_type, entity_id, metadata)
        values (p_actor_id, case when v_entry.value::text::boolean then 'permission.grant' else 'permission.revoke' end,
          'role_permissions', p_role::text, jsonb_build_object('role', p_role,
            'permissionId', v_entry.key, 'previousValue', v_previous, 'newValue', v_entry.value));
      v_changed := v_changed + 1;
    end if;
  end loop;
  return jsonb_build_object('role', p_role, 'permissions', p_permissions, 'changed', v_changed);
end;
$$;

revoke all on function public.admin_save_role_permissions(uuid, public.app_role, jsonb) from public, anon, authenticated;
grant execute on function public.admin_save_role_permissions(uuid, public.app_role, jsonb) to service_role;

create function public.guard_profile_auth_identity()
returns trigger language plpgsql set search_path = public
as $$
begin
  if auth.role() = 'authenticated'
    and (new.id is distinct from old.id or new.email is distinct from old.email) then
    raise exception using errcode = '42501',
      message = 'Account identity and email are managed by Supabase Auth.';
  end if;
  return new;
end;
$$;

create trigger profiles_auth_identity_guard
  before update of id, email on public.profiles
  for each row execute function public.guard_profile_auth_identity();

revoke all on function public.guard_profile_auth_identity() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;

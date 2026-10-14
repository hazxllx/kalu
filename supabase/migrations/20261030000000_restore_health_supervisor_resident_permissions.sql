-- Restore Health Supervisor resident-creation and login-account permissions
-- to their canonical defaults so the Resident Directory and Add Resident flow
-- behave consistently across the permission catalogue, the persisted matrix,
-- and backend authorization.
--
-- The frontend catalogue (frontend/src/lib/permissions.js) grants
-- health_supervisor: residents.directory.view, residents.profile.view,
-- residents.create, and accounts.create by default. The backend
-- authorize() + hasAnyConfiguredPermission() layer treats a missing row as
-- "bootstrap - allow via FEATURE_ROLES", but an explicit `granted = false`
-- row actively denies the Health Supervisor and surfaces as
-- "Your role does not have the required permission" on both the directory
-- table and the Add Resident modal. This can happen if an administrator
-- toggled the matrix or if the seed never wrote the row.
--
-- This migration ensures those four permissions are granted for
-- health_supervisor without overwriting any other role or permission, and
-- records an audit entry per changed permission (matching the existing
-- migration 20261014000000 pattern).
begin;

do $$
declare
  perm text;
  previous_value boolean;
  perms text[] := array[
    'residents.directory.view',
    'residents.profile.view',
    'residents.create',
    'accounts.create'
  ];
begin
  foreach perm in array perms loop
    select granted into previous_value
      from public.role_permissions
      where role = 'health_supervisor'
        and permission_id = perm;

    if previous_value is distinct from true then
      insert into public.role_permissions (role, permission_id, granted, updated_by)
      values ('health_supervisor', perm, true, null)
      on conflict (role, permission_id) do update
        set granted = excluded.granted,
            updated_by = null,
            updated_at = now();

      insert into public.health_audit_logs
        (actor_id, action, entity_type, entity_id, metadata)
      values (
        null,
        'permission.grant',
        'role_permissions',
        'health_supervisor',
        jsonb_build_object(
          'role', 'health_supervisor',
          'permissionId', perm,
          'previousValue', previous_value,
          'newValue', true,
          'source', 'migration',
          'reason', 'Restore Health Supervisor resident directory and login-account creation capability so Add Resident and Yes/No are available within barangay scope.'
        )
      );
    end if;
  end loop;
end;
$$;

commit;

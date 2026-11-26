-- supabase/migrations/20261126100000_reconcile_reviewer_role_permissions.sql
-- Keep the persisted RBAC matrix aligned with the operational reviewer
-- authority.  role_permissions is an override table, so a stale false row
-- can otherwise deny an account even though the application role defaults are
-- correct.
begin;

do $$
declare
  v_permission_id text;
  v_target_role text;
  previous_value boolean;
begin
  foreach v_target_role in array array['phn', 'health_supervisor'] loop
    foreach v_permission_id in array array[
      'residents.registration.approve',
      'accounts.personnel.approve'
    ] loop
      select granted
        into previous_value
        from public.role_permissions
       where role = v_target_role::public.app_role
         and role_permissions.permission_id = v_permission_id;

      if previous_value is distinct from true then
        insert into public.role_permissions (role, permission_id, granted, updated_by)
        values (v_target_role::public.app_role, v_permission_id, true, null)
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
          v_target_role,
          jsonb_build_object(
            'role', v_target_role,
            'permissionId', v_permission_id,
            'previousValue', previous_value,
            'newValue', true,
            'source', 'migration',
            'reason', 'Reconcile operational reviewer permissions with the role authority matrix.'
          )
        );
      end if;
    end loop;
  end loop;
end;
$$;

commit;

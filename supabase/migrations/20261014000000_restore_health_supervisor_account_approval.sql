-- The Health Supervisor's established staff-account authority includes BHW
-- and resident requests. Restore the persisted permission to its application
-- default so the sidebar, API authorization, and role matrix agree.
begin;

do $$
declare
  previous_value boolean;
begin
  select granted
    into previous_value
    from public.role_permissions
    where role = 'health_supervisor'
      and permission_id = 'accounts.personnel.approve';

  if previous_value is distinct from true then
    insert into public.role_permissions (role, permission_id, granted, updated_by)
    values ('health_supervisor', 'accounts.personnel.approve', true, null)
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
        'permissionId', 'accounts.personnel.approve',
        'previousValue', previous_value,
        'newValue', true,
        'source', 'migration',
        'reason', 'Restore the established Health Supervisor BHW/resident account approval capability.'
      )
    );
  end if;
end;
$$;

commit;

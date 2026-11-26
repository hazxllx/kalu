-- supabase/migrations/20261126110000_reconcile_consultation_role_permissions.sql
-- Reconcile consultation access for the roles whose operational defaults
-- include consultation work. Older sparse role_permissions rows could leave
-- these permissions absent/denied even though the role is authorized for the
-- consultation feature.
begin;

insert into public.role_permissions (role, permission_id, granted, updated_by)
select role_name::public.app_role, permission_id, true, null
from (values
  ('health_supervisor', 'consultation.requests.view'),
  ('health_supervisor', 'consultation.conduct'),
  ('health_supervisor', 'consultation.findings.record'),
  ('health_supervisor', 'consultation.records.update'),
  ('health_supervisor', 'consultation.history.view'),
  ('phn', 'consultation.requests.view'),
  ('phn', 'consultation.conduct'),
  ('phn', 'consultation.findings.record'),
  ('phn', 'consultation.records.update'),
  ('phn', 'consultation.history.view'),
  ('mho', 'consultation.history.view'),
  ('rhu_personnel', 'consultation.requests.view'),
  ('rhu_personnel', 'consultation.conduct'),
  ('rhu_personnel', 'consultation.findings.record'),
  ('rhu_personnel', 'consultation.history.view')
) as defaults(role_name, permission_id)
on conflict (role, permission_id) do update
  set granted = true,
      updated_by = null,
      updated_at = now();

insert into public.health_audit_logs
  (actor_id, action, entity_type, entity_id, metadata)
select null, 'permission.grant', 'role_permissions', role_name,
  jsonb_build_object(
    'role', role_name,
    'permissionId', permission_id,
    'newValue', true,
    'source', 'migration',
    'reason', 'Reconcile operational consultation permissions with role defaults.'
  )
from (values
  ('health_supervisor', 'consultation.requests.view'),
  ('health_supervisor', 'consultation.conduct'),
  ('health_supervisor', 'consultation.findings.record'),
  ('health_supervisor', 'consultation.records.update'),
  ('health_supervisor', 'consultation.history.view'),
  ('phn', 'consultation.requests.view'),
  ('phn', 'consultation.conduct'),
  ('phn', 'consultation.findings.record'),
  ('phn', 'consultation.records.update'),
  ('phn', 'consultation.history.view'),
  ('mho', 'consultation.history.view'),
  ('rhu_personnel', 'consultation.requests.view'),
  ('rhu_personnel', 'consultation.conduct'),
  ('rhu_personnel', 'consultation.findings.record'),
  ('rhu_personnel', 'consultation.history.view')
) as defaults(role_name, permission_id);

commit;

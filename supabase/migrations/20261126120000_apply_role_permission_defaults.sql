-- supabase/migrations/20261126120000_apply_role_permission_defaults.sql
-- Apply the canonical role matrix used by the Role & Permissions screen.
-- Administrator remains full-access. Operational roles are reset to the
-- least-privilege defaults so stale sparse overrides cannot cause recurring
-- permission failures or silently grant unrelated capabilities.
begin;

delete from public.role_permissions
 where role in ('mho', 'health_supervisor', 'phn', 'rhu_personnel', 'bhw', 'resident');

insert into public.role_permissions (role, permission_id, granted, updated_by)
select role_name::public.app_role, permission_id, true, null
from (values
  ('mho','residents.directory.view'),('mho','residents.profile.view'),('mho','certificates.request'),
  ('mho','residents.create'),('mho','accounts.create'),('mho','residents.transfer.approve'),
  ('mho','consultation.history.view'),('mho','referrals.view'),('mho','referrals.history.view'),
  ('mho','followups.view'),('mho','followups.history.view'),('mho','services.view'),
  ('mho','services.create'),('mho','services.edit'),('mho','services.delete'),
  ('mho','reports.view'),('mho','reports.generate'),('mho','reports.export'),('mho','reports.analytics.view'),

  ('health_supervisor','residents.directory.view'),('health_supervisor','residents.profile.view'),
  ('health_supervisor','residents.create'),('health_supervisor','residents.edit'),('health_supervisor','accounts.create'),
  ('health_supervisor','residents.registration.approve'),('health_supervisor','residents.transfer.approve'),
  ('health_supervisor','households.view'),('health_supervisor','households.verify'),
  ('health_supervisor','consultation.requests.view'),('health_supervisor','consultation.conduct'),
  ('health_supervisor','consultation.findings.record'),('health_supervisor','consultation.records.update'),
  ('health_supervisor','consultation.history.view'),('health_supervisor','triage.view'),
  ('health_supervisor','triage.perform'),('health_supervisor','triage.assessment.update'),('health_supervisor','triage.forward'),
  ('health_supervisor','referrals.view'),('health_supervisor','referrals.create'),('health_supervisor','referrals.approve'),
  ('health_supervisor','referrals.reject'),('health_supervisor','referrals.assign'),('health_supervisor','referrals.status.update'),
  ('health_supervisor','referrals.history.view'),('health_supervisor','followups.view'),('health_supervisor','followups.create'),
  ('health_supervisor','followups.edit'),('health_supervisor','followups.complete'),('health_supervisor','followups.history.view'),
  ('health_supervisor','followups.notify'),('health_supervisor','services.view'),('health_supervisor','services.create'),
  ('health_supervisor','services.edit'),('health_supervisor','services.delete'),('health_supervisor','reports.view'),
  ('health_supervisor','reports.generate'),('health_supervisor','reports.export'),('health_supervisor','reports.analytics.view'),
  ('health_supervisor','accounts.personnel.approve'),

  ('phn','residents.directory.view'),('phn','residents.profile.view'),('phn','certificates.request'),
  ('phn','residents.create'),('phn','residents.edit'),('phn','accounts.create'),('phn','residents.registration.approve'),
  ('phn','residents.transfer.approve'),('phn','households.view'),('phn','households.create'),
  ('phn','consultation.requests.view'),('phn','consultation.conduct'),('phn','consultation.findings.record'),
  ('phn','consultation.records.update'),('phn','consultation.history.view'),('phn','triage.view'),
  ('phn','referrals.view'),('phn','referrals.create'),('phn','referrals.approve'),('phn','referrals.reject'),
  ('phn','referrals.assign'),('phn','referrals.status.update'),('phn','referrals.history.view'),('phn','followups.view'),
  ('phn','followups.create'),('phn','followups.edit'),('phn','followups.complete'),('phn','followups.history.view'),
  ('phn','followups.notify'),('phn','services.view'),('phn','services.create'),('phn','services.edit'),
  ('phn','services.delete'),('phn','reports.view'),('phn','reports.generate'),('phn','reports.export'),
  ('phn','reports.analytics.view'),('phn','accounts.personnel.approve'),

  ('rhu_personnel','consultation.requests.view'),('rhu_personnel','consultation.conduct'),
  ('rhu_personnel','consultation.findings.record'),('rhu_personnel','consultation.history.view'),
  ('rhu_personnel','residents.create'),('rhu_personnel','residents.edit'),('rhu_personnel','residents.directory.view'),
  ('rhu_personnel','residents.profile.view'),('rhu_personnel','certificates.request'),('rhu_personnel','triage.view'),
  ('rhu_personnel','triage.perform'),('rhu_personnel','triage.assessment.update'),('rhu_personnel','triage.forward'),
  ('rhu_personnel','referrals.view'),('rhu_personnel','referrals.approve'),('rhu_personnel','referrals.reject'),
  ('rhu_personnel','referrals.status.update'),('rhu_personnel','referrals.history.view'),('rhu_personnel','reports.view'),
  ('rhu_personnel','services.view'),

  ('bhw','residents.create'),('bhw','residents.edit'),('bhw','residents.profile.view'),('bhw','households.view'),
  ('bhw','households.create'),('bhw','services.view'),('bhw','reports.generate'),

  ('resident','residents.profile.view'),('resident','consultation.requests.view'),('resident','consultation.history.view'),
  ('resident','referrals.view'),('resident','referrals.history.view'),('resident','followups.view'),('resident','followups.history.view')
) as grants(role_name, permission_id);

insert into public.health_audit_logs
  (actor_id, action, entity_type, entity_id, metadata)
values (
  null, 'permission.matrix.reconciled', 'role_permissions', 'all_operational_roles',
  jsonb_build_object('source', 'migration', 'reason', 'Apply canonical role-specific permission defaults.')
  );

commit;

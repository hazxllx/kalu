-- supabase/migrations/20261120133000_reconcile_provisioned_personnel.sql
begin;

-- Repair trusted, already-provisioned identities only. This is deliberately not
-- an Auth/profile trigger: public signup must never create personnel access.
create function public.reconcile_provisioned_personnel(p_target_id uuid default null)
returns integer language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  perform pg_advisory_xact_lock(734920184);
  insert into public.personnel_accounts (
    account_id, approval_status, activation_requested, setup_required,
    approved_by, approved_at, rejected_by, rejected_at, decision_reason, created_at, updated_at
  )
  select p.id,
    case
      when p.status = 'active' or r.status = 'approved' then 'approved'
      when r.status = 'rejected' then 'rejected'
      when p.status = 'pending_verification' or r.status in ('pending', 'resubmission_required') then 'pending'
      else 'approved'
    end,
    p.status = 'active', false,
    case when r.status = 'approved' then r.decided_by end,
    case when r.status = 'approved' then r.decided_at end,
    case when p.status <> 'active' and r.status = 'rejected' then r.decided_by end,
    case when p.status <> 'active' and r.status = 'rejected' then r.decided_at end,
    case when p.status <> 'active' and r.status = 'rejected' then r.rejection_reason else '' end,
    p.created_at, p.updated_at
  from public.profiles p
  join auth.users u on u.id = p.id
  left join lateral (
    select s.* from public.staff_account_requests s where s.auth_user_id = p.id
    order by (s.status = 'approved') desc, s.submitted_at desc, s.id desc limit 1
  ) r on true
  where (p_target_id is null or p.id = p_target_id)
    and p.role in ('admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw')
    and lower(btrim(p.email)) = lower(btrim(u.email))
    and not exists (select 1 from public.residents where auth_user_id = p.id)
    and coalesce(u.raw_app_meta_data ->> 'personnel_managed', 'false') <> 'true'
    and not exists (select 1 from public.personnel_account_operations o
      where o.account_id = p.id and o.action = 'create' and o.completed_at is null)
  on conflict (account_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reconcile_provisioned_personnel(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_provisioned_personnel(uuid) to service_role;

-- Preserve profiles, assignments, Auth, existing lifecycle decisions and mail.
select public.reconcile_provisioned_personnel();
notify pgrst, 'reload schema';
commit;

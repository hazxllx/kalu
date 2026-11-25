begin;

-- Keep the database RPC boundary aligned with the Express route and frontend.
-- Scope checks below remain authoritative: a Health Supervisor may still only
-- provision a BHW in their own approved, active barangay.
create or replace function public.personnel_assert_delegated_scope(
  p_actor_id uuid, p_role text, p_municipality_id uuid, p_barangay_id uuid, p_facility_id uuid
)
returns void language plpgsql security definer set search_path = public
as $$
declare v_actor public.profiles%rowtype;
begin
  select * into v_actor from public.profiles where id = p_actor_id;
  if not found or v_actor.status <> 'active' then
    raise exception using errcode = '42501', message = 'An active health personnel account is required.';
  end if;
  if not public.personnel_actor_has_permission(p_actor_id, 'accounts.create') then
    raise exception using errcode = '42501', message = 'Your role does not have permission to create personnel accounts.';
  end if;
  if not exists (
    select 1 from public.personnel_accounts a where a.account_id = p_actor_id
      and a.approval_status = 'approved' and not a.setup_required
      and not a.must_change_password and a.suspended_at is null
  ) then
    raise exception using errcode = '42501', message = 'Complete account setup before managing personnel.';
  end if;
  if v_actor.role = 'phn' then
    if p_role not in ('health_supervisor', 'rhu_personnel') or v_actor.municipality_id is null
        or p_municipality_id is distinct from v_actor.municipality_id then
      raise exception using errcode = '42501', message = 'PHN personnel access is limited to Health Supervisor and RHU Personnel accounts in the assigned municipality.';
    end if;
    if not exists (select 1 from public.municipalities m where m.id = p_municipality_id and m.is_active) then
      raise exception using errcode = '22023', message = 'Choose an active municipality.';
    end if;
    if p_role = 'health_supervisor' and not exists (select 1 from public.barangays b where b.id = p_barangay_id and b.municipality_id = p_municipality_id and b.status = 'Active' and public.is_approved_barangay_name(b.name)) then
      raise exception using errcode = '22023', message = 'Choose an approved active barangay in your municipality.';
    end if;
    if p_role = 'rhu_personnel' and not exists (select 1 from public.facilities f where f.id = p_facility_id and f.municipality_id = p_municipality_id and f.type = 'rhu') then
      raise exception using errcode = '22023', message = 'Choose an RHU facility in your municipality.';
    end if;
  elsif v_actor.role = 'health_supervisor' then
    if p_role <> 'bhw' or v_actor.barangay_id is null or p_barangay_id is distinct from v_actor.barangay_id
        or p_municipality_id is distinct from v_actor.municipality_id then
      raise exception using errcode = '42501', message = 'Health Supervisors can manage BHW accounts in their assigned barangay only.';
    end if;
    if not exists (select 1 from public.barangays b where b.id = p_barangay_id and b.municipality_id = p_municipality_id and b.status = 'Active' and public.is_approved_barangay_name(b.name)) then
      raise exception using errcode = '22023', message = 'The assigned barangay must be approved and active.';
    end if;
  else
    raise exception using errcode = '42501', message = 'This role cannot manage health personnel accounts.';
  end if;
end;
$$;

commit;

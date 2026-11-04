begin;

-- Profiles remain the authorization source. This sidecar separates an approval
-- decision from credential setup and activation without replacing any identity.
create table public.personnel_accounts (
  account_id uuid primary key references public.profiles(id) on delete cascade,
  approval_status text not null check (approval_status in ('pending', 'approved', 'rejected')),
  activation_requested boolean not null default false,
  activation_requested_by uuid references public.profiles(id) on delete set null,
  setup_required boolean not null default false,
  setup_completed_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  rejected_by uuid references public.profiles(id) on delete set null,
  rejected_at timestamptz,
  decision_reason text not null default '',
  suspended_by uuid references public.profiles(id) on delete set null,
  suspended_at timestamptz,
  suspension_reason text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  version bigint not null default 1
);

-- Reservations survive a lost Auth or database response. The target UUID is
-- reserved BEFORE Auth creation, so a retry never adopts a different identity.
create table public.personnel_account_operations (
  id uuid primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  account_id uuid not null,
  action text not null,
  input jsonb not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.personnel_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  account_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('approved', 'rejected', 'suspended', 'reactivated', 'invitation')),
  actor_id uuid references public.profiles(id) on delete set null,
  reason text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sending', 'sent', 'failed', 'delivery_unknown', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz default now(),
  last_error_code text,
  provider_message_id text,
  claim_token uuid,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index personnel_accounts_approval_idx on public.personnel_accounts(approval_status, created_at desc);
create index personnel_notification_due_idx on public.personnel_notification_outbox(next_attempt_at, created_at)
  where status in ('pending', 'failed');
create index personnel_notification_account_idx on public.personnel_notification_outbox(account_id, created_at desc);

-- Infer only the existing state. Do not change profiles, assignments, Auth,
-- historical decisions, or send retrospective approval emails on migration.
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
left join lateral (
  select s.* from public.staff_account_requests s where s.auth_user_id = p.id
  order by (s.status = 'approved') desc, s.submitted_at desc, s.id desc limit 1
) r on true
where p.role in ('admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw');

-- An empty permission matrix retains the existing role-based bootstrap. A
-- configured denial is never overwritten by this rollout.
with added as (
  insert into public.role_permissions(role, permission_id, granted)
  select 'admin', 'accounts.personnel.approve', true
  where exists (select 1 from public.role_permissions where role = 'admin')
  on conflict (role, permission_id) do nothing returning role, permission_id
)
insert into public.health_audit_logs(actor_id, action, entity_type, entity_id, metadata)
select null, 'permission.grant', 'role_permissions', role::text,
  jsonb_build_object('permissionId', permission_id, 'newValue', true, 'source', 'personnel_workflow_migration') from added;

create function public.personnel_actor_has_permission(p_actor_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.status = 'active'
      and (auth.uid() is null or auth.role() = 'service_role' or auth.uid() = p_actor_id)
      and (
        not exists (select 1 from public.role_permissions rp where rp.role = p.role)
        or exists (select 1 from public.role_permissions rp
          where rp.role = p.role and rp.permission_id = p_permission and rp.granted)
      )
  );
$$;

create function public.personnel_assert_admin(p_actor_id uuid, p_permissions text[])
returns void language plpgsql security definer set search_path = public
as $$
declare v_permission text;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'admin' and status = 'active') then
    raise exception using errcode = '42501', message = 'An active administrator is required.';
  end if;
  foreach v_permission in array p_permissions loop
    if not public.personnel_actor_has_permission(p_actor_id, v_permission) then
      raise exception using errcode = '42501', message = 'The administrator does not have the required account permission.';
    end if;
  end loop;
end;
$$;

create function public.personnel_profile_json(p_target_id uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select to_jsonb(p) || jsonb_build_object('personnel_account', to_jsonb(a))
  from public.profiles p left join public.personnel_accounts a on a.account_id = p.id
  where p.id = p_target_id;
$$;

create function public.personnel_audit(
  p_target_id uuid, p_actor_id uuid, p_action text, p_previous jsonb, p_new jsonb, p_extra jsonb default '{}'::jsonb
)
returns void language sql security definer set search_path = public
as $$
  insert into public.health_audit_logs(actor_id, action, entity_type, entity_id, municipality_id, barangay_id, metadata)
  select p_actor_id, p_action, 'profiles', p.id::text, p.municipality_id, p.barangay_id,
    jsonb_build_object('previous', p_previous, 'new', p_new) || p_extra ||
      jsonb_build_object('actor', jsonb_build_object('id', p_actor_id, 'name', actor.full_name, 'role', actor.role))
  from public.profiles p left join public.profiles actor on actor.id = p_actor_id where p.id = p_target_id;
$$;

-- Audit scope is historical attribution, not a new operational assignment.
-- An unchanged legacy barangay must not prevent an account correction/audit.
drop trigger if exists approved_barangay_assignment_guard on public.health_audit_logs;

create function public.personnel_queue_email(p_target_id uuid, p_actor_id uuid, p_event text, p_reason text, p_operation_id uuid)
returns void language sql security definer set search_path = public
as $$
  insert into public.personnel_notification_outbox(operation_id, account_id, actor_id, event_type, reason)
  values (p_operation_id, p_target_id, p_actor_id, p_event, coalesce(p_reason, ''))
  on conflict (operation_id) do nothing;
$$;

create function public.personnel_cancel_unsent_email(p_target_id uuid)
returns void language sql security definer set search_path = public
as $$
  update public.personnel_notification_outbox set status = 'cancelled', next_attempt_at = null
  where account_id = p_target_id and status in ('pending', 'processing', 'failed');
$$;

create function public.personnel_validate_stations(p_role public.app_role, p_stations text[])
returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_stations is null or not (p_stations <@ array['triage', 'consultation']::text[])
     or array_position(p_stations, null) is not null then
    raise exception using errcode = '22023', message = 'Choose only supported RHU stations.';
  end if;
  if p_role = 'rhu_personnel' and cardinality(p_stations) = 0 then
    raise exception using errcode = '22023', message = 'Assign at least one station to RHU Personnel.';
  end if;
  if p_role not in ('rhu_personnel', 'health_supervisor') and cardinality(p_stations) > 0 then
    raise exception using errcode = '22023', message = 'This role cannot hold an RHU station assignment.';
  end if;
end;
$$;

create function public.personnel_sync_legacy_request(p_target_id uuid, p_actor_id uuid, p_decision text default null, p_reason text default '')
returns void language plpgsql security definer set search_path = public
as $$
declare v_request public.staff_account_requests%rowtype; v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where id = p_target_id;
  select * into v_request from public.staff_account_requests where auth_user_id = p_target_id
    order by (status in ('pending', 'approved')) desc, submitted_at desc, id desc limit 1 for update;
  if not found then return; end if;
  update public.staff_account_requests
  set role = case when v_profile.role = 'admin' then role else v_profile.role end,
      municipality_id = v_profile.municipality_id, barangay_id = v_profile.barangay_id,
      facility_id = v_profile.facility_id, rhu_stations = v_profile.rhu_stations,
      status = coalesce(p_decision, status),
      rejection_reason = case when p_decision in ('rejected', 'resubmission_required') then coalesce(p_reason, '')
        when p_decision = 'approved' then '' else rejection_reason end,
      decided_by = case when p_decision is not null and p_decision is distinct from status then p_actor_id else decided_by end,
      decided_at = case when p_decision is not null and p_decision is distinct from status then now() else decided_at end
  where id = v_request.id;
end;
$$;

-- Client tokens must never mutate personnel roles/scopes or decisions directly,
-- including an administrator's own profile. Existing self-service contact edits
-- and resident verification policies are retained.
create function public.guard_personnel_profile_access()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_account public.personnel_accounts%rowtype;
begin
  if tg_op = 'DELETE' then
    if auth.role() in ('anon', 'authenticated')
      and old.role in ('admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw') then
      raise exception using errcode = '42501', message = 'Personnel identities are managed by the trusted API; suspend access instead.';
    end if;
    return old;
  end if;
  if auth.role() in ('anon', 'authenticated')
    and (old.role in ('admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw')
      or new.role in ('admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw'))
    and (new.role is distinct from old.role or new.status is distinct from old.status
      or new.municipality_id is distinct from old.municipality_id or new.barangay_id is distinct from old.barangay_id
      or new.facility_id is distinct from old.facility_id or new.rhu_stations is distinct from old.rhu_stations) then
    raise exception using errcode = '42501', message = 'Personnel access changes require the trusted account management API.';
  end if;
  select * into v_account from public.personnel_accounts where account_id = new.id;
  if found and new.status = 'active'
    and (v_account.approval_status <> 'approved' or v_account.setup_required or v_account.suspended_at is not null) then
    raise exception using errcode = '23514', message = 'Personnel access requires approval, credential setup and no suspension.';
  end if;
  return new;
end;
$$;
create trigger profiles_personnel_access_guard before update or delete on public.profiles
  for each row execute function public.guard_personnel_profile_access();

-- Role-based policies also fail closed for disabled/pending personnel tokens.
-- Pending residents retain their existing limited self-service behavior.
create or replace function public.profile_role()
returns public.app_role language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
    and (status = 'active' or (role in ('resident', 'resident-limited') and status = 'pending_verification'));
$$;
create or replace function public.profile_rhu_stations()
returns text[] language sql stable security definer set search_path = public
as $$
  select coalesce((select rhu_stations from public.profiles where id = auth.uid() and status = 'active'), '{}'::text[]);
$$;

-- Ownership/creator policies must not keep granting clinical access through a
-- still-valid JWT after suspension. Restrictive policies add a gate without
-- replacing any existing role, ownership, geographic, or resident policy.
create function public.personnel_session_is_usable()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((select
    case when p.role in ('resident', 'resident-limited') then p.status in ('active', 'pending_verification')
    else p.status = 'active' and (a.account_id is null or
      (a.approval_status = 'approved' and not a.setup_required and a.suspended_at is null)) end
    from public.profiles p left join public.personnel_accounts a on a.account_id = p.id
    where p.id = auth.uid()), false);
$$;

do $$
declare v_table record;
begin
  for v_table in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relrowsecurity and c.relkind in ('r', 'p')
      and c.relname not in ('profiles', 'personnel_accounts', 'personnel_account_operations', 'personnel_notification_outbox',
        'role_permissions', 'municipalities', 'barangays', 'facilities', 'approved_barangay_names')
  loop
    execute format('create policy personnel_account_access_gate on public.%I as restrictive for all to authenticated
      using ((select public.personnel_session_is_usable())) with check ((select public.personnel_session_is_usable()))', v_table.relname);
  end loop;
  if to_regclass('storage.objects') is not null then
    execute 'create policy personnel_account_access_gate on storage.objects as restrictive for all to authenticated
      using ((select public.personnel_session_is_usable())) with check ((select public.personnel_session_is_usable()))';
  end if;
end;
$$;

-- Close the unused older public personnel-application surface as well.
drop policy if exists account_applications_insert on public.account_applications;
drop policy if exists account_applications_update on public.account_applications;
drop policy if exists account_applications_delete on public.account_applications;
revoke insert, update, delete on public.account_applications from public, anon, authenticated;
drop policy if exists staff_account_requests_update on public.staff_account_requests;
revoke insert, update, delete on public.staff_account_requests from public, anon, authenticated;

-- The earlier NOT VALID phone check still rechecked unchanged legacy values on
-- every decision update. Validate new/changed numbers without forcing existing
-- personnel to recreate their accounts merely to retain an old contact value.
alter table public.staff_account_requests drop constraint if exists staff_account_requests_phone_format;
create function public.guard_staff_request_phone()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.phone is not distinct from old.phone then return new; end if;
  if new.phone <> '' and new.phone !~ '^09[0-9]{9}$' then
    raise exception using errcode = '22023', message = 'Use an 11-digit phone number starting with 09.';
  end if;
  return new;
end;
$$;
create trigger staff_request_phone_guard before insert or update of phone on public.staff_account_requests
  for each row execute function public.guard_staff_request_phone();

create or replace function public.can_approve_staff_request(target_role public.app_role, target_municipality uuid, target_barangay uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.can_approve_staff_role(target_role)
    and public.personnel_actor_has_permission(auth.uid(), 'accounts.personnel.approve')
    and case
      when public.profile_role() = 'phn' then target_municipality is not null
        and public.profile_municipality_id() is not null and target_municipality = public.profile_municipality_id()
      when public.profile_role() = 'health_supervisor' then target_barangay is not null
        and public.profile_barangay_id() is not null and target_barangay = public.profile_barangay_id()
      else false end;
$$;

alter table public.personnel_accounts enable row level security;
alter table public.personnel_account_operations enable row level security;
alter table public.personnel_notification_outbox enable row level security;
revoke all on public.personnel_accounts, public.personnel_account_operations, public.personnel_notification_outbox from public, anon, authenticated;
grant select on public.personnel_accounts to authenticated;
grant all on public.personnel_accounts, public.personnel_account_operations, public.personnel_notification_outbox to service_role;
create policy personnel_accounts_select on public.personnel_accounts for select to authenticated
  using (account_id = auth.uid() or (public.is_admin() and public.personnel_actor_has_permission(auth.uid(), 'accounts.view')));

create function public.admin_reserve_personnel_account(p_actor_id uuid, p_operation_id uuid, p_profile jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_operation public.personnel_account_operations%rowtype; v_approval text; v_stations text[];
begin
  perform pg_advisory_xact_lock(734920184);
  perform public.personnel_assert_admin(p_actor_id, array['accounts.create', 'accounts.roles.manage']);
  if p_operation_id is null then raise exception using errcode = '22023', message = 'An account operation id is required.'; end if;
  v_approval := coalesce(p_profile ->> 'approval_status', 'approved');
  if coalesce((p_profile ->> 'activation_requested')::boolean, true) then
    perform public.personnel_assert_admin(p_actor_id, array['accounts.deactivate']);
  end if;
  if v_approval not in ('pending', 'approved') then
    raise exception using errcode = '22023', message = 'New accounts must be pending or approved.';
  end if;
  if v_approval = 'approved' then perform public.personnel_assert_admin(p_actor_id, array['accounts.personnel.approve']); end if;
  if p_profile ->> 'role' not in ('admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw')
    or nullif(btrim(p_profile ->> 'full_name'), '') is null or length(p_profile ->> 'full_name') > 120
    or coalesce(p_profile ->> 'email', '') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(p_profile ->> 'email') > 255 then
    raise exception using errcode = '22023', message = 'Valid personnel identity and role are required.';
  end if;
  if p_profile ?| array['password', 'token', 'action_link', 'service_role_key'] then
    raise exception using errcode = '22023', message = 'Credentials must not be stored in account operations.';
  end if;
  select array_agg(value) into v_stations from jsonb_array_elements_text(coalesce(p_profile -> 'rhu_stations', '[]'::jsonb));
  perform public.personnel_validate_stations((p_profile ->> 'role')::public.app_role, coalesce(v_stations, '{}'::text[]));
  select * into v_operation from public.personnel_account_operations where id = p_operation_id;
  if found then
    if v_operation.actor_id is distinct from p_actor_id or v_operation.action <> 'create' or v_operation.input <> p_profile then
      raise exception using errcode = '23505', message = 'This operation id belongs to a different account request.';
    end if;
    return jsonb_build_object('target_id', v_operation.account_id, 'completed', v_operation.completed_at is not null);
  end if;
  if exists (select 1 from auth.users where lower(btrim(email)) = lower(btrim(p_profile ->> 'email')))
    or exists (select 1 from public.profiles where lower(btrim(email)) = lower(btrim(p_profile ->> 'email'))) then
    raise exception using errcode = '23505', message = 'An account with this email already exists. Manage its existing identity.';
  end if;
  insert into public.personnel_account_operations(id, actor_id, account_id, action, input)
    values (p_operation_id, p_actor_id, gen_random_uuid(), 'create', p_profile) returning * into v_operation;
  return jsonb_build_object('target_id', v_operation.account_id, 'completed', false);
end;
$$;

create function public.admin_create_personnel_account(p_actor_id uuid, p_operation_id uuid, p_profile jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_operation public.personnel_account_operations%rowtype; v_approval text; v_activate boolean; v_stations text[];
begin
  perform pg_advisory_xact_lock(734920184);
  perform public.personnel_assert_admin(p_actor_id, array['accounts.create', 'accounts.roles.manage']);
  select * into v_operation from public.personnel_account_operations where id = p_operation_id for update;
  if not found or v_operation.actor_id is distinct from p_actor_id or v_operation.action <> 'create' or v_operation.input <> p_profile then
    raise exception using errcode = '42501', message = 'A matching administrator account reservation is required.';
  end if;
  if v_operation.completed_at is not null then return public.personnel_profile_json(v_operation.account_id); end if;
  v_approval := coalesce(p_profile ->> 'approval_status', 'approved');
  v_activate := coalesce((p_profile ->> 'activation_requested')::boolean, true);
  if v_activate then perform public.personnel_assert_admin(p_actor_id, array['accounts.deactivate']); end if;
  if v_approval = 'approved' then perform public.personnel_assert_admin(p_actor_id, array['accounts.personnel.approve']); end if;
  if not exists (select 1 from auth.users u where u.id = v_operation.account_id
    and lower(btrim(u.email)) = lower(btrim(p_profile ->> 'email'))
    and u.raw_app_meta_data ->> 'personnel_managed' = 'true') then
    raise exception using errcode = '23514', message = 'The reserved Supabase Auth identity has not been securely created.';
  end if;
  if exists (select 1 from public.personnel_accounts where account_id = v_operation.account_id) then
    raise exception using errcode = '23505', message = 'This identity has already been provisioned by a different operation.';
  end if;
  if exists (select 1 from public.residents where auth_user_id = v_operation.account_id) then
    raise exception using errcode = '23514', message = 'This identity is now linked to a resident record. Preserve and reconcile the existing account instead of replacing its role.';
  end if;
  select array_agg(value) into v_stations from jsonb_array_elements_text(coalesce(p_profile -> 'rhu_stations', '[]'::jsonb));
  perform public.personnel_validate_stations((p_profile ->> 'role')::public.app_role, coalesce(v_stations, '{}'::text[]));
  perform public.admin_provision_profile(v_operation.account_id, p_actor_id, p_profile || jsonb_build_object('status', 'disabled'));
  insert into public.personnel_accounts(account_id, approval_status, activation_requested, activation_requested_by,
    setup_required, approved_by, approved_at, created_by, updated_by)
  values (v_operation.account_id, v_approval, v_activate, p_actor_id, true,
    case when v_approval = 'approved' then p_actor_id end, case when v_approval = 'approved' then now() end, p_actor_id, p_actor_id);
  update public.profiles set rhu_stations = coalesce(v_stations, '{}'::text[]),
    status = case when v_approval = 'pending' then 'pending_verification' else 'disabled' end
    where id = v_operation.account_id;
  update public.health_audit_logs h set metadata = h.metadata || jsonb_build_object(
    'operation_id', p_operation_id, 'new', public.personnel_profile_json(v_operation.account_id),
    'actor', jsonb_build_object('id', p_actor_id, 'name', actor.full_name, 'role', actor.role))
  from public.profiles actor where actor.id = p_actor_id and h.actor_id = p_actor_id
    and h.entity_type = 'profiles' and h.entity_id = v_operation.account_id::text and h.action = 'ACCOUNT_CREATED'
    and h.created_at >= transaction_timestamp() and not (h.metadata ? 'operation_id');
  if v_approval = 'approved' then
    perform public.personnel_audit(v_operation.account_id, p_actor_id, 'ACCOUNT_APPROVED', null,
      public.personnel_profile_json(v_operation.account_id), jsonb_build_object('operation_id', p_operation_id, 'activation_deferred_until_setup', true));
    perform public.personnel_queue_email(v_operation.account_id, p_actor_id, 'approved', '', p_operation_id);
  end if;
  update public.personnel_account_operations set completed_at = now() where id = p_operation_id;
  return public.personnel_profile_json(v_operation.account_id);
end;
$$;

create function public.personnel_assert_activation_scope(p_target_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where id = p_target_id;
  if v_profile.role in ('health_supervisor', 'bhw') and not exists (
    select 1 from public.barangays b join public.municipalities m on m.id = b.municipality_id
    where b.id = v_profile.barangay_id and b.municipality_id = v_profile.municipality_id
      and b.status = 'Active' and m.is_active and public.is_approved_barangay_name(b.name)
  ) then raise exception using errcode = '22023', message = 'Assign an approved active barangay before activating this account.';
  elsif v_profile.role = 'rhu_personnel' then
    if not exists (select 1 from public.facilities f join public.municipalities m on m.id = f.municipality_id
      where f.id = v_profile.facility_id and f.type = 'rhu' and f.municipality_id = v_profile.municipality_id and m.is_active) then
      raise exception using errcode = '22023', message = 'Assign an active RHU facility before activating this account.';
    end if;
    perform public.personnel_validate_stations(v_profile.role, v_profile.rhu_stations);
  elsif v_profile.role in ('mho', 'phn') and not exists (
    select 1 from public.municipalities where id = v_profile.municipality_id and is_active
  ) then raise exception using errcode = '22023', message = 'Assign an active municipality before activating this account.';
  end if;
end;
$$;

create function public.admin_transition_personnel_account(
  p_target_id uuid, p_actor_id uuid, p_action text, p_reason text, p_activate boolean, p_operation_id uuid
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_profile public.profiles%rowtype; v_account public.personnel_accounts%rowtype;
  v_operation public.personnel_account_operations%rowtype; v_email public.personnel_notification_outbox%rowtype;
  v_before jsonb; v_input jsonb; v_status text; v_action text; v_event text; v_changed boolean := true;
  v_reason text := btrim(coalesce(p_reason, '')); v_activate boolean := coalesce(p_activate, true);
begin
  perform pg_advisory_xact_lock(734920184);
  if p_action in ('approve', 'reject') then
    perform public.personnel_assert_admin(p_actor_id, array['accounts.personnel.approve']);
    if p_action = 'approve' and v_activate then perform public.personnel_assert_admin(p_actor_id, array['accounts.deactivate']); end if;
  elsif p_action in ('suspend', 'reactivate') then
    perform public.personnel_assert_admin(p_actor_id, array['accounts.deactivate']);
  elsif p_action in ('invite', 'retry_email') then
    perform public.personnel_assert_admin(p_actor_id, array['accounts.access.reset']);
  else raise exception using errcode = '22023', message = 'Unknown personnel account action.';
  end if;
  if p_operation_id is null then raise exception using errcode = '22023', message = 'An account operation id is required.'; end if;
  if p_actor_id = p_target_id and p_action in ('approve', 'reject', 'suspend', 'reactivate') then
    raise exception using errcode = '23514', message = 'You cannot approve or change your own administrator access.';
  end if;
  if p_action in ('reject', 'suspend') and (v_reason = '' or length(v_reason) > 1000) then
    raise exception using errcode = '22023', message = 'A reason of 1 to 1000 characters is required.';
  end if;
  v_input := jsonb_build_object('action', p_action, 'reason', v_reason, 'activate', v_activate);
  select * into v_operation from public.personnel_account_operations where id = p_operation_id for update;
  if found then
    if v_operation.actor_id is distinct from p_actor_id or v_operation.account_id <> p_target_id
      or v_operation.action <> p_action or v_operation.input <> v_input then
      raise exception using errcode = '23505', message = 'This operation id belongs to a different account action.';
    end if;
    if v_operation.completed_at is not null then return public.personnel_profile_json(p_target_id); end if;
  else
    insert into public.personnel_account_operations(id, actor_id, account_id, action, input)
      values (p_operation_id, p_actor_id, p_target_id, p_action, v_input);
  end if;
  select * into v_profile from public.profiles where id = p_target_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Personnel account not found.'; end if;
  if v_profile.role not in ('admin', 'mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw') then
    raise exception using errcode = '22023', message = 'Resident accounts use their existing verification workflow.';
  end if;
  select * into v_account from public.personnel_accounts where account_id = p_target_id for update;
  if not found then raise exception using errcode = '23514', message = 'This account has no personnel lifecycle record.'; end if;
  v_before := public.personnel_profile_json(p_target_id);
  v_status := v_profile.status;
  if p_action = 'approve' then
    if v_account.approval_status = 'approved' then
      -- Close an obsolete historical pending request, without reapproving the
      -- identity or sending another approval notification.
      perform public.personnel_sync_legacy_request(p_target_id, p_actor_id, 'approved');
      v_changed := false;
    else
      update public.personnel_accounts set approval_status = 'approved', approved_by = p_actor_id,
        approved_at = now(), decision_reason = '', activation_requested = v_activate,
        activation_requested_by = p_actor_id, updated_by = p_actor_id, updated_at = now(), version = version + 1
        where account_id = p_target_id returning * into v_account;
      v_status := case when v_activate and not v_account.setup_required and v_account.suspended_at is null then 'active' else 'disabled' end;
      v_action := 'ACCOUNT_APPROVED'; v_event := 'approved';
      perform public.personnel_sync_legacy_request(p_target_id, p_actor_id, 'approved');
    end if;
  elsif p_action = 'reject' then
    if v_account.approval_status = 'approved' then
      raise exception using errcode = '23514', message = 'Approved accounts must be suspended rather than rejected.';
    elsif v_account.approval_status = 'rejected' then v_changed := false;
    else
      update public.personnel_accounts set approval_status = 'rejected', rejected_by = p_actor_id,
        rejected_at = now(), decision_reason = v_reason, activation_requested = false,
        updated_by = p_actor_id, updated_at = now(), version = version + 1 where account_id = p_target_id;
      v_status := 'disabled'; v_action := 'ACCOUNT_REJECTED'; v_event := 'rejected';
      perform public.personnel_sync_legacy_request(p_target_id, p_actor_id, 'rejected', v_reason);
    end if;
  elsif p_action = 'suspend' then
    if v_account.approval_status <> 'approved' then
      raise exception using errcode = '23514', message = 'Reject an unapproved request; only approved accounts may be suspended.';
    elsif v_account.suspended_at is not null then v_changed := false;
    else
      if v_profile.role = 'admin' and v_profile.status = 'active' and not exists (
        select 1 from public.profiles where role = 'admin' and status = 'active' and id <> p_target_id
      ) then raise exception using errcode = '23514', message = 'The last active administrator cannot be suspended.'; end if;
      update public.personnel_accounts set suspended_by = p_actor_id, suspended_at = now(),
        suspension_reason = v_reason, activation_requested = false, updated_by = p_actor_id,
        updated_at = now(), version = version + 1 where account_id = p_target_id;
      v_status := 'disabled'; v_action := 'ACCOUNT_SUSPENDED'; v_event := 'suspended';
    end if;
  elsif p_action = 'reactivate' then
    if v_account.approval_status <> 'approved' then
      raise exception using errcode = '23514', message = 'Approve this account before requesting activation.';
    end if;
    v_status := case when v_activate and not v_account.setup_required then 'active' else 'disabled' end;
    if v_account.suspended_at is null and v_account.activation_requested = v_activate and v_profile.status = v_status then v_changed := false;
    else
      update public.personnel_accounts set suspended_by = null, suspended_at = null, suspension_reason = '',
        activation_requested = v_activate, activation_requested_by = p_actor_id, updated_by = p_actor_id,
        updated_at = now(), version = version + 1 where account_id = p_target_id;
      v_action := 'ACCOUNT_REACTIVATED'; v_event := 'reactivated';
    end if;
  elsif p_action = 'invite' then
    if v_account.approval_status <> 'approved' or not v_account.setup_required or v_account.suspended_at is not null then
      raise exception using errcode = '23514', message = 'Only approved unsuspended accounts awaiting password setup can be invited.';
    end if;
    if exists (select 1 from public.personnel_notification_outbox where account_id = p_target_id
      and status in ('sending', 'delivery_unknown') and event_type in ('approved', 'reactivated', 'invitation')) then
      raise exception using errcode = '23514', message = 'Review the uncertain email outcome with the mail provider before issuing another invitation.';
    end if;
    v_action := 'ACCOUNT_INVITATION_REQUESTED'; v_event := 'invitation';
  elsif p_action = 'retry_email' then
    select * into v_email from public.personnel_notification_outbox where account_id = p_target_id
      order by created_at desc, id desc limit 1 for update;
    if not found then raise exception using errcode = 'P0002', message = 'No personnel notification is available to retry.'; end if;
    if v_email.status in ('sent', 'pending', 'processing') then v_changed := false;
    elsif v_email.status <> 'failed' then
      raise exception using errcode = '23514', message = 'Only a definitively unsent failed email can be retried; uncertain deliveries require review.';
    else
      update public.personnel_notification_outbox set status = 'pending', attempts = 0,
        next_attempt_at = now(), claim_token = null, claimed_at = null where id = v_email.id;
      v_action := 'ACCOUNT_EMAIL_RETRY_REQUESTED';
    end if;
  end if;
  if v_changed then
    if v_status = 'active' then perform public.personnel_assert_activation_scope(p_target_id); end if;
    perform set_config('app.admin_account_rpc', 'true', true);
    if p_action not in ('invite', 'retry_email') then update public.profiles set status = v_status where id = p_target_id; end if;
    if v_event is not null then
      perform public.personnel_cancel_unsent_email(p_target_id);
      perform public.personnel_queue_email(p_target_id, p_actor_id, v_event, v_reason, p_operation_id);
    end if;
    perform public.personnel_audit(p_target_id, p_actor_id, v_action, v_before,
      public.personnel_profile_json(p_target_id), jsonb_build_object('operation_id', p_operation_id, 'reason', v_reason));
  end if;
  update public.personnel_account_operations set completed_at = now() where id = p_operation_id;
  return public.personnel_profile_json(p_target_id);
end;
$$;

create function public.admin_update_personnel_account(p_target_id uuid, p_actor_id uuid, p_profile jsonb, p_operation_id uuid)
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
      or v_operation.action <> 'edit' or v_operation.input <> p_profile then
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
  if v_requested_status is distinct from v_existing.status then
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

create function public.review_personnel_account_request(p_request_id uuid, p_actor_id uuid, p_decision text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_actor public.profiles%rowtype; v_request public.staff_account_requests%rowtype;
  v_profile public.profiles%rowtype; v_account public.personnel_accounts%rowtype;
  v_before jsonb; v_status text; v_event text; v_action text; v_operation_id uuid := gen_random_uuid();
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform pg_advisory_xact_lock(734920184);
  select * into v_actor from public.profiles where id = p_actor_id and status = 'active';
  if not found or not public.personnel_actor_has_permission(p_actor_id, 'accounts.personnel.approve') then
    raise exception using errcode = '42501', message = 'An authorized active account reviewer is required.';
  end if;
  select * into v_request from public.staff_account_requests where id = p_request_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Personnel request not found.'; end if;
  if p_actor_id = v_request.auth_user_id then
    raise exception using errcode = '42501', message = 'You cannot approve your own account request.';
  end if;
  if not (
    (v_actor.role = 'phn' and v_request.role in ('health_supervisor', 'rhu_personnel')
      and v_actor.municipality_id is not null and v_request.municipality_id is not null and v_request.municipality_id = v_actor.municipality_id)
    or (v_actor.role = 'health_supervisor' and v_request.role in ('bhw', 'resident')
      and v_actor.barangay_id is not null and v_request.barangay_id is not null and v_request.barangay_id = v_actor.barangay_id
      and v_actor.municipality_id is not null and v_request.municipality_id is not null and v_request.municipality_id = v_actor.municipality_id)
  ) then raise exception using errcode = '42501', message = 'The requested role or assignment is outside your approval authority.'; end if;
  perform public.personnel_assert_activation_scope(p_actor_id);
  if p_decision not in ('approved', 'rejected', 'resubmission_required') then
    raise exception using errcode = '22023', message = 'Unknown personnel review decision.';
  end if;
  if p_decision <> 'approved' and (v_reason = '' or length(v_reason) > 1000) then
    raise exception using errcode = '22023', message = 'A decision reason of 1 to 1000 characters is required.';
  end if;
  select * into v_profile from public.profiles where id = v_request.auth_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'The existing account profile is unavailable.'; end if;
  if v_request.status = p_decision then
    return to_jsonb(v_request) || jsonb_build_object('profileStatus', v_profile.status);
  end if;
  if v_request.status = 'approved' then
    raise exception using errcode = '23514', message = 'Approved accounts must be managed through suspension, not another review decision.';
  end if;
  if v_profile.role is distinct from v_request.role
    or v_profile.municipality_id is distinct from v_request.municipality_id
    or v_profile.barangay_id is distinct from v_request.barangay_id
    or v_profile.facility_id is distinct from v_request.facility_id then
    raise exception using errcode = '23514', message = 'The account assignment has changed. Ask an administrator to reconcile the existing request.';
  end if;
  v_before := public.personnel_profile_json(v_profile.id);
  if v_request.role <> 'resident' then
    select * into v_account from public.personnel_accounts where account_id = v_profile.id for update;
    if not found then raise exception using errcode = '23514', message = 'The personnel lifecycle record is missing.'; end if;
    if v_account.created_by is not null or v_account.approval_status = 'approved' or v_account.suspended_at is not null then
      raise exception using errcode = '23514', message = 'This account is already managed internally; its existing approval or suspension cannot be overwritten.';
    end if;
    if p_decision = 'approved' then perform public.personnel_validate_stations(v_profile.role, v_request.rhu_stations); end if;
    update public.personnel_accounts set
      approval_status = case when p_decision = 'resubmission_required' then 'pending' else p_decision end,
      activation_requested = p_decision = 'approved', activation_requested_by = case when p_decision = 'approved' then p_actor_id else activation_requested_by end,
      approved_by = case when p_decision = 'approved' then p_actor_id else approved_by end,
      approved_at = case when p_decision = 'approved' then now() else approved_at end,
      rejected_by = case when p_decision = 'rejected' then p_actor_id else rejected_by end,
      rejected_at = case when p_decision = 'rejected' then now() else rejected_at end,
      decision_reason = case when p_decision = 'approved' then '' else v_reason end,
      updated_by = p_actor_id, updated_at = now(), version = version + 1
      where account_id = v_profile.id returning * into v_account;
    v_status := case when p_decision = 'approved' and not v_account.setup_required then 'active'
      when p_decision = 'resubmission_required' then 'pending_verification' else 'disabled' end;
  else
    -- Retain the resident-specific semantics for any historical request row;
    -- ordinary resident registration continues through its own verification API.
    v_status := case when p_decision = 'approved' then 'active'
      when p_decision = 'resubmission_required' then 'pending_verification' else 'disabled' end;
  end if;
  perform set_config('app.admin_account_rpc', 'true', true);
  update public.profiles set status = v_status,
    rhu_stations = case when v_request.role = 'resident' then rhu_stations else v_request.rhu_stations end
    where id = v_profile.id;
  if v_status = 'active' and v_request.role <> 'resident' then perform public.personnel_assert_activation_scope(v_profile.id); end if;
  update public.staff_account_requests set status = p_decision,
    rejection_reason = case when p_decision = 'approved' then '' else v_reason end,
    decided_by = p_actor_id, decided_at = now() where id = p_request_id returning * into v_request;
  v_action := case p_decision when 'approved' then 'ACCOUNT_APPROVED' when 'rejected' then 'ACCOUNT_REJECTED' else 'ACCOUNT_RESUBMISSION_REQUESTED' end;
  perform public.personnel_audit(v_profile.id, p_actor_id, v_action, v_before,
    public.personnel_profile_json(v_profile.id), jsonb_build_object('request_id', p_request_id, 'reason', v_reason));
  if v_request.role <> 'resident' then
    perform public.personnel_cancel_unsent_email(v_profile.id);
    v_event := case p_decision when 'approved' then 'approved' when 'rejected' then 'rejected' else null end;
    if v_event is not null then perform public.personnel_queue_email(v_profile.id, p_actor_id, v_event, v_reason, v_operation_id); end if;
  end if;
  return to_jsonb(v_request) || jsonb_build_object('profileStatus', v_status);
end;
$$;

create function public.complete_personnel_account_setup(p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_profile public.profiles%rowtype; v_account public.personnel_accounts%rowtype; v_before jsonb; v_status text;
begin
  perform pg_advisory_xact_lock(734920184);
  select * into v_profile from public.profiles where id = p_target_id for update;
  select * into v_account from public.personnel_accounts where account_id = p_target_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Personnel account not found.'; end if;
  if v_account.approval_status <> 'approved' or v_account.suspended_at is not null then
    raise exception using errcode = '42501', message = 'Only an approved unsuspended account can complete invitation setup.';
  end if;
  if not exists (select 1 from auth.users where id = p_target_id and email_confirmed_at is not null) then
    raise exception using errcode = '42501', message = 'Verify the invitation email before completing password setup.';
  end if;
  if not v_account.setup_required then return public.personnel_profile_json(p_target_id); end if;
  v_before := public.personnel_profile_json(p_target_id);
  v_status := case when v_account.activation_requested then 'active' else 'disabled' end;
  if v_status = 'active' then perform public.personnel_assert_activation_scope(p_target_id); end if;
  update public.personnel_accounts set setup_required = false, setup_completed_at = now(), updated_at = now(), version = version + 1
    where account_id = p_target_id;
  perform set_config('app.admin_account_rpc', 'true', true);
  update public.profiles set status = v_status where id = p_target_id;
  perform public.personnel_audit(p_target_id, p_target_id, 'ACCOUNT_PASSWORD_SETUP_COMPLETED', v_before,
    public.personnel_profile_json(p_target_id));
  if v_status = 'active' then
    perform public.personnel_audit(p_target_id, coalesce(v_account.activation_requested_by, v_account.approved_by, v_account.created_by),
      'ACCOUNT_ACTIVATED', v_before, public.personnel_profile_json(p_target_id), jsonb_build_object('setup_completed_by', p_target_id));
  end if;
  return public.personnel_profile_json(p_target_id);
end;
$$;

-- Retain ordinary administrative/resident deletion, but a role change must not
-- turn personnel history into an accidentally cascade-deletable identity.
create or replace function public.admin_assert_account_deletable(p_target_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_target public.profiles%rowtype;
begin
  perform pg_advisory_xact_lock(734920184);
  perform public.personnel_assert_admin(p_actor_id, array['accounts.delete']);
  select * into v_target from public.profiles where id = p_target_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'User account not found.'; end if;
  if p_actor_id = p_target_id then
    raise exception using errcode = '23514', message = 'You cannot delete your own administrator account.';
  end if;
  if v_target.role in ('mho', 'phn', 'health_supervisor', 'rhu_personnel', 'bhw')
    or exists (select 1 from public.staff_account_requests where auth_user_id = p_target_id)
    or exists (select 1 from public.health_service_assignments where personnel_id = p_target_id) then
    raise exception using errcode = '23514', message = 'Suspend this account instead of deleting its personnel identity and related history.';
  end if;
  if v_target.role = 'admin' and v_target.status = 'active' and not exists (
    select 1 from public.profiles where role = 'admin' and status = 'active' and id <> p_target_id
  ) then raise exception using errcode = '23514', message = 'The last active administrator cannot be deleted.'; end if;
  return jsonb_build_object('id', v_target.id, 'email', v_target.email, 'full_name', v_target.full_name,
    'role', v_target.role, 'status', v_target.status, 'municipality_id', v_target.municipality_id,
    'barangay_id', v_target.barangay_id, 'facility_id', v_target.facility_id);
end;
$$;

create function public.claim_personnel_notifications(p_limit integer default 10, p_target_id uuid default null)
returns setof public.personnel_notification_outbox language plpgsql security definer set search_path = public
as $$
begin
  -- SMTP might already have accepted a stale sending job. Never resend it.
  update public.personnel_notification_outbox set status = 'delivery_unknown', next_attempt_at = null,
    last_error_code = 'SMTP_ACCEPTANCE_UNKNOWN'
    where status = 'sending' and claimed_at < now() - interval '5 minutes';
  -- Processing has not crossed the SMTP boundary and can safely be reclaimed.
  update public.personnel_notification_outbox set status = 'failed', claim_token = null, claimed_at = null,
    next_attempt_at = case when attempts < 8 then now() else null end, last_error_code = 'PROCESSING_LEASE_EXPIRED'
    where status = 'processing' and claimed_at < now() - interval '5 minutes';
  return query
    with due as (
      select j.id from public.personnel_notification_outbox j
      where j.status in ('pending', 'failed') and j.next_attempt_at <= now() and j.attempts < 8
        and (p_target_id is null or j.account_id = p_target_id)
      order by j.next_attempt_at, j.created_at, j.id
      limit greatest(1, least(coalesce(p_limit, 10), 100)) for update skip locked
    )
    update public.personnel_notification_outbox j set status = 'processing', claim_token = gen_random_uuid(),
      claimed_at = now(), attempts = j.attempts + 1, next_attempt_at = null
    from due where j.id = due.id returning j.*;
end;
$$;

create function public.begin_personnel_notification_send(p_notification_id uuid, p_claim_token uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_job public.personnel_notification_outbox%rowtype; v_account public.personnel_accounts%rowtype; v_valid boolean;
begin
  select * into v_job from public.personnel_notification_outbox where id = p_notification_id
    and status = 'processing' and claim_token = p_claim_token for update;
  if not found then return false; end if;
  select * into v_account from public.personnel_accounts where account_id = v_job.account_id;
  v_valid := found and case
    when v_job.event_type in ('approved', 'reactivated', 'invitation') then v_account.approval_status = 'approved' and v_account.suspended_at is null
    when v_job.event_type = 'rejected' then v_account.approval_status = 'rejected'
    when v_job.event_type = 'suspended' then v_account.suspended_at is not null
    else false end;
  if not coalesce(v_valid, false) then
    update public.personnel_notification_outbox set status = 'cancelled', next_attempt_at = null where id = v_job.id;
    return false;
  end if;
  update public.personnel_notification_outbox set status = 'sending', claimed_at = now() where id = v_job.id;
  return true;
end;
$$;

create function public.finish_personnel_notification(
  p_notification_id uuid, p_claim_token uuid, p_status text, p_error_code text default null, p_provider_id text default null
)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_job public.personnel_notification_outbox%rowtype;
begin
  if p_status not in ('sent', 'failed', 'delivery_unknown', 'cancelled') then
    raise exception using errcode = '22023', message = 'Unknown notification outcome.';
  end if;
  select * into v_job from public.personnel_notification_outbox where id = p_notification_id
    and status in ('processing', 'sending') and claim_token = p_claim_token for update;
  if not found then return false; end if;
  if p_status in ('sent', 'delivery_unknown') and v_job.status <> 'sending' then return false; end if;
  update public.personnel_notification_outbox set status = p_status,
    sent_at = case when p_status = 'sent' then now() else sent_at end,
    provider_message_id = case when p_status = 'sent' then left(p_provider_id, 250) else provider_message_id end,
    last_error_code = case when p_status = 'sent' then null else left(regexp_replace(coalesce(p_error_code, 'EMAIL_FAILED'), '[^A-Z0-9_]', '', 'g'), 80) end,
    next_attempt_at = case when p_status = 'failed' and attempts < 8
      then now() + interval '1 minute' * least(360::double precision, power(2::double precision, greatest(attempts - 1, 0))) else null end
    where id = v_job.id;
  if p_status <> 'cancelled' then
    -- Preserve delivery failures after a successful retry clears the current
    -- outbox error. The worker is the actor; the administrator is the initiator.
    perform public.personnel_audit(v_job.account_id, null,
      case p_status when 'sent' then 'ACCOUNT_EMAIL_ACCEPTED' when 'failed' then 'ACCOUNT_EMAIL_FAILED' else 'ACCOUNT_EMAIL_OUTCOME_UNCERTAIN' end,
      jsonb_build_object('status', v_job.status, 'attempts', v_job.attempts),
      jsonb_build_object('status', p_status, 'attempts', v_job.attempts,
        'reason', case when p_status = 'sent' then null else left(regexp_replace(coalesce(p_error_code, 'EMAIL_FAILED'), '[^A-Z0-9_]', '', 'g'), 80) end),
      jsonb_build_object('notification_id', v_job.id, 'event_type', v_job.event_type,
        'performed_by', 'personnel_notification_worker', 'requested_by', v_job.actor_id));
  end if;
  return true;
end;
$$;

-- No client-callable administrative or queue function can spoof an actor.
revoke all on function public.personnel_actor_has_permission(uuid, text) from public, anon, authenticated;
grant execute on function public.personnel_actor_has_permission(uuid, text) to authenticated, service_role;
revoke all on function public.personnel_session_is_usable() from public, anon, authenticated;
grant execute on function public.personnel_session_is_usable() to authenticated, service_role;
revoke all on function public.personnel_assert_admin(uuid, text[]) from public, anon, authenticated;
revoke all on function public.personnel_profile_json(uuid) from public, anon, authenticated;
revoke all on function public.personnel_audit(uuid, uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.personnel_queue_email(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.personnel_cancel_unsent_email(uuid) from public, anon, authenticated;
revoke all on function public.personnel_validate_stations(public.app_role, text[]) from public, anon, authenticated;
revoke all on function public.personnel_sync_legacy_request(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.guard_personnel_profile_access() from public, anon, authenticated;
revoke all on function public.guard_staff_request_phone() from public, anon, authenticated;
revoke all on function public.personnel_assert_activation_scope(uuid) from public, anon, authenticated;
revoke all on function public.admin_reserve_personnel_account(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_create_personnel_account(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_transition_personnel_account(uuid, uuid, text, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.admin_update_personnel_account(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.review_personnel_account_request(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_personnel_account_setup(uuid) from public, anon, authenticated;
revoke all on function public.admin_assert_account_deletable(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_personnel_notifications(integer, uuid) from public, anon, authenticated;
revoke all on function public.begin_personnel_notification_send(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_personnel_notification(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.personnel_profile_json(uuid) to service_role;
grant execute on function public.admin_reserve_personnel_account(uuid, uuid, jsonb) to service_role;
grant execute on function public.admin_create_personnel_account(uuid, uuid, jsonb) to service_role;
grant execute on function public.admin_transition_personnel_account(uuid, uuid, text, text, boolean, uuid) to service_role;
grant execute on function public.admin_update_personnel_account(uuid, uuid, jsonb, uuid) to service_role;
grant execute on function public.review_personnel_account_request(uuid, uuid, text, text) to service_role;
grant execute on function public.complete_personnel_account_setup(uuid) to service_role;
grant execute on function public.admin_assert_account_deletable(uuid, uuid) to service_role;
grant execute on function public.claim_personnel_notifications(integer, uuid) to service_role;
grant execute on function public.begin_personnel_notification_send(uuid, uuid) to service_role;
grant execute on function public.finish_personnel_notification(uuid, uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';

commit;

-- Forward-only repair. Retain clinical identities, immutable referral documents,
-- household census/health history and the already-applied migration versions.
begin;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.residents'::regclass
      and tgname = 'approved_barangay_assignment_guard' and tgenabled in ('O', 'A')
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.residents'::regclass
      and tgname = 'residents_sync_scope_trigger' and tgenabled in ('O', 'A')
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.referrals'::regclass
      and tgname = 'referrals_read_only' and tgenabled in ('O', 'A')
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.transfer_requests'::regclass
      and conname = 'transfer_requests_status_check' and convalidated
      and pg_get_constraintdef(oid) like '%resubmission_required%'
  ) or not exists (
    select 1 from pg_index
    where indexrelid = 'public.transfer_requests_one_open_per_user'::regclass
      and indisunique and indisvalid
  ) then
    raise exception using errcode = '55000',
      message = 'Apply the complete transfer, approved-geography and canonical-referral migration chain first.';
  end if;
end;
$$;

-- Child writers wait for a locked resident, then derive its committed current
-- scope. A concurrent insert must not retain the pre-transfer scope unnoticed.
create or replace function public.visits_sync_scope()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare r public.residents%rowtype;
begin
  select * into r from public.residents where id = new.resident_id for key share;
  if not found then raise exception 'visits: resident not found'; end if;
  new.municipality_id := r.municipality_id;
  new.barangay_id := r.barangay_id;
  return new;
end;
$$;

create or replace function public.sync_operational_scope()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare r public.residents%rowtype;
begin
  select * into r from public.residents where id = new.resident_id for key share;
  if not found then raise exception 'operational record: resident not found'; end if;
  new.municipality_id := r.municipality_id;
  new.barangay_id := r.barangay_id;
  return new;
end;
$$;

revoke all on function public.visits_sync_scope() from public, anon, authenticated;
revoke all on function public.sync_operational_scope() from public, anon, authenticated;
grant execute on function public.visits_sync_scope() to service_role;
grant execute on function public.sync_operational_scope() to service_role;

-- Restrict, never widen, the existing policies. Recording a visit is not a
-- perpetual authorization grant after the patient leaves that barangay.
drop policy if exists visits_current_resident_scope on public.visits;
create policy visits_current_resident_scope on public.visits as restrictive
for all to authenticated
using (
  exists (
    select 1 from public.residents r where r.id = visits.resident_id
      and (r.auth_user_id = auth.uid() or public.is_admin()
        or public.profile_covers_barangay(r.barangay_id))
  ) or exists (
    select 1 from public.health_referrals h
    where h.id = visits.referral_id and h.resident_id = visits.resident_id
      and public.canonical_referral_can_read(h.id)
  )
)
with check (
  exists (
    select 1 from public.residents r where r.id = visits.resident_id
      and (r.auth_user_id = auth.uid() or public.is_admin()
        or public.profile_covers_barangay(r.barangay_id))
  ) or exists (
    select 1 from public.health_referrals h
    where h.id = visits.referral_id and h.resident_id = visits.resident_id
      and public.canonical_referral_can_read(h.id)
  )
);

drop policy if exists visit_plans_current_resident_scope on public.visit_plans;
create policy visit_plans_current_resident_scope on public.visit_plans as restrictive
for all to authenticated
using (
  exists (
    select 1 from public.residents r where r.id = visit_plans.resident_id
      and (r.auth_user_id = auth.uid() or public.is_admin()
        or public.profile_covers_barangay(r.barangay_id))
  )
)
with check (
  exists (
    select 1 from public.residents r where r.id = visit_plans.resident_id
      and (r.auth_user_id = auth.uid() or public.is_admin()
        or public.profile_covers_barangay(r.barangay_id))
  )
);

create or replace function public.approve_transfer_request(p_request_id uuid, p_reviewer_id uuid)
returns public.transfer_requests
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  request_row public.transfer_requests%rowtype;
  resident_row public.residents%rowtype;
  reviewer public.profiles%rowtype;
  owner_profile public.profiles%rowtype;
  reviewer_account public.personnel_accounts%rowtype;
  source public.barangays%rowtype;
  destination public.barangays%rowtype;
  scope_tables constant text[] := array[
    'visits', 'follow_ups', 'tcl_entries', 'maternal_records',
    'maternal_visits', 'immunizations', 'health_referrals'
  ];
  table_name text;
  prior_scopes jsonb := '[]'::jsonb;
  table_scopes jsonb;
  prior_memberships jsonb;
  prior_plans jsonb;
begin
  if p_reviewer_id is null
    or (auth.uid() is not null and auth.uid() is distinct from p_reviewer_id) then
    raise exception using errcode = '42501', message = 'The transfer reviewer must match the authenticated actor.';
  end if;

  select * into request_row from public.transfer_requests where id = p_request_id for update;
  if not found or request_row.status not in ('pending', 'under_review') then return null; end if;
  if request_row.resident_id is null or request_row.from_barangay_id is null
    or request_row.to_barangay_id is null then return null; end if;

  select * into reviewer from public.profiles where id = p_reviewer_id for share;
  if not found or reviewer.status <> 'active'
    or reviewer.role not in ('admin', 'mho', 'phn', 'health_supervisor') then
    raise exception using errcode = '42501', message = 'An active authorized transfer reviewer is required.';
  end if;
  select * into reviewer_account from public.personnel_accounts where account_id = reviewer.id for share;
  if found and (reviewer_account.approval_status <> 'approved'
    or reviewer_account.setup_required or reviewer_account.suspended_at is not null) then
    raise exception using errcode = '42501', message = 'The transfer reviewer account is not usable.';
  end if;
  if not public.personnel_actor_has_permission(reviewer.id, 'residents.transfer.approve') then
    raise exception using errcode = '42501', message = 'The reviewer does not have transfer approval permission.';
  end if;

  select * into resident_row from public.residents where id = request_row.resident_id for update;
  if not found or resident_row.auth_user_id is distinct from request_row.auth_user_id
    or (request_row.target_resident_id is not null and request_row.target_resident_id <> resident_row.id) then
    raise exception using errcode = '23514', message = 'The transfer must belong to the same existing resident account.';
  end if;
  if resident_row.barangay_id is distinct from request_row.from_barangay_id then
    raise exception using errcode = '40001', message = 'The resident source barangay changed. Reload the transfer request.';
  end if;
  if request_row.from_barangay_id = request_row.to_barangay_id then
    raise exception using errcode = '23514', message = 'A transfer must have a different destination barangay.';
  end if;

  select * into owner_profile from public.profiles where id = resident_row.auth_user_id for update;
  if not found or owner_profile.role not in ('resident', 'resident-limited')
    or owner_profile.status not in ('active', 'pending_verification')
    or owner_profile.id = reviewer.id
    or exists (select 1 from public.residents r
      where r.auth_user_id = owner_profile.id and r.id <> resident_row.id) then
    raise exception using errcode = '23514', message = 'A single resident account is required; ambiguous historical links need review.';
  end if;

  select * into source from public.barangays where id = resident_row.barangay_id for share;
  if not found or resident_row.municipality_id is distinct from source.municipality_id then
    raise exception using errcode = '23514', message = 'The resident source municipality is inconsistent.';
  end if;
  select * into destination from public.barangays where id = request_row.to_barangay_id for share;
  if not found or destination.status <> 'Active'
    or not public.is_approved_barangay_name(destination.name)
    or destination.municipality_id is distinct from source.municipality_id then
    raise exception using errcode = '23514', message = 'Choose an approved active destination in the resident municipality.';
  end if;
  perform id from public.municipalities where id = destination.municipality_id and is_active for share;
  if not found then
    raise exception using errcode = '23514', message = 'The transfer municipality is not active.';
  end if;
  if (reviewer.role <> 'admin' and reviewer.municipality_id is distinct from destination.municipality_id)
    or (reviewer.role = 'health_supervisor' and reviewer.barangay_id is distinct from destination.id) then
    raise exception using errcode = '42501', message = 'Only an authorized receiving reviewer may approve this transfer.';
  end if;
  perform id from public.documents where transfer_request_id = request_row.id
    and document_type = 'transfer_proof_of_address' and verification_status = 'pending'
    and nullif(btrim(storage_path), '') is not null for share;
  if not found then return null; end if;

  -- Preserve exact pre-transfer geography, not reconstructed encounter origins.
  -- Clinical values, facilities, recorders, recipients and snapshots stay on
  -- their original rows; only the denormalized current access scope changes.
  foreach table_name in array scope_tables loop
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''table'', %L, ''id'', s.id,
         ''municipality_id'', s.municipality_id, ''barangay_id'', s.barangay_id)
         order by s.id), ''[]''::jsonb)
       from (select id::text, municipality_id, barangay_id from public.%I
         where resident_id = $1 and (municipality_id is distinct from $2
           or barangay_id is distinct from $3) order by id for update) s',
      table_name, table_name
    ) into table_scopes using resident_row.id, destination.municipality_id, destination.id;
    prior_scopes := prior_scopes || table_scopes;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb) into prior_memberships
  from (
    select m.id, m.household_id, m.resident_id from public.household_members m
    join public.households h on h.id = m.household_id
    where m.resident_id = resident_row.id and h.barangay_id = source.id
      and h.municipality_id = source.municipality_id order by m.id for update of m
  ) m;

  perform s.id from public.health_services s join public.visit_plans p on p.service_id = s.id
    where p.resident_id = resident_row.id for share of s;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb) into prior_plans
  from (
    select id, barangay_id, service_id, facility_type, planned_date, status
    from public.visit_plans where resident_id = resident_row.id order by id for update
  ) p;

  -- The approved assignment guard sorts BEFORE residents_sync_scope_trigger.
  -- Supply all canonical fields together; never disable or reorder that guard.
  update public.residents set barangay_id = destination.id, barangay = destination.name,
    municipality_id = destination.municipality_id where id = resident_row.id;
  update public.profiles set barangay_id = destination.id, municipality_id = destination.municipality_id
    where id = owner_profile.id and role in ('resident', 'resident-limited')
      and (barangay_id is distinct from destination.id or municipality_id is distinct from destination.municipality_id);

  foreach table_name in array scope_tables loop
    execute format('update public.%I set barangay_id = $1, municipality_id = $2
      where resident_id = $3 and (barangay_id is distinct from $1 or municipality_id is distinct from $2)', table_name)
      using destination.id, destination.municipality_id, resident_row.id;
  end loop;

  update public.household_members m set resident_id = null
    where m.resident_id = resident_row.id and exists (
      select 1 from public.households h where h.id = m.household_id
        and h.barangay_id = source.id and h.municipality_id = source.municipality_id
    );

  -- A municipality/RHU intent can follow the resident. Never substitute a
  -- different service/facility or rewrite an old BHC booking/attendance history.
  update public.visit_plans p set barangay_id = destination.id
    from public.health_services s
    where p.resident_id = resident_row.id and p.service_id = s.id and s.active
      and s.municipality_id = destination.municipality_id
      and ((s.barangay_id is null and p.facility_type = 'RHU')
        or (s.barangay_id = destination.id and p.facility_type = 'BHC'))
      and p.barangay_id is distinct from destination.id;

  update public.transfer_requests set status = 'approved', reviewed_by = reviewer.id,
    reviewed_at = now(), updated_at = now() where id = request_row.id returning * into request_row;

  insert into public.transfer_request_audit_logs(transfer_request_id, actor_id, action, metadata)
  values (request_row.id, reviewer.id, 'transfer_scope_repaired', jsonb_build_object(
    'resident_id', resident_row.id, 'from_barangay_id', source.id, 'from_barangay', resident_row.barangay,
    'from_municipality_id', source.municipality_id, 'to_barangay_id', destination.id,
    'to_barangay', destination.name, 'to_municipality_id', destination.municipality_id,
    'profile_scope_before', jsonb_build_object('id', owner_profile.id,
      'municipality_id', owner_profile.municipality_id, 'barangay_id', owner_profile.barangay_id),
    'record_scopes_before', prior_scopes, 'household_links_before', prior_memberships,
    'visit_plans_before', prior_plans
  ));

  -- Approval notifications remain with the existing API. Do not duplicate or
  -- retarget historical notifications, explicit referrals or health workers.
  return request_row;
end;
$$;

revoke all on function public.approve_transfer_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_transfer_request(uuid, uuid) to service_role;

commit;
notify pgrst, 'reload schema';

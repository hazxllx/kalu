-- Canonical, explicitly addressed referrals. The legacy documents and their FKs
-- are retained, but all workflow writes now go through the trusted API RPC.
begin;

alter table public.health_referrals
  add column if not exists recipient_personnel_id uuid references public.profiles(id) on delete restrict,
  add column if not exists recipient_facility_id uuid references public.facilities(id) on delete restrict,
  add column if not exists recipient_role text,
  add column if not exists recipient_station text,
  add column if not exists version bigint not null default 1,
  add column if not exists accepted_at timestamptz,
  add column if not exists in_progress_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists patient_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists visit_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists snapshot_synced_at timestamptz,
  add column if not exists referral_category text,
  add column if not exists scheduled_at_edited boolean not null default false;

alter table public.health_referrals drop constraint if exists health_referrals_status_check;
alter table public.health_referrals add constraint health_referrals_status_check
  check (status in ('Pending', 'Accepted', 'In Progress', 'Completed', 'Rejected', 'Cancelled'));
alter table public.health_referrals drop constraint if exists health_referrals_recipient_check;
alter table public.health_referrals add constraint health_referrals_recipient_check check (
  (recipient_personnel_id is null and recipient_facility_id is null and recipient_role is null and recipient_station is null)
  or (recipient_personnel_id is not null and recipient_facility_id is not null and recipient_role is not null
    and recipient_role in ('phn', 'health_supervisor', 'rhu_personnel')
    and (recipient_station is null or recipient_station in ('triage', 'consultation')))
);
create index if not exists health_referrals_recipient_idx
  on public.health_referrals(recipient_personnel_id, status, created_at desc);
create index if not exists health_referrals_treatment_visit_idx
  on public.health_referrals(treatment_visit_id) where treatment_visit_id is not null;

create table if not exists public.health_referral_legacy_map (
  legacy_referral_id text primary key references public.referrals(id) on delete restrict,
  health_referral_id uuid not null references public.health_referrals(id) on delete restrict,
  legacy_snapshot jsonb not null,
  source_visit_matches_resident boolean not null default false,
  mapped_at timestamptz not null default now()
);
alter table public.health_referral_legacy_map add column if not exists source_visit_matches_resident boolean not null default false;
create index if not exists health_referral_legacy_map_canonical_idx
  on public.health_referral_legacy_map(health_referral_id);

create table if not exists public.health_referral_history (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.health_referrals(id) on delete restrict,
  version bigint not null,
  action text not null,
  previous_status text,
  new_status text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null default '',
  actor_role text not null default '',
  explanation text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (referral_id, version)
);

-- Only this table's assignment guard is suspended inside the migration
-- transaction: importing unchanged, inactive historical geography is not a new
-- operational assignment. No legacy row, snapshot, identity or visit is edited.
drop trigger if exists approved_barangay_assignment_guard on public.health_referrals;
do $$
declare legacy public.referrals%rowtype; canonical_id uuid; source_id text;
begin
  for legacy in select l.* from public.referrals l
    where not exists (select 1 from public.health_referral_legacy_map m where m.legacy_referral_id = l.id)
    order by l.created_at, l.id
  loop
    source_id := null;
    select v.id into source_id from public.visits v where v.id = legacy.visit_id and v.resident_id = legacy.resident_id;
    canonical_id := null;
    -- treatment_visit_id is the SOURCE, not the receiving visits.referral_id.
    select h.id into canonical_id from public.health_referrals h
      where source_id is not null and h.treatment_visit_id = source_id and h.resident_id = legacy.resident_id
      order by h.created_at, h.id limit 1;
    if canonical_id is null then
      insert into public.health_referrals (
        resident_id, treatment_visit_id, referring_facility, destination_facility,
        destination_service, reason, impression, referral_date, status, referral_category,
        scheduled_at, chief_complaints, medical_history, physical_exam_findings,
        patient_snapshot, visit_snapshot, created_by, created_at, updated_at, completed_at
      ) values (
        legacy.resident_id, source_id, legacy.referring_facility, legacy.receiving_facility,
        legacy.outpatient_service, legacy.reason_for_referral, legacy.working_impression,
        (legacy.referral_date at time zone 'Asia/Manila')::date,
        case lower(legacy.status) when 'accepted' then 'Accepted' when 'in_progress' then 'In Progress'
          when 'in progress' then 'In Progress' when 'completed' then 'Completed' when 'rejected' then 'Rejected'
          when 'cancelled' then 'Cancelled' when 'canceled' then 'Cancelled' else 'Pending' end,
        legacy.referral_category,
        case when legacy.appointment_date is not null and legacy.appointment_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
          then (legacy.appointment_date + legacy.appointment_time::time) at time zone 'Asia/Manila' end,
        coalesce(legacy.visit_snapshot ->> 'chiefComplaint', legacy.visit_snapshot ->> 'chief_complaint', ''),
        coalesce(legacy.visit_snapshot ->> 'clinicalHistory', legacy.visit_snapshot ->> 'clinical_history', ''),
        coalesce(legacy.visit_snapshot ->> 'findings', ''),
        legacy.patient_snapshot, legacy.visit_snapshot,
        (select p.id from public.profiles p where p.id::text = legacy.created_by_id),
        legacy.created_at, legacy.updated_at,
        case when legacy.status = 'completed' then coalesce(
          (select v.completed_at from public.visits v where v.id = source_id), legacy.updated_at) end
      ) returning id into canonical_id;
    end if;
    insert into public.health_referral_legacy_map(legacy_referral_id, health_referral_id, legacy_snapshot, source_visit_matches_resident)
      values (legacy.id, canonical_id, to_jsonb(legacy), source_id is not null) on conflict (legacy_referral_id) do nothing;
  end loop;
end;
$$;
create trigger approved_barangay_assignment_guard before insert or update on public.health_referrals
  for each row execute function public.guard_approved_barangay_assignment();

insert into public.health_referral_history(referral_id, version, action, new_status, actor_name, actor_role, metadata, created_at)
select h.id, h.version, 'Imported', h.status, 'Historical record', 'system',
  jsonb_build_object('legacy_referral_ids', coalesce((select jsonb_agg(m.legacy_referral_id order by m.legacy_referral_id)
    from public.health_referral_legacy_map m where m.health_referral_id = h.id), '[]'::jsonb)), h.created_at
from public.health_referrals h on conflict (referral_id, version) do nothing;

create or replace function public.canonical_referral_personnel_active(p_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles p
    left join public.personnel_accounts a on a.account_id = p.id
    where p.id = p_id and p.status = 'active' and (a.account_id is null
      or (a.approval_status = 'approved' and not a.setup_required and a.suspended_at is null)));
$$;

-- Routing is an individual assignment, never a municipality-wide role inbox.
-- A community midwife uses the existing health_supervisor role at their BHS;
-- cross-barangay RHU work additionally needs a current station and facility.
create or replace function public.canonical_referral_route_valid(
  p_resident_id text, p_personnel_id uuid, p_facility_id uuid, p_role text, p_station text
)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.residents r
    join public.barangays rb on rb.id = r.barangay_id and rb.municipality_id = r.municipality_id
    join public.profiles p on p.id = p_personnel_id
    join public.facilities f on f.id = p_facility_id and f.municipality_id = r.municipality_id
    where r.id = p_resident_id and r.municipality_id is not null
      and rb.status = 'Active' and public.is_approved_barangay_name(rb.name)
      and public.canonical_referral_personnel_active(p.id)
      and p.role::text = p_role and p.municipality_id = r.municipality_id
      and (f.barangay_id is null or exists (select 1 from public.barangays fb
        where fb.id = f.barangay_id and fb.municipality_id = f.municipality_id
          and fb.status = 'Active' and public.is_approved_barangay_name(fb.name)))
      and (
        (p_role = 'phn' and p_station is null and f.type = 'rhu' and p.facility_id = f.id)
        or (p_role in ('rhu_personnel', 'health_supervisor') and f.type = 'rhu'
          and p.facility_id = f.id and p_station in ('triage', 'consultation')
          and p_station = any(p.rhu_stations)
          and (p_role <> 'health_supervisor' or exists (select 1 from public.barangays pb
            where pb.id = p.barangay_id and pb.municipality_id = p.municipality_id
              and pb.status = 'Active' and public.is_approved_barangay_name(pb.name))))
        or (p_role = 'health_supervisor' and p_station is null and f.type = 'barangay_health_station'
          and p.barangay_id = r.barangay_id and f.barangay_id = p.barangay_id
          and (p.facility_id is null or p.facility_id = f.id))
      )
  );
$$;

create or replace function public.canonical_referral_is_recipient(p_actor_id uuid, p_referral public.health_referrals)
returns boolean language sql stable security definer set search_path = public
as $$
  select p_actor_id = p_referral.recipient_personnel_id and public.canonical_referral_route_valid(
    p_referral.resident_id, p_actor_id, p_referral.recipient_facility_id, p_referral.recipient_role, p_referral.recipient_station);
$$;

-- This is the only helper exposed to user tokens. The actor is always auth.uid,
-- and current resident geography is read afresh rather than trusting old scope.
create or replace function public.canonical_referral_can_read(p_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.health_referrals h
    join public.residents r on r.id = h.resident_id
    join public.profiles p on p.id = auth.uid()
    where h.id = p_id and public.personnel_session_is_usable()
      and (p.role = 'admin' or not exists (select 1 from public.health_referral_legacy_map m
        where m.health_referral_id = h.id and not m.source_visit_matches_resident)) and (
      (p.role in ('resident', 'resident-limited') and r.auth_user_id = p.id)
      or (public.canonical_referral_personnel_active(p.id) and (
        p.role = 'admin'
        or (p.role in ('phn', 'mho') and p.municipality_id = r.municipality_id)
        or (p.role = 'health_supervisor' and p.municipality_id = r.municipality_id and p.barangay_id = r.barangay_id)
        or public.canonical_referral_is_recipient(p.id, h)
      ))
    ));
$$;

drop policy if exists health_referrals_select on public.health_referrals;
create policy health_referrals_select on public.health_referrals for select to authenticated
  using (public.canonical_referral_can_read(id));
alter table public.health_referral_history enable row level security;
alter table public.health_referral_legacy_map enable row level security;
drop policy if exists health_referral_history_select on public.health_referral_history;
create policy health_referral_history_select on public.health_referral_history for select to authenticated
  using (public.canonical_referral_can_read(referral_id));
drop policy if exists health_referral_legacy_map_select on public.health_referral_legacy_map;
create policy health_referral_legacy_map_select on public.health_referral_legacy_map for select to authenticated
  using (public.canonical_referral_can_read(health_referral_id));
-- Reading the historical table directly must not reopen the old municipality
-- RHU/BHW boundary. Its immutable documents inherit canonical visibility too.
drop policy if exists referrals_select on public.referrals;
drop policy if exists referrals_select_staff on public.referrals;
create policy referrals_select on public.referrals for select to authenticated using (
  exists (select 1 from public.health_referral_legacy_map m where m.legacy_referral_id = referrals.id
    and public.canonical_referral_can_read(m.health_referral_id))
);

-- Keep 20261106000000's security hardening. No user token (including an admin
-- token) can bypass the workflow using a direct insert/update/delete instead.
revoke insert, update, delete, truncate on public.health_referrals from public, anon, authenticated, service_role;
revoke all on public.health_referral_history, public.health_referral_legacy_map from public, anon, authenticated, service_role;
grant select on public.health_referrals, public.health_referral_history, public.health_referral_legacy_map to authenticated, service_role;

-- Add only missing entries to an already configured matrix. Explicit denials
-- are retained, and an empty matrix remains in its existing bootstrap mode.
insert into public.role_permissions(role, permission_id, granted)
select 'rhu_personnel', permission_id, true
from unnest(array['referrals.approve','referrals.reject','referrals.status.update','referrals.history.view']) permission_id
where exists (select 1 from public.role_permissions where role = 'rhu_personnel')
on conflict (role, permission_id) do nothing;
revoke insert, update, delete, truncate on public.referrals from public, anon, authenticated, service_role;
create or replace function public.canonical_referral_legacy_read_only()
returns trigger language plpgsql set search_path = public
as $$ begin raise exception using errcode = '55000', message = 'Historical referrals are read-only. Use the canonical referral workflow.'; end; $$;
drop trigger if exists referrals_read_only on public.referrals;
create trigger referrals_read_only before insert or update or delete on public.referrals
  for each row execute function public.canonical_referral_legacy_read_only();

create or replace function public.canonical_referral_has_permission(p_actor_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = p_actor_id
    and public.canonical_referral_personnel_active(p.id) and (
      not exists (select 1 from public.role_permissions rp where rp.role = p.role)
      or exists (select 1 from public.role_permissions rp
        where rp.role = p.role and rp.permission_id = p_permission and rp.granted)));
$$;

-- Status/history/audit/private notifications are committed together. The audit
-- metadata has no clinical content; explanations stay in the scoped history.
create or replace function public.canonical_referral_event(
  p_referral public.health_referrals, p_actor_id uuid, p_action text, p_previous jsonb,
  p_explanation text default '', p_notify boolean default true
)
returns void language plpgsql security definer set search_path = public
as $$
declare targets uuid[]; target uuid;
begin
  insert into public.health_referral_history(referral_id, version, action, previous_status, new_status,
    actor_id, actor_name, actor_role, explanation, metadata)
  values (p_referral.id, p_referral.version, p_action, p_previous ->> 'status', p_referral.status, p_actor_id,
    coalesce((select full_name from public.profiles where id = p_actor_id), 'Linked encounter'),
    coalesce((select role::text from public.profiles where id = p_actor_id), 'system'), coalesce(p_explanation, ''),
    jsonb_build_object('previous_recipient', p_previous -> 'recipient_personnel_id',
      'recipient_personnel_id', p_referral.recipient_personnel_id, 'recipient_role', p_referral.recipient_role,
      'recipient_facility_id', p_referral.recipient_facility_id, 'recipient_station', p_referral.recipient_station));
  insert into public.health_audit_logs(actor_id, action, entity_type, entity_id, municipality_id, barangay_id, metadata)
  values (p_actor_id, 'REFERRAL_' || upper(p_action), 'health_referrals', p_referral.id::text,
    p_referral.municipality_id, p_referral.barangay_id,
    jsonb_build_object('from', p_previous ->> 'status', 'to', p_referral.status, 'version', p_referral.version));
  if not p_notify then return; end if;
  targets := array[p_referral.recipient_personnel_id, p_referral.created_by,
    (select auth_user_id from public.residents where id = p_referral.resident_id)];
  if p_action = 'Reassigned' then targets := array_append(targets, (p_previous ->> 'recipient_personnel_id')::uuid); end if;
  for target in select distinct value from unnest(targets) value where value is not null and value is distinct from p_actor_id
  loop
    insert into public.notifications(recipient_id, category, title, message, related_type, related_id)
    values (target, 'information', case when p_action in ('Created', 'Reassigned') then 'Referral assignment'
      else 'Referral status updated' end,
      case when p_action in ('Created', 'Reassigned') then 'A referral assignment has been recorded. Open Referrals to review it.'
        else 'A referral status has changed. Open Referrals to review the update.' end,
      'health_referrals', p_referral.id::text);
  end loop;
end;
$$;

create or replace function public.canonical_referral_write(
  p_actor_id uuid, p_id uuid, p_action text, p_expected_version bigint, p_record jsonb
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare actor public.profiles%rowtype; current_row public.health_referrals%rowtype;
  next_row public.health_referrals%rowtype; resident public.residents%rowtype; source public.visits%rowtype;
  routing_changed boolean; explanation text; event_action text; requested_status text;
  permission_id text; allowed_keys text[];
begin
  select * into actor from public.profiles where id = p_actor_id for share;
  if not found or not public.canonical_referral_personnel_active(actor.id) then
    raise exception using errcode = '42501', message = 'An active authorized referral account is required.';
  end if;
  if p_action is null or p_action not in ('create', 'create_phn', 'update', 'status', 'sync')
    or p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception using errcode = '22023', message = 'Invalid referral operation.';
  end if;
  allowed_keys := array['resident_id', 'referring_facility', 'destination_facility', 'destination_service', 'reason', 'priority',
    'referral_date', 'scheduled_at', 'chief_complaints', 'medical_history', 'physical_exam_findings', 'impression', 'notes',
    'laboratory_test_required', 'laboratory_test', 'additional_instructions', 'treatment_visit_id', 'referral_category',
    'recipient_personnel_id', 'recipient_role', 'recipient_facility_id', 'recipient_station'];
  if p_action = 'status' then allowed_keys := array['status', 'resolution_notes']; end if;
  if p_action = 'sync' then allowed_keys := '{}'::text[]; end if;
  if exists (select 1 from jsonb_object_keys(p_record) k where not (k = any(allowed_keys))) then
    raise exception using errcode = '22023', message = 'Referral identity, snapshots, status and timestamps cannot be overwritten.';
  end if;
  if p_action in ('create', 'create_phn') then
    if actor.role not in ('health_supervisor', 'phn') or (p_action = 'create_phn' and actor.role <> 'phn') then
      raise exception using errcode = '42501', message = 'Your role cannot create referrals.';
    end if;
    select * into resident from public.residents where id = p_record ->> 'resident_id' for share;
    next_row := jsonb_populate_record(null::public.health_referrals, p_record);
    next_row.status := 'Pending'; next_row.version := 1; next_row.created_by := actor.id;
    permission_id := 'referrals.create';
  else
    select * into current_row from public.health_referrals where id = p_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'Referral not found.'; end if;
    if p_expected_version is null or current_row.version <> p_expected_version then
      raise exception using errcode = '40001', message = 'This referral changed. Refresh before trying again.';
    end if;
    if exists (select 1 from public.health_referral_legacy_map m
      where m.health_referral_id = current_row.id and not m.source_visit_matches_resident) then
      raise exception using errcode = '42501', message = 'This historical document has inconsistent resident/source identity and requires administrative review.';
    end if;
    if p_record ? 'resident_id' then
      raise exception using errcode = '22023', message = 'A referral cannot be reassigned to a different resident.';
    end if;
    select * into resident from public.residents where id = current_row.resident_id for share;
    next_row := jsonb_populate_record(current_row, p_record);
    permission_id := case p_action when 'update' then 'referrals.assign' when 'sync' then 'referrals.status.update'
      else case p_record ->> 'status' when 'Accepted' then 'referrals.approve'
        when 'Rejected' then 'referrals.reject' else 'referrals.status.update' end end;
  end if;
  if resident.id is null or resident.municipality_id is null or actor.municipality_id is null or actor.municipality_id <> resident.municipality_id then
    raise exception using errcode = 'P0002', message = 'Resident record not found.';
  end if;
  if not public.canonical_referral_has_permission(actor.id, permission_id) then
    raise exception using errcode = '42501', message = 'Your role does not have the required referral permission.';
  end if;
  if p_action <> 'status' or next_row.status = 'Cancelled' then
    if actor.role not in ('health_supervisor', 'phn')
      or (actor.role = 'health_supervisor' and actor.barangay_id is distinct from resident.barangay_id)
      or (p_action not in ('create', 'create_phn') and current_row.created_by is distinct from actor.id) then
      raise exception using errcode = '42501', message = 'Only the in-scope sender may edit or cancel this referral.';
    end if;
  elsif not coalesce(public.canonical_referral_is_recipient(actor.id, current_row), false) then
    raise exception using errcode = '42501', message = 'Only the currently assigned recipient may act on this referral.';
  end if;
  if p_action = 'status' then
    perform id from public.facilities where id = current_row.recipient_facility_id for share;
    requested_status := p_record ->> 'status';
    if requested_status not in ('Accepted', 'Rejected', 'In Progress', 'Completed', 'Cancelled') or requested_status is null then
      raise exception using errcode = '22023', message = 'Invalid referral status.';
    end if;
    if requested_status = current_row.status then return to_jsonb(current_row); end if;
    if not (
      (current_row.status = 'Pending' and requested_status in ('Accepted', 'Rejected', 'Cancelled'))
      or (current_row.status = 'Accepted' and requested_status in ('In Progress', 'Cancelled'))
      or (current_row.status = 'In Progress' and requested_status in ('Completed', 'Cancelled'))
    ) then raise exception using errcode = '23514', message = 'This referral status transition is not allowed.'; end if;
    explanation := btrim(coalesce(p_record ->> 'resolution_notes', ''));
    if requested_status in ('Rejected', 'Cancelled') and explanation = '' then
      raise exception using errcode = '22023', message = 'A reason is required for rejection or cancellation.';
    end if;
    next_row.resolution_notes := explanation;
    if requested_status = 'Accepted' then next_row.accepted_at := now(); end if;
    if requested_status = 'In Progress' then next_row.in_progress_at := now(); end if;
    if requested_status = 'Completed' then next_row.completed_at := now(); end if;
    if requested_status = 'Rejected' then next_row.rejected_at := now(); end if;
    if requested_status = 'Cancelled' then next_row.cancelled_at := now(); end if;
    event_action := 'Status';
  else
    if p_action in ('update', 'sync') and current_row.status in ('Completed', 'Rejected', 'Cancelled') then
      raise exception using errcode = '23514', message = 'Closed referrals and their snapshots are immutable.';
    end if;
    if p_action = 'update' and next_row.treatment_visit_id is distinct from current_row.treatment_visit_id then
      raise exception using errcode = '22023', message = 'The originating treatment visit cannot be changed.';
    end if;
    routing_changed := p_action = 'update' and (
      next_row.recipient_personnel_id is distinct from current_row.recipient_personnel_id
      or next_row.recipient_facility_id is distinct from current_row.recipient_facility_id
      or next_row.recipient_role is distinct from current_row.recipient_role
      or next_row.recipient_station is distinct from current_row.recipient_station);
    if p_action in ('update', 'sync') and current_row.status <> 'Pending' then
      if p_action = 'sync' or not routing_changed or (
        (to_jsonb(next_row) - array['recipient_personnel_id','recipient_facility_id','recipient_role','recipient_station','destination_facility'])
        is distinct from
        (to_jsonb(current_row) - array['recipient_personnel_id','recipient_facility_id','recipient_role','recipient_station','destination_facility'])
      ) then raise exception using errcode = '23514', message = 'After acceptance only recipient reassignment is allowed.'; end if;
    end if;
    if routing_changed then
      if exists (select 1 from public.visits v where v.referral_id = current_row.id and v.status = 'draft') then
        raise exception using errcode = '23514', message = 'Finish the receiving screening draft before reassigning its recipient.';
      end if;
      if next_row.recipient_facility_id is distinct from current_row.recipient_facility_id and exists (
        select 1 from public.visits v where v.referral_id = current_row.id
      ) then raise exception using errcode = '23514', message = 'A screened referral cannot move to a different facility.'; end if;
      next_row.status := 'Pending'; next_row.accepted_at := null; next_row.in_progress_at := null;
      next_row.resolution_notes := ''; event_action := 'Reassigned';
    else event_action := case p_action when 'update' then 'Updated' when 'sync' then 'Snapshots' else 'Created' end; end if;
    perform id from public.profiles where id = next_row.recipient_personnel_id for share;
    perform id from public.facilities where id = next_row.recipient_facility_id for share;
    if next_row.recipient_personnel_id = actor.id then
      raise exception using errcode = '22023', message = 'Select another authorized recipient.';
    end if;
    if not public.canonical_referral_route_valid(resident.id, next_row.recipient_personnel_id,
      next_row.recipient_facility_id, next_row.recipient_role, next_row.recipient_station) then
      raise exception using errcode = '22023', message = 'Choose a current authorized recipient, role, station and facility in this municipality.';
    end if;
    next_row.destination_facility := (select name from public.facilities where id = next_row.recipient_facility_id);
    if btrim(coalesce(next_row.reason, '')) = '' then
      raise exception using errcode = '22023', message = 'Referral reason is required.';
    end if;
    if coalesce(next_row.laboratory_test_required, false) and btrim(coalesce(next_row.laboratory_test, '')) = '' then
      raise exception using errcode = '22023', message = 'Laboratory test details are required.';
    end if;
    if next_row.treatment_visit_id is not null then
      select * into source from public.visits where id = next_row.treatment_visit_id for update;
      if not found or source.resident_id <> resident.id then
        raise exception using errcode = 'P0002', message = 'Source treatment visit not found for this resident.';
      end if;
      if p_action in ('create', 'create_phn') and exists (
        select 1 from public.health_referrals h where h.treatment_visit_id = source.id
      ) then raise exception using errcode = '23505', message = 'A referral already exists for this treatment visit.'; end if;
    end if;
    if p_action = 'create_phn' and (source.id is null or source.status not in ('received', 'in_review', 'referred')) then
      raise exception using errcode = '23514', message = 'Receive and review the submission before generating a referral.';
    end if;
    if p_action in ('create', 'create_phn', 'sync') then
      next_row.patient_snapshot := to_jsonb(resident);
      next_row.visit_snapshot := coalesce(to_jsonb(source), '{}'::jsonb);
      if p_action = 'sync' then next_row.snapshot_synced_at := now(); end if;
    end if;
  end if;
  if p_action in ('create', 'create_phn') then
    insert into public.health_referrals(resident_id, created_by, referring_facility, reason, destination_facility, destination_service,
      priority, referral_date, scheduled_at, chief_complaints, medical_history, physical_exam_findings, impression, notes,
      laboratory_test_required, laboratory_test, additional_instructions, treatment_visit_id,
      recipient_personnel_id, recipient_facility_id, recipient_role, recipient_station, patient_snapshot, visit_snapshot, referral_category)
    values (resident.id, actor.id, coalesce(next_row.referring_facility, ''), next_row.reason, next_row.destination_facility,
      coalesce(next_row.destination_service, ''), coalesce(next_row.priority, 'Medium'), coalesce(next_row.referral_date, current_date),
      next_row.scheduled_at, coalesce(next_row.chief_complaints, ''), coalesce(next_row.medical_history, ''),
      coalesce(next_row.physical_exam_findings, ''), coalesce(next_row.impression, ''), coalesce(next_row.notes, ''),
      coalesce(next_row.laboratory_test_required, false), coalesce(next_row.laboratory_test, ''), coalesce(next_row.additional_instructions, ''),
      next_row.treatment_visit_id, next_row.recipient_personnel_id, next_row.recipient_facility_id, next_row.recipient_role,
      next_row.recipient_station, next_row.patient_snapshot, next_row.visit_snapshot, coalesce(next_row.referral_category, '')) returning * into next_row;
    if p_action = 'create_phn' then
      update public.visits set status = 'referred', received_at = coalesce(received_at, now()),
        reviewed_at = coalesce(reviewed_at, now()), referred_at = coalesce(referred_at, now()) where id = source.id;
    end if;
  else
    update public.health_referrals set referring_facility = next_row.referring_facility, reason = next_row.reason,
      destination_facility = next_row.destination_facility, destination_service = next_row.destination_service, priority = next_row.priority,
      referral_date = next_row.referral_date, scheduled_at = next_row.scheduled_at, chief_complaints = next_row.chief_complaints,
      medical_history = next_row.medical_history, physical_exam_findings = next_row.physical_exam_findings, impression = next_row.impression,
      notes = next_row.notes, resolution_notes = next_row.resolution_notes, laboratory_test_required = next_row.laboratory_test_required,
      laboratory_test = next_row.laboratory_test, additional_instructions = next_row.additional_instructions,
      recipient_personnel_id = next_row.recipient_personnel_id, recipient_facility_id = next_row.recipient_facility_id,
      recipient_role = next_row.recipient_role, recipient_station = next_row.recipient_station,
      patient_snapshot = next_row.patient_snapshot, visit_snapshot = next_row.visit_snapshot, snapshot_synced_at = next_row.snapshot_synced_at,
      referral_category = next_row.referral_category, scheduled_at_edited = current_row.scheduled_at_edited or (p_record ? 'scheduled_at'),
      status = next_row.status, accepted_at = next_row.accepted_at, in_progress_at = next_row.in_progress_at,
      rejected_at = next_row.rejected_at, cancelled_at = next_row.cancelled_at, completed_at = next_row.completed_at,
      version = current_row.version + 1 where id = current_row.id returning * into next_row;
  end if;
  perform public.canonical_referral_event(next_row, actor.id, event_action, to_jsonb(current_row), explanation,
    event_action in ('Created', 'Reassigned', 'Status'));
  return to_jsonb(next_row);
end;
$$;

-- Completing an originating treatment is NOT completing a referral. Only a
-- completed receiving encounter with the same resident and destination can do
-- this, and it cannot revive a rejected/cancelled or unassigned referral.
create or replace function public.canonical_referral_complete_from_visit(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare referral public.health_referrals%rowtype; previous jsonb;
begin
  select * into referral from public.health_referrals where id = p_id for update;
  if not found then return null; end if;
  if referral.status not in ('Accepted', 'In Progress')
    or not public.canonical_referral_route_valid(referral.resident_id, referral.recipient_personnel_id,
      referral.recipient_facility_id, referral.recipient_role, referral.recipient_station)
    or not exists (select 1 from public.visits v where v.referral_id = referral.id and v.status = 'completed'
      and v.resident_id = referral.resident_id and v.facility_id = referral.recipient_facility_id) then
    return to_jsonb(referral);
  end if;
  if referral.status = 'Accepted' then
    previous := to_jsonb(referral);
    update public.health_referrals set status = 'In Progress', in_progress_at = coalesce(in_progress_at, now()), version = version + 1
      where id = p_id returning * into referral;
    perform public.canonical_referral_event(referral, null, 'Encounter', previous);
  end if;
  previous := to_jsonb(referral);
  update public.health_referrals set status = 'Completed', completed_at = coalesce(completed_at, now()), version = version + 1
    where id = p_id returning * into referral;
  perform public.canonical_referral_event(referral, null, 'Encounter', previous);
  return to_jsonb(referral);
end;
$$;

create or replace function public.canonical_referral_guard_encounter()
returns trigger language plpgsql security definer set search_path = public
as $$
declare referral public.health_referrals%rowtype; actor_id uuid;
begin
  if tg_op = 'UPDATE' and old.referral_id is not null and new.referral_id is distinct from old.referral_id then
    raise exception using errcode = '23514', message = 'A receiving encounter referral association is immutable.';
  end if;
  if tg_op = 'UPDATE' and new.resident_id is distinct from old.resident_id and exists (
    select 1 from public.health_referrals h where h.treatment_visit_id = new.id and h.resident_id <> new.resident_id
  ) then raise exception using errcode = '23514', message = 'A referral source visit cannot be moved to another resident.'; end if;
  if new.referral_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.referral_id is not distinct from old.referral_id
    and new.resident_id is not distinct from old.resident_id and new.facility_id is not distinct from old.facility_id then return new; end if;
  select * into referral from public.health_referrals where id = new.referral_id for share;
  if new.recorded_by_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then actor_id := new.recorded_by_id::uuid; end if;
  if referral.id is null or referral.resident_id <> new.resident_id
    or referral.recipient_facility_id is distinct from new.facility_id or referral.status not in ('Accepted', 'In Progress')
    or not coalesce(public.canonical_referral_is_recipient(actor_id, referral), false)
    or (auth.role() = 'authenticated' and auth.uid() is distinct from actor_id) then
    raise exception using errcode = '42501', message = 'Only the assigned recipient can start an accepted referral encounter at its current facility.';
  end if;
  return new;
end;
$$;
drop trigger if exists visits_canonical_referral_guard on public.visits;
create trigger visits_canonical_referral_guard before insert or update of referral_id, resident_id, facility_id on public.visits
  for each row execute function public.canonical_referral_guard_encounter();
create or replace function public.canonical_referral_encounter_completed()
returns trigger language plpgsql security definer set search_path = public
as $$
declare referral public.health_referrals%rowtype; previous jsonb;
begin
  if new.referral_id is null then return new; end if;
  if new.status = 'completed' then
    perform public.canonical_referral_complete_from_visit(new.referral_id);
  else
    select * into referral from public.health_referrals where id = new.referral_id for update;
    if referral.status = 'Accepted' and referral.resident_id = new.resident_id
      and referral.recipient_facility_id = new.facility_id and referral.recipient_personnel_id::text = new.recorded_by_id
      and public.canonical_referral_is_recipient(referral.recipient_personnel_id, referral) then
      previous := to_jsonb(referral);
      update public.health_referrals set status = 'In Progress', in_progress_at = coalesce(in_progress_at, now()), version = version + 1
        where id = referral.id returning * into referral;
      perform public.canonical_referral_event(referral, null, 'Encounter', previous);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists visits_canonical_referral_completed on public.visits;
create trigger visits_canonical_referral_completed after insert or update of status on public.visits
  for each row execute function public.canonical_referral_encounter_completed();

-- No public/anonymous/user RPC writes, even with a forged actor UUID.
do $$
declare fn record;
begin
  for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'canonical_referral_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
    execute format('grant execute on function %s to service_role', fn.signature);
  end loop;
end;
$$;
grant execute on function public.canonical_referral_can_read(uuid) to authenticated;

commit;

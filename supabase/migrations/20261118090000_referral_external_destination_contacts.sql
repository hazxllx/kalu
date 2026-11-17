-- Store optional outside receiving facility and contact details on the canonical referral.
begin;

alter table public.health_referrals
  add column if not exists external_receiving_facility text not null default '',
  add column if not exists external_receiving_address text not null default '',
  add column if not exists external_receiving_role text not null default '',
  add column if not exists external_recipient_name text not null default '',
  add column if not exists external_recipient_position text not null default '',
  add column if not exists referral_vitals jsonb not null default '{}'::jsonb;

comment on column public.health_referrals.external_receiving_facility is 'Outside destination details. When recipient assignment fields are null, the sender tracks the referral status.';
comment on column public.health_referrals.external_recipient_name is 'Outside recipient contact; no KALUSAGAP profile or account is created.';
comment on column public.health_referrals.referral_vitals is 'Optional vital signs recorded with the referring assessment; kept separate from RHU encounter vitals.';

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
    'recipient_personnel_id', 'recipient_role', 'recipient_facility_id', 'recipient_station',
    'external_receiving_facility', 'external_receiving_address', 'external_receiving_role',
    'external_recipient_name', 'external_recipient_position', 'referral_vitals'];
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
  elsif not coalesce(public.canonical_referral_is_recipient(actor.id, current_row)
    or (current_row.recipient_personnel_id is null and current_row.created_by = actor.id
      and btrim(coalesce(current_row.external_receiving_facility, '')) <> ''), false) then
    raise exception using errcode = '42501', message = 'Only the assigned recipient, or the sender of an outside referral, may act on this referral.';
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
    if next_row.recipient_personnel_id is null then
      if next_row.recipient_facility_id is not null or next_row.recipient_role is not null or next_row.recipient_station is not null
        or btrim(coalesce(next_row.external_receiving_facility, '')) = ''
        or btrim(coalesce(next_row.external_receiving_role, '')) = ''
        or btrim(coalesce(next_row.external_recipient_name, '')) = ''
        or btrim(coalesce(next_row.external_recipient_position, '')) = '' then
        raise exception using errcode = '22023', message = 'Complete the outside facility and recipient details when no in-app assignee is selected.';
      end if;
      next_row.destination_facility := next_row.external_receiving_facility;
    else
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
    end if;
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
      priority, referral_date, scheduled_at, chief_complaints, medical_history, physical_exam_findings, impression, referral_vitals, notes,
      laboratory_test_required, laboratory_test, additional_instructions, treatment_visit_id,
      recipient_personnel_id, recipient_facility_id, recipient_role, recipient_station, patient_snapshot, visit_snapshot, referral_category,
      external_receiving_facility, external_receiving_address, external_receiving_role, external_recipient_name, external_recipient_position)
    values (resident.id, actor.id, coalesce(next_row.referring_facility, ''), next_row.reason, next_row.destination_facility,
      coalesce(next_row.destination_service, ''), coalesce(next_row.priority, 'Medium'), coalesce(next_row.referral_date, current_date),
      next_row.scheduled_at, coalesce(next_row.chief_complaints, ''), coalesce(next_row.medical_history, ''),
      coalesce(next_row.physical_exam_findings, ''), coalesce(next_row.impression, ''), coalesce(next_row.referral_vitals, '{}'::jsonb), coalesce(next_row.notes, ''),
      coalesce(next_row.laboratory_test_required, false), coalesce(next_row.laboratory_test, ''), coalesce(next_row.additional_instructions, ''),
      next_row.treatment_visit_id, next_row.recipient_personnel_id, next_row.recipient_facility_id, next_row.recipient_role,
      next_row.recipient_station, next_row.patient_snapshot, next_row.visit_snapshot, coalesce(next_row.referral_category, ''),
      coalesce(next_row.external_receiving_facility, ''), coalesce(next_row.external_receiving_address, ''),
      coalesce(next_row.external_receiving_role, ''), coalesce(next_row.external_recipient_name, ''),
      coalesce(next_row.external_recipient_position, '')) returning * into next_row;
    if p_action = 'create_phn' then
      update public.visits set status = 'referred', received_at = coalesce(received_at, now()),
        reviewed_at = coalesce(reviewed_at, now()), referred_at = coalesce(referred_at, now()) where id = source.id;
    end if;
  else
    update public.health_referrals set referring_facility = next_row.referring_facility, reason = next_row.reason,
      destination_facility = next_row.destination_facility, destination_service = next_row.destination_service, priority = next_row.priority,
      referral_date = next_row.referral_date, scheduled_at = next_row.scheduled_at, chief_complaints = next_row.chief_complaints,
      medical_history = next_row.medical_history, physical_exam_findings = next_row.physical_exam_findings, impression = next_row.impression,
      referral_vitals = coalesce(next_row.referral_vitals, '{}'::jsonb),
      notes = next_row.notes, resolution_notes = next_row.resolution_notes, laboratory_test_required = next_row.laboratory_test_required,
      laboratory_test = next_row.laboratory_test, additional_instructions = next_row.additional_instructions,
      recipient_personnel_id = next_row.recipient_personnel_id, recipient_facility_id = next_row.recipient_facility_id,
      recipient_role = next_row.recipient_role, recipient_station = next_row.recipient_station,
      patient_snapshot = next_row.patient_snapshot, visit_snapshot = next_row.visit_snapshot, snapshot_synced_at = next_row.snapshot_synced_at,
      referral_category = next_row.referral_category,
      external_receiving_facility = next_row.external_receiving_facility,
      external_receiving_address = next_row.external_receiving_address,
      external_receiving_role = next_row.external_receiving_role,
      external_recipient_name = next_row.external_recipient_name,
      external_recipient_position = next_row.external_recipient_position, scheduled_at_edited = current_row.scheduled_at_edited or (p_record ? 'scheduled_at'),
      status = next_row.status, accepted_at = next_row.accepted_at, in_progress_at = next_row.in_progress_at,
      rejected_at = next_row.rejected_at, cancelled_at = next_row.cancelled_at, completed_at = next_row.completed_at,
      version = current_row.version + 1 where id = current_row.id returning * into next_row;
  end if;
  perform public.canonical_referral_event(next_row, actor.id, event_action, to_jsonb(current_row), explanation,
    event_action in ('Created', 'Reassigned', 'Status'));
  return to_jsonb(next_row);
end;
$$;

commit;

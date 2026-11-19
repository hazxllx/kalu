-- Keep appointment response/request state separate from clinical progress.
begin;

alter table public.health_referrals
  add column if not exists schedule_response_status text not null default 'Awaiting Response'
    check (schedule_response_status in ('Awaiting Response','Attendance Confirmed','Reschedule Requested','Reschedule Approved','Reschedule Rejected','Cancellation Requested','Cancellation Approved','Cancellation Rejected'));

alter table public.follow_ups
  add column if not exists schedule_response_status text not null default 'Awaiting Response'
    check (schedule_response_status in ('Awaiting Response','Attendance Confirmed','Reschedule Requested','Reschedule Approved','Reschedule Rejected','Cancellation Requested','Cancellation Approved','Cancellation Rejected')),
  add column if not exists facility_id uuid references public.facilities(id) on delete set null;
alter table public.follow_ups
  add column if not exists linked_service_type text not null default '',
  add column if not exists linked_service_id text not null default '';

alter table public.health_service_attendance
  add column if not exists follow_up_id uuid references public.follow_ups(id) on delete set null;
create unique index if not exists health_service_attendance_follow_up_unique
  on public.health_service_attendance(follow_up_id) where follow_up_id is not null;

-- Derive legacy follow-up facility assignment from its creator's registered
-- facility, when available. Do not infer external/RHU eligibility from labels.
update public.follow_ups f set facility_id = p.facility_id
from public.profiles p where f.facility_id is null and f.created_by = p.id and p.facility_id is not null;

create table public.health_schedule_requests (
  id uuid primary key default gen_random_uuid(),
  resident_id text not null references public.residents(id) on delete restrict,
  referral_id uuid references public.health_referrals(id) on delete restrict,
  follow_up_id uuid references public.follow_ups(id) on delete restrict,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  request_type text not null check (request_type in ('attendance','reschedule','cancellation')),
  status text not null default 'Pending Approval' check (status in ('Pending Approval','Approved','Rejected')),
  original_scheduled_at timestamptz,
  proposed_scheduled_at timestamptz,
  reason text not null default '',
  requested_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text not null default '',
  created_at timestamptz not null default now(),
  constraint health_schedule_requests_one_target check ((referral_id is null) <> (follow_up_id is null)),
  constraint health_schedule_requests_reason check (request_type = 'attendance' or length(btrim(reason)) > 0),
  constraint health_schedule_requests_reschedule_date check (request_type <> 'reschedule' or proposed_scheduled_at is not null)
);

create index health_schedule_requests_pending_idx on public.health_schedule_requests(facility_id, status, created_at desc);
create index health_schedule_requests_resident_idx on public.health_schedule_requests(resident_id, created_at desc);
create unique index health_schedule_requests_one_open_referral_idx on public.health_schedule_requests(referral_id)
  where referral_id is not null and status='Pending Approval';
create unique index health_schedule_requests_one_open_followup_idx on public.health_schedule_requests(follow_up_id)
  where follow_up_id is not null and status='Pending Approval';
alter table public.health_schedule_requests enable row level security;
revoke all on public.health_schedule_requests from anon, authenticated;
grant select, insert, update on public.health_schedule_requests to service_role;

create or replace function public.follow_up_registered_facility()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.facility_id is null and new.created_by is not null then
    select facility_id into new.facility_id from public.profiles where id=new.created_by;
  end if;
  if new.facility_id is null then
    select id into new.facility_id from public.facilities
      where type='barangay_health_station' and barangay_id=new.barangay_id order by created_at limit 1;
  end if;
  return new;
end; $$;
create trigger follow_ups_registered_facility before insert on public.follow_ups
  for each row execute function public.follow_up_registered_facility();

create or replace function public.complete_follow_up_from_service_attendance(
  p_attendance_id uuid, p_follow_up_id uuid, p_actor_id uuid
) returns public.follow_ups
language plpgsql security definer set search_path=public as $$
declare att public.health_service_attendance%rowtype; target public.follow_ups%rowtype;
begin
  select * into att from public.health_service_attendance where id=p_attendance_id for update;
  select * into target from public.follow_ups where id=p_follow_up_id for update;
  if not found or target.resident_id is distinct from att.resident_id then
    raise exception using errcode='42501', message='The service and follow-up must belong to the same resident.';
  end if;
  if att.attendance_status <> 'attended' or length(btrim(coalesce(att.service_provided,'')))=0 then
    raise exception using errcode='23514', message='Record the delivered service before completing its follow-up.';
  end if;
  if target.linked_service_id not in ('', att.id::text) then
    raise exception using errcode='23505', message='This follow-up is already linked to another healthcare record.';
  end if;
  if att.follow_up_id is not null and att.follow_up_id <> target.id then
    raise exception using errcode='23505', message='This attendance record is already linked to another follow-up.';
  end if;
  update public.health_service_attendance set follow_up_id=target.id where id=att.id;
  update public.follow_ups set linked_service_type='health_service', linked_service_id=att.id::text,
    status='Completed', completed_at=coalesce(completed_at, now()) where id=target.id returning * into target;
  return target;
end; $$;
revoke all on function public.complete_follow_up_from_service_attendance(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.complete_follow_up_from_service_attendance(uuid,uuid,uuid) to service_role;

-- New operational follow-ups inherit a registered facility from their creator.
create or replace function public.health_schedule_request_submit(
  p_actor_id uuid, p_resident_id text, p_target_type text, p_target_id uuid, p_request_type text,
  p_proposed_scheduled_at timestamptz, p_reason text
) returns public.health_schedule_requests
language plpgsql security definer set search_path = public as $$
declare target_facility uuid; target_resident text; current_schedule timestamptz;
  result public.health_schedule_requests%rowtype; facility public.facilities%rowtype;
  new_response text; actor public.profiles%rowtype;
  referral_before public.health_referrals%rowtype; referral_after public.health_referrals%rowtype;
begin
  select * into actor from public.profiles where id=p_actor_id;
  if actor.id is null or actor.role not in ('resident','resident-limited')
    or not exists(select 1 from public.residents where auth_user_id=p_actor_id and id=p_resident_id) then
    raise exception using errcode='42501', message='Only the linked resident may respond to this schedule.';
  end if;
  if p_target_type = 'referral' then
    select recipient_facility_id, resident_id, scheduled_at into target_facility, target_resident, current_schedule
      from public.health_referrals where id = p_target_id for update;
  elsif p_target_type = 'follow_up' then
    select facility_id, resident_id,
      ((scheduled_date::text || ' ' || coalesce(scheduled_time::text, '00:00'))::timestamp at time zone 'Asia/Manila')
      into target_facility, target_resident, current_schedule
      from public.follow_ups where id = p_target_id for update;
  else raise exception using errcode='22023', message='Invalid schedule target.';
  end if;
  if target_resident is distinct from p_resident_id then raise exception using errcode='42501', message='Schedule not found.'; end if;
  if target_facility is null then raise exception using errcode='22023', message='This schedule has no registered receiving facility. Please contact the facility directly.'; end if;
  select * into facility from public.facilities where id = target_facility;
  if not found or facility.municipality_id is distinct from (select municipality_id from public.residents where id=p_resident_id) then
    raise exception using errcode='22023', message='This schedule is outside the municipality. Please contact the receiving facility directly.';
  end if;
  if p_request_type not in ('attendance','reschedule','cancellation') then raise exception using errcode='22023', message='Invalid schedule request.'; end if;
  if p_request_type in ('reschedule','cancellation') and length(btrim(coalesce(p_reason,''))) = 0 then
    raise exception using errcode='22023', message='A reason is required.';
  end if;
  if p_request_type = 'reschedule' and (p_proposed_scheduled_at is null or p_proposed_scheduled_at <= now()) then
    raise exception using errcode='22023', message='The proposed schedule must be in the future.';
  end if;
  if p_request_type = 'attendance' then new_response := 'Attendance Confirmed';
  elsif p_request_type = 'reschedule' then new_response := 'Reschedule Requested';
  else new_response := 'Cancellation Requested'; end if;
  if p_request_type in ('reschedule','cancellation') and exists(
    select 1 from public.health_schedule_requests where
      ((p_target_type='referral' and referral_id=p_target_id) or (p_target_type='follow_up' and follow_up_id=p_target_id))
      and status='Pending Approval'
  ) then raise exception using errcode='23505', message='A schedule request is already awaiting review.'; end if;
  if p_request_type='attendance' and (
    exists(select 1 from public.health_schedule_requests where
      ((p_target_type='referral' and referral_id=p_target_id) or (p_target_type='follow_up' and follow_up_id=p_target_id))
      and status='Pending Approval')
    or (p_target_type='referral' and exists(select 1 from public.health_referrals where id=p_target_id and schedule_response_status='Attendance Confirmed'))
    or (p_target_type='follow_up' and exists(select 1 from public.follow_ups where id=p_target_id and schedule_response_status='Attendance Confirmed'))
  ) then raise exception using errcode='23505', message='Attendance has already been confirmed or a schedule request is awaiting review.'; end if;
  if p_target_type = 'referral' then
    if exists(select 1 from public.health_referrals where id=p_target_id and status in ('Completed','Rejected','Cancelled')) then
      raise exception using errcode='23514', message='This referral is already closed.';
    end if;
    select * into referral_before from public.health_referrals where id=p_target_id;
    update public.health_referrals set schedule_response_status=new_response, version=version+1 where id=p_target_id returning * into referral_after;
    perform public.canonical_referral_event(referral_after, p_actor_id, 'Schedule response', to_jsonb(referral_before), btrim(coalesce(p_reason,'')), true);
  else
    if exists(select 1 from public.follow_ups where id=p_target_id and status in ('Completed','Missed','Cancelled','Rejected')) then
      raise exception using errcode='23514', message='This follow-up is already closed.';
    end if;
    update public.follow_ups set schedule_response_status=new_response where id=p_target_id;
  end if;
  insert into public.health_schedule_requests(resident_id, referral_id, follow_up_id, facility_id, request_type, status,
    original_scheduled_at, proposed_scheduled_at, reason, requested_by, reviewed_at)
  values (p_resident_id, case when p_target_type='referral' then p_target_id end,
    case when p_target_type='follow_up' then p_target_id end, target_facility, p_request_type,
    case when p_request_type='attendance' then 'Approved' else 'Pending Approval' end,
    current_schedule, p_proposed_scheduled_at, btrim(coalesce(p_reason,'')), p_actor_id,
    case when p_request_type='attendance' then now() end)
  returning * into result;
  insert into public.health_audit_logs(actor_id, action, entity_type, entity_id, municipality_id, barangay_id, metadata)
  select p_actor_id, 'SCHEDULE_' || upper(p_request_type) || '_REQUESTED', p_target_type,
    p_target_id::text, r.municipality_id, r.barangay_id,
    jsonb_build_object('request_id', result.id, 'status', result.status, 'proposed_scheduled_at', result.proposed_scheduled_at)
  from public.residents r where r.id=p_resident_id;
  return result;
end; $$;

create or replace function public.health_schedule_request_decide(
  p_request_id uuid, p_actor_id uuid, p_decision text, p_review_reason text
) returns public.health_schedule_requests
language plpgsql security definer set search_path = public as $$
declare req public.health_schedule_requests%rowtype; actor public.profiles%rowtype;
  facility public.facilities%rowtype; resident public.residents%rowtype; response text;
  referral_before public.health_referrals%rowtype; referral_after public.health_referrals%rowtype;
begin
  select * into req from public.health_schedule_requests where id=p_request_id for update;
  if not found then raise exception using errcode='P0002', message='Schedule request not found.'; end if;
  if req.status <> 'Pending Approval' then raise exception using errcode='23514', message='This request has already been reviewed.'; end if;
  if p_decision not in ('Approved','Rejected') then raise exception using errcode='22023', message='Invalid request decision.'; end if;
  select * into actor from public.profiles where id=p_actor_id;
  select * into facility from public.facilities where id=req.facility_id;
  select * into resident from public.residents where id=req.resident_id;
  if actor.id is null or actor.status <> 'active'
    or actor.role not in ('health_supervisor','rhu_personnel')
    or actor.municipality_id is distinct from facility.municipality_id
    or facility.municipality_id is distinct from resident.municipality_id then
    raise exception using errcode='42501', message='An active, in-scope health personnel account is required.';
  end if;
  if req.referral_id is not null then select * into referral_before from public.health_referrals where id=req.referral_id for update; end if;
  if actor.role='health_supervisor' then
    if facility.type <> 'barangay_health_station' or actor.barangay_id is distinct from facility.barangay_id then
      raise exception using errcode='42501', message='This request is outside your barangay assignment.';
    end if;
  elsif actor.role='rhu_personnel' then
    if facility.type <> 'rhu' or actor.facility_id is distinct from facility.id or not ('triage'=any(actor.rhu_stations)) then
      raise exception using errcode='42501', message='This request is outside your RHU triage assignment.';
    end if;
  else raise exception using errcode='42501', message='Your role cannot review schedule requests.';
  end if;
  response := case when req.request_type='reschedule' then (case when p_decision='Approved' then 'Reschedule Approved' else 'Reschedule Rejected' end)
    when req.request_type='cancellation' then (case when p_decision='Approved' then 'Cancellation Approved' else 'Cancellation Rejected' end)
    else 'Attendance Confirmed' end;
  if p_decision='Approved' and req.request_type='reschedule' then
    if req.referral_id is not null then update public.health_referrals set scheduled_at=req.proposed_scheduled_at, scheduled_at_edited=true, schedule_response_status=response, version=version+1 where id=req.referral_id returning * into referral_after;
    else update public.follow_ups set scheduled_date=(req.proposed_scheduled_at at time zone 'Asia/Manila')::date,
      scheduled_time=(req.proposed_scheduled_at at time zone 'Asia/Manila')::time, schedule_response_status=response where id=req.follow_up_id; end if;
  elsif p_decision='Approved' and req.request_type='cancellation' then
    if req.referral_id is not null then update public.health_referrals set status='Cancelled', cancelled_at=now(), resolution_notes=coalesce(nullif(btrim(req.reason),''),'Cancellation request approved'), schedule_response_status=response, version=version+1 where id=req.referral_id returning * into referral_after;
    else update public.follow_ups set status='Cancelled', schedule_response_status=response where id=req.follow_up_id; end if;
  else
    if req.referral_id is not null then update public.health_referrals set schedule_response_status=response, version=version+1 where id=req.referral_id returning * into referral_after;
    else update public.follow_ups set schedule_response_status=response where id=req.follow_up_id; end if;
  end if;
  update public.health_schedule_requests set status=p_decision, reviewed_by=p_actor_id, reviewed_at=now(), review_reason=btrim(coalesce(p_review_reason,''))
    where id=p_request_id returning * into req;
  if req.referral_id is not null then
    perform public.canonical_referral_event(referral_after, p_actor_id, 'Schedule ' || p_decision, to_jsonb(referral_before),
      coalesce(nullif(btrim(p_review_reason),''), req.reason), true);
  end if;
  insert into public.health_audit_logs(actor_id, action, entity_type, entity_id, municipality_id, barangay_id, metadata)
  values (p_actor_id, 'SCHEDULE_REQUEST_' || upper(p_decision), case when req.referral_id is not null then 'health_referrals' else 'follow_ups' end,
    coalesce(req.referral_id, req.follow_up_id)::text, resident.municipality_id, resident.barangay_id,
    jsonb_build_object('request_id', req.id, 'request_type', req.request_type, 'review_reason', req.review_reason));
  return req;
end; $$;

revoke all on function public.health_schedule_request_submit(uuid,text,text,uuid,text,timestamptz,text) from public, anon, authenticated;
revoke all on function public.health_schedule_request_decide(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.health_schedule_request_submit(uuid,text,text,uuid,text,timestamptz,text) to service_role;
grant execute on function public.health_schedule_request_decide(uuid,uuid,text,text) to service_role;
commit;

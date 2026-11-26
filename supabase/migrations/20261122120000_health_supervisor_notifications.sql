-- supabase/migrations/20261122120000_health_supervisor_notifications.sql
-- Real recipient-owned Health Supervisor events and durable upcoming reminders.
-- No historical events are fabricated, and clinical/workflow state is unchanged.
begin;
alter table public.notifications add column if not exists event_key text;
create unique index if not exists notifications_recipient_event_key_unique
  on public.notifications(recipient_id, event_key) where event_key is not null;
create index if not exists notifications_owner_page_idx
  on public.notifications(recipient_id, created_at desc, id desc);
create index if not exists notifications_owner_unread_idx
  on public.notifications(recipient_id) where read_at is null;
-- Keep personnel_account_access_gate, including its credential/session fence.
-- Owned history remains readable after a resident or supervisor changes barangay.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated
  using (recipient_id = auth.uid() or public.is_admin());
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
revoke all on public.notifications from anon;
revoke insert, delete, truncate, references, trigger, update on public.notifications from authenticated;
grant select, update(read_at) on public.notifications to authenticated;
create or replace function public.guard_notification_recipient_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (current_setting('role', true) in ('anon', 'authenticated') or auth.role() = 'authenticated')
    and (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception using errcode = '42501', message = 'Notification recipients may only change read_at.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_notification_recipient_update() from public, anon, authenticated;
-- One statement snapshot contains the entire owner count and a deterministic page.
create or replace function public.list_owned_notifications(
  p_recipient_id uuid, p_limit integer default 100, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if p_recipient_id is null or p_limit is null or p_limit < 1 or p_limit > 100
    or p_offset is null or p_offset < 0 then
    raise exception using errcode = '22023', message = 'Invalid notification pagination.';
  end if;
  with totals as (
    select count(*) as total, count(*) filter (where read_at is null) as unread
    from public.notifications where recipient_id = p_recipient_id
  ), page as (
    select * from public.notifications where recipient_id = p_recipient_id
    order by created_at desc, id desc limit p_limit offset p_offset
  )
  select jsonb_build_object('rows', (select coalesce(jsonb_agg(to_jsonb(page)
    order by created_at desc, id desc), '[]'::jsonb) from page),
    'total', total, 'unread', unread, 'limit', p_limit, 'offset', p_offset)
    into result from totals;
  return result;
end;
$$;
create or replace function public.mark_owned_notification_read(p_recipient_id uuid, p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.notifications%rowtype;
begin
  if p_recipient_id is null or p_notification_id is null then
    raise exception using errcode = '22023', message = 'An owner and notification are required.';
  end if;
  update public.notifications set read_at = coalesce(read_at, now())
    where id = p_notification_id and recipient_id = p_recipient_id returning * into result;
  if not found then return null; end if;
  return to_jsonb(result);
end;
$$;
create or replace function public.mark_all_owned_notifications_read(p_recipient_id uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare changed bigint;
begin
  if p_recipient_id is null then raise exception using errcode = '22023', message = 'An owner is required.'; end if;
  with written as (
    update public.notifications set read_at = now()
      where recipient_id = p_recipient_id and read_at is null returning id
  ) select count(*) into changed from written;
  return changed;
end;
$$;
revoke all on function public.list_owned_notifications(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.mark_owned_notification_read(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mark_all_owned_notifications_read(uuid) from public, anon, authenticated;
grant execute on function public.list_owned_notifications(uuid, integer, integer) to service_role;
grant execute on function public.mark_owned_notification_read(uuid, uuid) to service_role;
grant execute on function public.mark_all_owned_notifications_read(uuid) to service_role;
-- These server-owned tokens change only for meaningful domain events, not notes,
-- generic updated_at writes, or clock-derived status labels. They also identify
-- existing outstanding records during worker catch-up without inventing history.
alter table public.residents
  add column if not exists notification_verification_event_id uuid not null default gen_random_uuid(),
  add column if not exists notification_risk_event_id uuid not null default gen_random_uuid();
alter table public.visits
  add column if not exists notification_attention_event_id uuid not null default gen_random_uuid();
alter table public.follow_ups
  add column if not exists notification_schedule_event_id uuid not null default gen_random_uuid(),
  add column if not exists notification_state_event_id uuid not null default gen_random_uuid();
alter table public.health_services
  add column if not exists notification_schedule_event_id uuid not null default gen_random_uuid();
alter table public.health_service_assignments
  add column if not exists notification_event_id uuid not null default gen_random_uuid();
create or replace function public.notification_account_can_receive(p_account_id uuid, p_municipality_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    join auth.users u on u.id = p.id
    join public.municipalities m on m.id = p.municipality_id and m.is_active
    left join public.personnel_accounts a on a.account_id = p.id
    where p.id = p_account_id and p.municipality_id = p_municipality_id and (
      (p.role in ('resident', 'resident-limited') and p.status in ('active', 'pending_verification'))
      or (p.role in ('health_supervisor', 'phn', 'mho', 'rhu_personnel', 'bhw') and p.status = 'active'
        and ((a.account_id is null and coalesce(u.raw_app_meta_data->>'personnel_managed', 'false') = 'false')
          or (a.approval_status = 'approved' and not a.setup_required
          and not a.must_change_password and a.suspended_at is null
          and (a.temporary_password_expires_at is null or a.temporary_password_expires_at > now())))
        and (p.role not in ('health_supervisor', 'bhw') or exists (
          select 1 from public.barangays b where b.id = p.barangay_id
            and b.municipality_id = p.municipality_id and b.status = 'Active'
            and public.is_approved_barangay_name(b.name)
        )))
    )
  );
$$;
create or replace function public.notification_supervisor_recipients(
  p_municipality_id uuid, p_barangay_id uuid, p_explicit_ids uuid[] default '{}'
) returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p
  where p.role = 'health_supervisor' and p.municipality_id = p_municipality_id
    and public.notification_account_can_receive(p.id, p_municipality_id)
    and (p.barangay_id = p_barangay_id or p.id = any(coalesce(p_explicit_ids, '{}'::uuid[])));
$$;
create or replace function public.notification_emit_supervisors(
  p_municipality_id uuid, p_barangay_id uuid, p_explicit_ids uuid[], p_event_key text,
  p_category text, p_title text, p_message text, p_related_type text, p_related_id text,
  p_priority text default null, p_exclude_id uuid default null
) returns integer language sql security definer set search_path = public as $$
  with written as (
    insert into public.notifications(recipient_id, event_key, category, title, message, related_type, related_id, priority)
    select recipient, p_event_key, p_category, p_title, p_message, p_related_type, p_related_id, p_priority
    from public.notification_supervisor_recipients(p_municipality_id, p_barangay_id, p_explicit_ids) recipient
    where recipient is distinct from p_exclude_id
    on conflict (recipient_id, event_key) where event_key is not null do nothing returning id
  ) select count(*)::integer from written;
$$;
-- Only a real creator identity can supplement the community scheduling audience.
-- Request reviewers are derived separately from the authoritative request facility.
-- A display-only assigned_provider is never interpreted as an account identity.
create or replace function public.notification_follow_up_supervisors(p_row public.follow_ups)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct p.id), '{}'::uuid[])
  from public.residents r join public.profiles p on p.municipality_id = r.municipality_id
  left join public.facilities f on f.id = p_row.facility_id and f.municipality_id = r.municipality_id
  where r.id = p_row.resident_id and p.role = 'health_supervisor' and p.id = p_row.created_by
    and (p.barangay_id = r.barangay_id
      or (f.type = 'barangay_health_station' and p.barangay_id = f.barangay_id)
      or (f.type = 'rhu' and p.facility_id = f.id and 'consultation' = any(p.rhu_stations)));
$$;
create or replace function public.notification_visit_ready(p_visit public.visits)
returns boolean language sql immutable set search_path = public as $$
  select p_visit.status = 'completed'
    and (p_visit.client_operation_key is null or p_visit.consultation_effects_completed_at is not null)
    and (length(btrim(p_visit.findings)) > 0 or length(btrim(p_visit.treatment_given)) > 0
      or length(btrim(coalesce(p_visit.consultation_details->>'findings', ''))) > 0
      or length(btrim(coalesce(p_visit.consultation_details->>'diagnosis', ''))) > 0
      or jsonb_typeof(p_visit.consultation_details->'clinicalAssessment') = 'object'
      or jsonb_typeof(p_visit.consultation_details->'clinical_assessment') = 'object'
      or jsonb_typeof(p_visit.consultation_details->'riskAssessment') = 'object'
      or jsonb_typeof(p_visit.consultation_details->'risk_assessment') = 'object'
      or case when jsonb_typeof(p_visit.consultation_details->'clinicalAssessmentHistory') = 'array'
        then jsonb_array_length(p_visit.consultation_details->'clinicalAssessmentHistory') > 0 else false end);
$$;
create or replace function public.notification_risk_timestamp(p_value text)
returns timestamptz language plpgsql immutable set search_path = pg_catalog, public
  set timezone = 'UTC' set datestyle = 'ISO, YMD' as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}([Tt ][0-9:.]+([Zz]|[+-][0-9:]+)?)?$' then return null; end if;
  return date_trunc('milliseconds', p_value::timestamptz);
exception when data_exception then return null;
end;
$$;
-- Weighted risk belongs to the latest completed visit. Saved clinical High
-- evidence can remain current after a normal visit, until a reviewed correction.
-- Match the actual source timestamp, including JS's millisecond serialization.
create or replace function public.notification_current_risk_is_clinical(p_resident public.residents)
returns boolean language sql stable security definer set search_path = public as $$
  select p_resident.risk_level = 'High' and p_resident.risk_assessed_at is not null and exists (
    select 1 from public.visits v where v.resident_id = p_resident.id and public.notification_visit_ready(v) and (
      (date_trunc('milliseconds', p_resident.risk_assessed_at) = date_trunc('milliseconds', coalesce(v.visit_date, v.created_at))
        and v.id = (select latest.id from public.visits latest where latest.resident_id = p_resident.id
          order by coalesce(latest.visit_date, latest.created_at) desc, latest.updated_at desc, latest.created_at desc, latest.id desc limit 1))
      or exists (
        select 1 from (
          select v.consultation_details->'clinicalAssessment' as assessment
          union all select v.consultation_details->'clinical_assessment'
          union all select v.consultation_details->'riskAssessment'
          union all select v.consultation_details->'risk_assessment'
          union all select a.value from jsonb_array_elements(case
            when jsonb_typeof(v.consultation_details->'clinicalAssessmentHistory') = 'array'
              then v.consultation_details->'clinicalAssessmentHistory' else '[]'::jsonb end) a
        ) saved where jsonb_typeof(saved.assessment) = 'object'
          and coalesce(saved.assessment->>'status', '') in ('', 'assessed', 'reviewed')
          and regexp_replace(lower(btrim(coalesce(saved.assessment->>'level', saved.assessment->>'riskLevel',
            saved.assessment->>'risk_level', ''))), '\s+risk$', '') = 'high'
          and coalesce(public.notification_risk_timestamp(saved.assessment->>'assessedAt'),
            public.notification_risk_timestamp(saved.assessment #>> '{review,at}')) = date_trunc('milliseconds', p_resident.risk_assessed_at)
      )
    )
  );
$$;
create or replace function public.notification_resident_event_tokens()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.notification_verification_event_id := gen_random_uuid();
    new.notification_risk_event_id := gen_random_uuid();
  else
    new.notification_verification_event_id := old.notification_verification_event_id;
    new.notification_risk_event_id := old.notification_risk_event_id;
    if new.verification_status is distinct from old.verification_status
      or (new.verification_status = 'pending' and new.submitted_for_verification_at is distinct from old.submitted_for_verification_at) then
      new.notification_verification_event_id := gen_random_uuid();
    end if;
    if new.risk_level is distinct from old.risk_level
      or (old.risk_assessed_at is null and new.risk_assessed_at is not null) then
      new.notification_risk_event_id := gen_random_uuid();
    end if;
  end if;
  return new;
end;
$$;
create or replace function public.notification_resident_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare verification_changed boolean; risk_changed boolean;
begin
  verification_changed := tg_op = 'INSERT' or new.notification_verification_event_id is distinct from old.notification_verification_event_id;
  risk_changed := tg_op = 'INSERT' or new.notification_risk_event_id is distinct from old.notification_risk_event_id;
  if verification_changed then
    if new.verification_status = 'pending' and new.submitted_for_verification_at is not null then
      perform public.notification_emit_supervisors(new.municipality_id, new.barangay_id, '{}',
        'hs:verification:' || new.id || ':' || new.notification_verification_event_id,
        'alert', case when tg_op = 'UPDATE' then 'Resident registration resubmitted' else 'Resident registration awaiting review' end,
        'A resident registration is awaiting verification. Review the submitted record.', 'resident_verification', new.id);
    elsif tg_op = 'INSERT' and new.verification_status = 'approved' and new.verified_by is not null
      and new.created_by_role in ('health_supervisor', 'phn', 'mho', 'bhw', 'admin') then
      perform public.notification_emit_supervisors(new.municipality_id, new.barangay_id, '{}',
        'hs:registration:' || new.id || ':' || new.notification_verification_event_id,
        'information', 'Resident registered by health staff',
        'A verified resident record was registered by authorized health staff.', 'resident_registration', new.id);
    elsif tg_op = 'UPDATE' and new.verification_status in ('approved', 'rejected', 'resubmission_required') then
      perform public.notification_emit_supervisors(new.municipality_id, new.barangay_id, '{}',
        'hs:verification:' || new.id || ':' || new.notification_verification_event_id,
        'information', 'Resident verification updated',
        case new.verification_status when 'approved' then 'A resident registration was approved.'
          when 'rejected' then 'A resident registration was rejected.'
          else 'A resident registration requires resubmission.' end, 'resident_verification', new.id);
    end if;
  end if;
  if risk_changed and public.notification_current_risk_is_clinical(new) then
    perform public.notification_emit_supervisors(new.municipality_id, new.barangay_id, '{}',
      'hs:risk:' || new.id || ':' || new.notification_risk_event_id,
      'alert', 'Resident risk review needed', 'An assessed resident has a high-risk monitoring flag. Review the health record.',
      'resident_risk', new.id);
  end if;
  return new;
end;
$$;
create or replace function public.notification_visit_event_token()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.notification_attention_event_id := gen_random_uuid();
  else
    new.notification_attention_event_id := old.notification_attention_event_id;
    if (new.consultation_details #>> '{clinicalAssessment,status}',
        new.consultation_details #>> '{clinicalAssessment,referralEvaluationRequired}',
        new.consultation_details #>> '{clinicalAssessment,urgency}') is distinct from
       (old.consultation_details #>> '{clinicalAssessment,status}',
        old.consultation_details #>> '{clinicalAssessment,referralEvaluationRequired}',
        old.consultation_details #>> '{clinicalAssessment,urgency}') then
      new.notification_attention_event_id := gen_random_uuid();
    end if;
  end if;
  return new;
end;
$$;
create or replace function public.notification_visit_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.residents%rowtype; explicit_ids uuid[]; attention boolean; initial_completion boolean; event text; priority text;
begin
  if not coalesce(public.notification_visit_ready(new), false) then return new; end if;
  initial_completion := tg_op = 'INSERT' or not coalesce(public.notification_visit_ready(old), false);
  attention := new.consultation_details #>> '{clinicalAssessment,status}' in ('assessed', 'reviewed')
    and new.consultation_details #>> '{clinicalAssessment,referralEvaluationRequired}' = 'true'
    and new.consultation_details #>> '{clinicalAssessment,urgency}' in ('immediate', 'urgent', 'prompt');
  if initial_completion then event := 'hs:visit:' || new.id || ':completed';
  elsif attention and new.notification_attention_event_id is distinct from old.notification_attention_event_id then
    event := 'hs:visit:' || new.id || ':attention:' || new.notification_attention_event_id;
  else return new;
  end if;
  select * into strict r from public.residents where id = new.resident_id;
  select coalesce(array_agg(distinct p.id), '{}'::uuid[]) into explicit_ids
  from public.profiles p left join public.facilities f on f.id = new.facility_id and f.municipality_id = r.municipality_id
  where p.role = 'health_supervisor' and p.municipality_id = r.municipality_id
    and (p.id = new.responsible_personnel_id or p.id::text = new.recorded_by_id
      or p.id::text = new.consultation_details #>> '{clinicalAssessment,assessedBy}')
    and (p.barangay_id = r.barangay_id or (f.type = 'rhu' and p.facility_id = f.id and 'consultation' = any(p.rhu_stations)));
  if attention and new.consultation_details #>> '{clinicalAssessment,urgency}' = 'immediate' then priority := 'emergency'; end if;
  perform public.notification_emit_supervisors(r.municipality_id, r.barangay_id, explicit_ids, event,
    case when attention then 'alert' else 'information' end,
    case when attention then 'Clinical record needs attention' else 'Consultation record completed' end,
    case when attention then 'A completed clinical assessment requires timely health staff review.'
      else 'A completed consultation record is available for review.' end,
    case when attention then 'clinical_attention' else 'consultation_activity' end, new.id, priority);
  return new;
end;
$$;
create or replace function public.notification_follow_up_event_tokens()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.notification_schedule_event_id := gen_random_uuid(); new.notification_state_event_id := gen_random_uuid();
  else
    new.notification_schedule_event_id := old.notification_schedule_event_id;
    new.notification_state_event_id := old.notification_state_event_id;
    if (new.scheduled_date, new.scheduled_time, new.location, new.assigned_provider, new.facility_id)
      is distinct from (old.scheduled_date, old.scheduled_time, old.location, old.assigned_provider, old.facility_id) then
      new.notification_schedule_event_id := gen_random_uuid();
    end if;
    if (new.status, new.resident_decision, new.schedule_response_status)
      is distinct from (old.status, old.resident_decision, old.schedule_response_status) then
      new.notification_state_event_id := gen_random_uuid();
    end if;
  end if;
  return new;
end;
$$;
create or replace function public.notification_follow_up_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.residents%rowtype; event text; title text; category text := 'information'; exclude_id uuid;
begin
  if (tg_op = 'INSERT' and new.status in ('Scheduled', 'Pending', 'Today', 'Upcoming', 'Ongoing'))
    or (tg_op = 'UPDATE' and new.notification_schedule_event_id is distinct from old.notification_schedule_event_id
      and new.status not in ('Completed', 'Cancelled', 'Missed', 'Rejected')) then
    event := 'hs:follow_up:' || new.id || ':schedule:' || new.notification_schedule_event_id;
    title := case when tg_op = 'INSERT' then 'Follow-up scheduled' else 'Follow-up schedule updated' end;
    category := 'reminder';
  elsif (tg_op = 'INSERT' or new.notification_state_event_id is distinct from old.notification_state_event_id)
    and (new.status in ('Completed', 'Cancelled', 'Missed', 'Rejected')
      or new.resident_decision in ('approved', 'rejected')
      or new.schedule_response_status in ('Attendance Confirmed', 'Reschedule Approved', 'Reschedule Rejected', 'Cancellation Approved', 'Cancellation Rejected')) then
    event := 'hs:follow_up:' || new.id || ':state:' || new.notification_state_event_id;
    title := case when new.status = 'Completed' then 'Follow-up completed'
      when new.status = 'Missed' then 'Follow-up needs attention'
      when new.status in ('Cancelled', 'Rejected') then 'Follow-up cancelled'
      else 'Follow-up response updated' end;
    if new.status in ('Missed', 'Rejected') or new.resident_decision = 'rejected' then category := 'alert'; end if;
    if tg_op = 'UPDATE' and new.status <> 'Completed'
      and (new.resident_decision is distinct from old.resident_decision
        or (new.schedule_response_status = 'Attendance Confirmed'
          and new.schedule_response_status is distinct from old.schedule_response_status)) then exclude_id := new.created_by; end if;
  else return new;
  end if;
  select * into strict r from public.residents where id = new.resident_id;
  perform public.notification_emit_supervisors(r.municipality_id, r.barangay_id,
    public.notification_follow_up_supervisors(new), event, category, title,
    'A resident follow-up record has a scheduling or progress update. Review the follow-up.',
    'follow_ups', new.id::text, null, exclude_id);
  return new;
end;
$$;
-- Only follow-up-side requests are new here. Canonical referral request events
-- already deliver individually addressed notifications and must not be widened.
create or replace function public.notification_deliver_follow_up_request(p_request public.health_schedule_requests)
returns integer language plpgsql security definer set search_path = public as $$
declare f public.follow_ups%rowtype; r public.residents%rowtype; explicit_ids uuid[]; inserted integer; added integer;
begin
  if p_request.follow_up_id is null or p_request.status <> 'Pending Approval' then return 0; end if;
  select * into strict f from public.follow_ups where id = p_request.follow_up_id;
  select * into strict r from public.residents where id = f.resident_id;
  if f.status in ('Completed', 'Cancelled', 'Missed', 'Rejected') or r.id is distinct from p_request.resident_id or not exists (
    select 1 from public.facilities fac where fac.id = p_request.facility_id and fac.municipality_id = r.municipality_id
  ) then return 0; end if;
  f.facility_id := p_request.facility_id;
  select coalesce(array_agg(distinct p.id), '{}'::uuid[]) into explicit_ids
  from public.profiles p join public.facilities fac on fac.id = p_request.facility_id and fac.municipality_id = r.municipality_id
  where p.role = 'health_supervisor' and p.municipality_id = r.municipality_id
    and (p.id = any(public.notification_follow_up_supervisors(f))
      or (fac.type = 'barangay_health_station' and p.barangay_id = fac.barangay_id));
  inserted := public.notification_emit_supervisors(r.municipality_id, r.barangay_id,
    explicit_ids, 'hs:follow_up_request:' || p_request.id,
    'alert', 'Follow-up schedule request needs review',
    'A resident submitted a follow-up schedule change request. Review the request at the receiving facility.',
    'health_schedule_requests', p_request.id::text, null, f.created_by);
  with written as (
    insert into public.notifications(recipient_id, event_key, category, title, message, related_type, related_id)
    select p.id, 'hs:follow_up_request:' || p_request.id, 'alert', 'Follow-up schedule request needs review',
      'A resident submitted a follow-up schedule change request for the RHU triage team.', 'health_schedule_requests', p_request.id::text
    from public.profiles p join public.facilities fac on fac.id = p.facility_id
    where p.role = 'rhu_personnel' and p.facility_id = p_request.facility_id and fac.type = 'rhu'
      and 'triage' = any(p.rhu_stations) and p.id is distinct from f.created_by
      and public.notification_account_can_receive(p.id, r.municipality_id)
    on conflict (recipient_id, event_key) where event_key is not null do nothing returning id
  ) select count(*)::integer into added from written;
  return inserted + added;
end;
$$;
create or replace function public.notification_follow_up_request_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notification_deliver_follow_up_request(new);
  return new;
end;
$$;
create or replace function public.notification_health_service_recipients(p_service public.health_services)
returns setof uuid language sql stable security definer set search_path = public as $$
  with registrants as (
    select r.* from public.residents r where r.municipality_id = p_service.municipality_id
      and (p_service.barangay_id is null or r.barangay_id = p_service.barangay_id)
      and (exists(select 1 from public.visit_plans v where v.service_id = p_service.id and v.resident_id = r.id
        and v.status = 'Planned' and v.planned_date >= (now() at time zone 'Asia/Manila')::date)
      or exists(select 1 from public.appointments a where a.service_id = p_service.id and a.resident_id = r.id
        and a.status in ('pending', 'approved', 'reschedule_proposed')
        and coalesce(a.confirmed_date, a.requested_date) >= (now() at time zone 'Asia/Manila')::date)
      or exists(select 1 from public.health_service_attendance a where a.service_id = p_service.id and a.resident_id = r.id
        and a.attendance_status = 'scheduled' and a.scheduled_date >= (now() at time zone 'Asia/Manila')::date))
  ), recipients as (
    select public.notification_supervisor_recipients(p_service.municipality_id, p_service.barangay_id,
      array[p_service.created_by]) as id
    union select a.personnel_id from public.health_service_assignments a where a.service_id = p_service.id and a.active
    union select r.auth_user_id from registrants r
    union select public.notification_supervisor_recipients(r.municipality_id, r.barangay_id, '{}') from registrants r
  ) select id from recipients where public.notification_account_can_receive(id, p_service.municipality_id);
$$;
create or replace function public.notification_deliver_health_service(
  p_service public.health_services, p_event_key text, p_title text, p_message text, p_category text default 'reminder'
) returns integer language sql security definer set search_path = public as $$
  with written as (
    insert into public.notifications(recipient_id, event_key, category, title, message, related_type, related_id)
    select recipient, p_event_key, p_category, p_title, p_message, 'health_services', p_service.id::text
    from public.notification_health_service_recipients(p_service) recipient
    on conflict (recipient_id, event_key) where event_key is not null do nothing returning id
  ) select count(*)::integer from written;
$$;
create or replace function public.notification_health_service_event_token()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.notification_schedule_event_id := gen_random_uuid();
  else
    new.notification_schedule_event_id := old.notification_schedule_event_id;
    if (new.start_date, new.start_time, new.end_date, new.end_time, new.registration_deadline,
        new.active, new.facility_id, new.barangay_id, new.municipality_id, new.custom_location, new.name)
      is distinct from (old.start_date, old.start_time, old.end_date, old.end_time, old.registration_deadline,
        old.active, old.facility_id, old.barangay_id, old.municipality_id, old.custom_location, old.name) then
      new.notification_schedule_event_id := gen_random_uuid();
    end if;
  end if;
  return new;
end;
$$;
create or replace function public.notification_health_service_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare event text; title text; message text;
begin
  if tg_op = 'DELETE' then
    perform public.notification_deliver_health_service(old,
      'hs:health_service:' || old.id || ':removed:' || old.notification_schedule_event_id,
      'Health activity removed', 'A health activity connected to your schedule or assignment was removed.', 'information');
    return old;
  end if;
  if tg_op = 'UPDATE' and new.notification_schedule_event_id = old.notification_schedule_event_id then return new; end if;
  if tg_op = 'INSERT' and (not new.active or new.start_date is null
    or (new.start_date + coalesce(new.start_time, '00:00'::time)) at time zone 'Asia/Manila' < now()) then return new; end if;
  event := 'hs:health_service:' || new.id || ':schedule:' || new.notification_schedule_event_id;
  title := case when not new.active then 'Health activity deactivated'
    when tg_op = 'INSERT' then 'Health activity scheduled' else 'Health activity updated' end;
  message := case when not new.active then 'A health activity connected to your schedule or assignment is no longer active.'
    else 'A public health activity has a schedule or assignment update. Review the health service.' end;
  perform public.notification_deliver_health_service(new, event, title, message);
  if tg_op = 'UPDATE' then perform public.notification_deliver_health_service(old, event, title, message); end if;
  return new;
end;
$$;
create or replace function public.notification_health_service_assignment_token()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or (new.active, new.personnel_id, new.service_id) is distinct from (old.active, old.personnel_id, old.service_id) then
    new.notification_event_id := gen_random_uuid();
  else new.notification_event_id := old.notification_event_id;
  end if;
  return new;
end;
$$;
-- Assignment creation already has a canonical API producer. Add only its missing
-- removal event; parent-service deletion emits once before assignments cascade.
create or replace function public.notification_health_service_unassigned()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.health_services%rowtype; event text;
begin
  if not old.active or (tg_op = 'UPDATE' and new.active and new.personnel_id = old.personnel_id and new.service_id = old.service_id) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  select * into s from public.health_services where id = old.service_id;
  if not found then if tg_op = 'DELETE' then return old; else return new; end if; end if;
  event := 'hs:health_service_assignment:' || old.id || ':removed:' ||
    case when tg_op = 'DELETE' then old.notification_event_id else new.notification_event_id end;
  if public.notification_account_can_receive(old.personnel_id, s.municipality_id) then
    insert into public.notifications(recipient_id, event_key, category, title, message, related_type, related_id)
    values(old.personnel_id, event, 'information', 'Health service assignment removed',
      'Your assignment to a health activity was removed. Review your current service schedule.', 'health_services', s.id::text)
    on conflict (recipient_id, event_key) where event_key is not null do nothing;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
drop trigger if exists notifications_resident_tokens on public.residents;
create trigger notifications_resident_tokens before insert or update on public.residents for each row execute function public.notification_resident_event_tokens();
drop trigger if exists notifications_resident_events on public.residents;
create trigger notifications_resident_events after insert or update on public.residents for each row execute function public.notification_resident_events();
drop trigger if exists notifications_visit_token on public.visits;
create trigger notifications_visit_token before insert or update on public.visits for each row execute function public.notification_visit_event_token();
drop trigger if exists notifications_visit_events on public.visits;
create trigger notifications_visit_events after insert or update on public.visits for each row execute function public.notification_visit_events();
drop trigger if exists notifications_follow_up_tokens on public.follow_ups;
create trigger notifications_follow_up_tokens before insert or update on public.follow_ups for each row execute function public.notification_follow_up_event_tokens();
drop trigger if exists notifications_follow_up_events on public.follow_ups;
create trigger notifications_follow_up_events after insert or update on public.follow_ups for each row execute function public.notification_follow_up_events();
drop trigger if exists notifications_follow_up_request_event on public.health_schedule_requests;
create trigger notifications_follow_up_request_event after insert on public.health_schedule_requests for each row execute function public.notification_follow_up_request_event();
drop trigger if exists notifications_health_service_token on public.health_services;
create trigger notifications_health_service_token before insert or update on public.health_services for each row execute function public.notification_health_service_event_token();
drop trigger if exists notifications_health_service_events on public.health_services;
create trigger notifications_health_service_events after insert or update on public.health_services for each row execute function public.notification_health_service_events();
drop trigger if exists notifications_health_service_removed on public.health_services;
create trigger notifications_health_service_removed before delete on public.health_services for each row execute function public.notification_health_service_events();
drop trigger if exists notifications_health_service_assignment_token on public.health_service_assignments;
create trigger notifications_health_service_assignment_token before insert or update on public.health_service_assignments for each row execute function public.notification_health_service_assignment_token();
drop trigger if exists notifications_health_service_unassigned on public.health_service_assignments;
create trigger notifications_health_service_unassigned after update or delete on public.health_service_assignments for each row execute function public.notification_health_service_unassigned();
-- The worker catches up only current actionable records. Unique recipient/event
-- keys make retries, competing workers and restarts safe without a process-local
-- sent cache. Local schedule values are interpreted on the Philippine calendar.
create or replace function public.deliver_health_supervisor_reminders(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.residents%rowtype; f public.follow_ups%rowtype; s public.health_services%rowtype;
  req public.health_schedule_requests%rowtype; starts_at timestamptz; inserted bigint := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'The notification worker requires service authorization.';
  end if;
  if p_now is null or not isfinite(p_now) then raise exception using errcode = '22023', message = 'Invalid reminder time.'; end if;
  for r in select * from public.residents where (verification_status = 'pending' and submitted_for_verification_at is not null)
    or (risk_level = 'High' and risk_assessed_at is not null) for share loop
    if r.verification_status = 'pending' and r.submitted_for_verification_at is not null then
      inserted := inserted + public.notification_emit_supervisors(r.municipality_id, r.barangay_id, '{}',
        'hs:verification:' || r.id || ':' || r.notification_verification_event_id,
        'alert', 'Resident registration awaiting review', 'A resident registration is awaiting verification. Review the submitted record.',
        'resident_verification', r.id);
    end if;
    if public.notification_current_risk_is_clinical(r) then
      inserted := inserted + public.notification_emit_supervisors(r.municipality_id, r.barangay_id, '{}',
        'hs:risk:' || r.id || ':' || r.notification_risk_event_id, 'alert', 'Resident risk review needed',
        'An assessed resident has a high-risk monitoring flag. Review the health record.', 'resident_risk', r.id);
    end if;
  end loop;
  for f in select * from public.follow_ups where status in ('Scheduled', 'Pending', 'Today', 'Upcoming', 'Ongoing')
    and scheduled_date >= (p_now at time zone 'Asia/Manila')::date for share loop
    select * into strict r from public.residents where id = f.resident_id;
    starts_at := (f.scheduled_date + coalesce(f.scheduled_time, '00:00'::time)) at time zone 'Asia/Manila';
    if starts_at >= p_now then
      inserted := inserted + public.notification_emit_supervisors(r.municipality_id, r.barangay_id,
        public.notification_follow_up_supervisors(f), 'hs:follow_up:' || f.id || ':schedule:' || f.notification_schedule_event_id,
        'reminder', 'Follow-up scheduled', 'A resident follow-up schedule is available for review.', 'follow_ups', f.id::text);
      if starts_at <= p_now + interval '24 hours' and f.status <> 'Pending'
        and (not f.requires_resident_response or f.resident_decision = 'approved') then
        inserted := inserted + public.notification_emit_supervisors(r.municipality_id, r.barangay_id,
          public.notification_follow_up_supervisors(f), 'hs:follow_up:' || f.id || ':upcoming:' || f.notification_schedule_event_id,
          'reminder', 'Upcoming follow-up', 'A confirmed resident follow-up is due within the next 24 hours.', 'follow_ups', f.id::text);
      end if;
    end if;
  end loop;
  for req in select * from public.health_schedule_requests where follow_up_id is not null and status = 'Pending Approval' for share loop
    inserted := inserted + public.notification_deliver_follow_up_request(req);
  end loop;
  for s in select * from public.health_services where active and start_date >= (p_now at time zone 'Asia/Manila')::date for share loop
    starts_at := (s.start_date + coalesce(s.start_time, '00:00'::time)) at time zone 'Asia/Manila';
    if starts_at >= p_now then
      inserted := inserted + public.notification_deliver_health_service(s,
        'hs:health_service:' || s.id || ':schedule:' || s.notification_schedule_event_id,
        'Health activity scheduled', 'A public health activity has a schedule or assignment update. Review the health service.');
      if starts_at <= p_now + interval '24 hours' then
        inserted := inserted + public.notification_deliver_health_service(s,
          'hs:health_service:' || s.id || ':upcoming:' || s.notification_schedule_event_id,
          'Upcoming health activity', 'A health activity connected to your schedule or assignment starts within the next 24 hours.');
      end if;
    end if;
  end loop;
  return jsonb_build_object('inserted', inserted);
end;
$$;
revoke all on function public.deliver_health_supervisor_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.deliver_health_supervisor_reminders(timestamptz) to service_role;
-- All resolver/emitter/trigger helpers are internal, never browser-callable RPCs.
do $$
declare signature text;
begin
  foreach signature in array array[
    'public.notification_account_can_receive(uuid,uuid)',
    'public.notification_supervisor_recipients(uuid,uuid,uuid[])',
    'public.notification_emit_supervisors(uuid,uuid,uuid[],text,text,text,text,text,text,text,uuid)',
    'public.notification_follow_up_supervisors(public.follow_ups)',
    'public.notification_visit_ready(public.visits)',
    'public.notification_risk_timestamp(text)',
    'public.notification_current_risk_is_clinical(public.residents)',
    'public.notification_resident_event_tokens()', 'public.notification_resident_events()',
    'public.notification_visit_event_token()', 'public.notification_visit_events()',
    'public.notification_follow_up_event_tokens()', 'public.notification_follow_up_events()',
    'public.notification_deliver_follow_up_request(public.health_schedule_requests)',
    'public.notification_follow_up_request_event()',
    'public.notification_health_service_recipients(public.health_services)',
    'public.notification_deliver_health_service(public.health_services,text,text,text,text)',
    'public.notification_health_service_event_token()', 'public.notification_health_service_events()',
    'public.notification_health_service_assignment_token()', 'public.notification_health_service_unassigned()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', signature);
  end loop;
end;
$$;
alter table public.notifications replica identity full;
do $$
begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables)
    and not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;


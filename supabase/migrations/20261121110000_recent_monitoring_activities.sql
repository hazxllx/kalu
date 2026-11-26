-- supabase/migrations/20261121110000_recent_monitoring_activities.sql
begin;

-- Assessment snapshots contain server-generated ISO timestamps, but retained
-- JSON can be malformed. Invalid legacy values must not break the whole feed.
create function public.monitoring_activity_timestamp(p_value text)
returns timestamptz language plpgsql immutable strict
set search_path = pg_catalog, public, pg_temp
as $$
declare v_time timestamptz;
begin
  if p_value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then return null; end if;
  v_time := p_value::timestamptz;
  if isfinite(v_time) then return v_time; end if;
  return null;
exception when data_exception then return null;
end;
$$;

create index if not exists monitoring_audit_scope_created_idx
  on public.health_audit_logs (municipality_id, barangay_id, created_at desc, id);
create index if not exists monitoring_visits_resident_created_idx
  on public.visits (resident_id, created_at desc, id);
create index if not exists monitoring_followups_resident_created_idx
  on public.follow_ups (resident_id, created_at desc, id);

create function public.scoped_recent_monitoring_activities(p_actor_id uuid, p_barangay text default null)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_actor record;
  v_barangay_id uuid;
  v_barangay_name text;
  v_scope_ids uuid[];
  v_link_households boolean;
  v_link_followups boolean;
  v_link_referrals boolean;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Monitoring activities require the trusted API.';
  end if;
  -- Match scoped_aggregate_analytics, including legacy unmanaged personnel.
  select p.role, p.municipality_id, p.barangay_id into v_actor
  from public.profiles p left join public.personnel_accounts a on a.account_id = p.id
  where p.id = p_actor_id and p.status = 'active' and p.role in ('mho', 'phn', 'health_supervisor')
    and (a.account_id is null or (a.approval_status = 'approved' and not a.setup_required and a.suspended_at is null));
  if not found or not public.personnel_actor_has_permission(p_actor_id, 'reports.analytics.view') then
    raise exception using errcode = '42501', message = 'An authorized active analytics account is required.';
  end if;
  if not exists (select 1 from public.municipalities m where m.id = v_actor.municipality_id and m.is_active) then
    raise exception using errcode = '42501', message = 'Your account requires an active municipality assignment.';
  end if;
  p_barangay := nullif(btrim(p_barangay), '');
  if v_actor.role = 'health_supervisor' then
    select b.id, b.name into v_barangay_id, v_barangay_name from public.barangays b
    where b.id = v_actor.barangay_id and b.municipality_id = v_actor.municipality_id
      and b.status = 'Active' and public.is_approved_barangay_name(b.name);
    if not found then
      raise exception using errcode = '42501', message = 'Your account requires an approved active barangay assignment.';
    end if;
    if p_barangay is not null and lower(p_barangay) <> lower(v_barangay_name) and p_barangay <> v_barangay_id::text then
      raise exception using errcode = '42501', message = 'The requested barangay is outside your assigned scope.';
    end if;
  elsif p_barangay is not null then
    select b.id into v_barangay_id from public.barangays b
    where b.municipality_id = v_actor.municipality_id and lower(btrim(b.name)) = lower(p_barangay)
      and b.status = 'Active' and public.is_approved_barangay_name(b.name);
    if not found then
      raise exception using errcode = '22023', message = 'The selected barangay is not registered in your analytics scope.';
    end if;
  end if;
  select array_agg(b.id) into v_scope_ids from public.barangays b
  where b.municipality_id = v_actor.municipality_id and b.status = 'Active'
    and public.is_approved_barangay_name(b.name) and (v_barangay_id is null or b.id = v_barangay_id);

  -- These existing supervisor UI targets also require record-read permission.
  -- Analytics permission alone never grants a record identifier or link.
  v_link_households := v_actor.role = 'health_supervisor'
    and public.personnel_actor_has_permission(p_actor_id, 'households.view');
  v_link_followups := v_actor.role = 'health_supervisor'
    and public.personnel_actor_has_permission(p_actor_id, 'followups.view');
  v_link_referrals := v_actor.role = 'health_supervisor' and (
    public.personnel_actor_has_permission(p_actor_id, 'referrals.view')
    or public.personnel_actor_has_permission(p_actor_id, 'referrals.history.view'));

  with residents as materialized (
    select r.id, r.created_at from public.residents r
    where r.municipality_id = v_actor.municipality_id and r.barangay_id = any(v_scope_ids)
  ), households as materialized (
    select h.id from public.households h
    where h.municipality_id = v_actor.municipality_id and h.barangay_id = any(v_scope_ids)
  ), household_visits as (
    select v.id, v.household_id, v.created_at from public.household_visits v join households h on h.id = v.household_id
    -- Legacy quarter-date imports have no recorder and their migration-time
    -- created_at is not a real monitoring event. Verification is review work.
    where v.recorded_by is not null and isfinite(v.visit_date)
      and v.visit_reason in ('Initial Profiling', 'Updating Household Information', 'Follow-up', 'Monitoring')
  ), visits as materialized (
    select v.id, v.created_at, v.consultation_details from public.visits v join residents r on r.id = v.resident_id
  ), assessments as (
    -- Only append-only history, never the replaceable current assessment or
    -- visits.updated_at. Repeated identical visit/timestamp/status snapshots count once.
    select distinct v.id, public.monitoring_activity_timestamp(a.value ->> 'assessedAt') as occurred_at,
      a.value ->> 'status' as status
    from visits v cross join lateral jsonb_array_elements(case
      when jsonb_typeof(v.consultation_details -> 'clinicalAssessmentHistory') = 'array'
        then v.consultation_details -> 'clinicalAssessmentHistory' else '[]'::jsonb end) a(value)
    where a.value ->> 'status' in ('assessed', 'incomplete', 'pending_clinical_approval')
  ), followups as materialized (
    select f.id, f.created_at, f.completed_at, f.scheduled_date, f.status,
      f.requires_resident_response, f.resident_decision
    from public.follow_ups f join residents r on r.id = f.resident_id
  ), program_forms as materialized (
    select 'ncd_risk_assessments' as entity_type, f.id::text as id
      from public.ncd_risk_assessments f join residents r on r.id = f.resident_id
    union all select 'ncd_cervical_breast', f.id::text
      from public.ncd_cervical_breast f join residents r on r.id = f.resident_id
    union all select 'ncd_visual_ppv', f.id::text
      from public.ncd_visual_ppv f join residents r on r.id = f.resident_id
    union all select 'oral_health_records', f.id::text
      from public.oral_health_records f join residents r on r.id = f.resident_id
    union all select 'environmental_masterlist', f.id::text
      from public.environmental_masterlist f join households h on h.id = f.household_id
  ), audit_kinds(action, entity_type, kind) as (values
    ('HOUSEHOLD_MEMBER_HEALTH_UPDATED', 'households', 'record_updated'),
    ('TCL_CREATED', 'tcl_entries', 'tcl_created'),
    ('TCL_UPDATED', 'tcl_entries', 'record_updated'),
    ('IMMUNIZATIONS_CREATED', 'immunizations', 'immunization_created'),
    ('IMMUNIZATIONS_UPDATED', 'immunizations', 'record_updated'),
    -- programForms.service emits literal hyphens in these exact action names.
    -- Both creation and update use the audit timestamp, not a form's mutable
    -- assessment_date/updated_at; each event kind has only this canonical source.
    ('NCD-RISK_CREATED', 'ncd_risk_assessments', 'assessment_form_created'),
    ('NCD-RISK_UPDATED', 'ncd_risk_assessments', 'assessment_form_updated'),
    ('NCD-CERVICAL_CREATED', 'ncd_cervical_breast', 'assessment_form_created'),
    ('NCD-CERVICAL_UPDATED', 'ncd_cervical_breast', 'assessment_form_updated'),
    ('NCD-VISUAL_CREATED', 'ncd_visual_ppv', 'assessment_form_created'),
    ('NCD-VISUAL_UPDATED', 'ncd_visual_ppv', 'assessment_form_updated'),
    ('ORAL-HEALTH_CREATED', 'oral_health_records', 'assessment_form_created'),
    ('ORAL-HEALTH_UPDATED', 'oral_health_records', 'assessment_form_updated'),
    ('ENVIRONMENTAL_CREATED', 'environmental_masterlist', 'assessment_form_created'),
    ('ENVIRONMENTAL_UPDATED', 'environmental_masterlist', 'assessment_form_updated')
  ), audit_events as (
    -- Match exact action/entity pairs and current entity geography, in addition
    -- to the audit snapshot. An audit alone cannot reveal a moved resident.
    select a.id::text as source_key, k.kind, a.created_at as occurred_at, null::text as status,
      case when a.entity_type = 'households' then 'household' end as target_type,
      case when a.entity_type = 'households' then a.entity_id end as target_id
    from public.health_audit_logs a join audit_kinds k on k.action = a.action and k.entity_type = a.entity_type
    where a.municipality_id = v_actor.municipality_id and a.barangay_id = any(v_scope_ids) and (
      (a.entity_type = 'households' and exists (select 1 from households h where h.id = a.entity_id))
      or (a.entity_type = 'tcl_entries' and exists (select 1 from public.tcl_entries t join residents r on r.id = t.resident_id
        where t.id::text = a.entity_id))
      or (a.entity_type = 'immunizations' and exists (select 1 from public.immunizations i join residents r on r.id = i.resident_id
        where i.id::text = a.entity_id))
      or exists (select 1 from program_forms f where f.entity_type = a.entity_type and f.id = a.entity_id)
    )
  ), referral_events as (
    -- Canonical history is the ONLY referral source. Its duplicate audit and
    -- legacy referral rows are excluded, as are inferred import-time statuses.
    select h.id::text as source_key, case h.action
      when 'Created' then 'referral_created' when 'Updated' then 'referral_updated'
      when 'Reassigned' then 'referral_reassigned' else 'referral_status_changed' end as kind,
      h.created_at as occurred_at, h.new_status as status, 'referral'::text as target_type, f.id::text as target_id
    from public.health_referral_history h join public.health_referrals f on f.id = h.referral_id
    join residents r on r.id = f.resident_id
    where h.action in ('Created', 'Updated', 'Reassigned', 'Status', 'Encounter')
      and h.new_status in ('Pending', 'Accepted', 'In Progress', 'Completed', 'Rejected', 'Cancelled')
      and (h.action not in ('Status', 'Encounter') or h.previous_status is distinct from h.new_status)
      and not exists (select 1 from public.health_referral_legacy_map m
        where m.health_referral_id = f.id and not m.source_visit_matches_resident)
  ), events as (
    select r.id as source_key, 'resident_created' as kind, r.created_at as occurred_at, null::text as status,
      null::text as target_type, null::text as target_id from residents r
    union all select v.id::text, 'household_visit_created', v.created_at, null, 'household', v.household_id from household_visits v
    union all select v.id, 'visit_created', v.created_at, null, null, null from visits v
    union all select a.id, 'assessment_recorded', a.occurred_at, a.status, null, null from assessments a
    union all select f.id::text, 'follow_up_created', f.created_at, null, 'follow_up', f.id::text from followups f
      where f.scheduled_date is not null and isfinite(f.scheduled_date)
        and f.status in ('Scheduled', 'Today', 'Upcoming', 'Ongoing', 'Completed', 'Missed')
        and (not f.requires_resident_response or f.resident_decision = 'approved')
    union all select f.id::text, 'follow_up_completed', f.completed_at, 'Completed', 'follow_up', f.id::text from followups f
    union all select * from audit_events
    union all select * from referral_events
  ), latest as (
    select * from events where occurred_at is not null and isfinite(occurred_at)
    order by occurred_at desc, kind collate "C", source_key collate "C", status collate "C" nulls last limit 5
  )
  select jsonb_build_object('activities', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    -- Opaque event identity for stable UI keys; never a raw clinical record ID.
    'id', md5(kind || ':' || source_key || ':' || occurred_at::text || ':' || coalesce(status, '')),
    'kind', kind, 'occurredAt', occurred_at, 'status', status,
    'target', case when (target_type = 'household' and v_link_households and target_id ~ '^[A-Za-z0-9_-]{1,32}$')
      or (target_type = 'follow_up' and v_link_followups) or (target_type = 'referral' and v_link_referrals)
      then jsonb_build_object('type', target_type, 'id', target_id) end
  )) order by occurred_at desc, kind collate "C", source_key collate "C", status collate "C" nulls last), '[]'::jsonb))
  into v_result from latest;
  return v_result;
end;
$$;

revoke all on function public.monitoring_activity_timestamp(text) from public, anon, authenticated;
revoke all on function public.scoped_recent_monitoring_activities(uuid, text) from public, anon, authenticated;
grant execute on function public.monitoring_activity_timestamp(text) to service_role;
grant execute on function public.scoped_recent_monitoring_activities(uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;

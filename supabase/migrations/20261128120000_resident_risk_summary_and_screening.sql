-- Resident-specific clinical screening details and a permission-scoped,
-- filterable resident risk register. Overall Low/Moderate/High risk continues
-- to use the existing configured weighted model; clinical flags are separate.
begin;

alter table public.residents
  add column if not exists risk_clinical_screening jsonb not null default '{}'::jsonb,
  add column if not exists risk_criteria_version text;

-- Use the requested KALUSAGAP convention for new/default BP classifications:
-- 120/80 is Normal; elevated starts at 121 systolic, Stage 1 at 130 systolic
-- or 81 diastolic. Preserve any thresholds explicitly customized by an admin.
alter table public.bp_threshold_settings
  alter column elevated_systolic_min set default 121,
  alter column stage1_diastolic_min set default 81,
  alter column crisis_systolic_min set default 180,
  alter column crisis_diastolic_min set default 120;

update public.bp_threshold_settings
set elevated_systolic_min = 121,
    stage1_diastolic_min = 81,
    crisis_systolic_min = 180,
    crisis_diastolic_min = 120
where elevated_systolic_min = 120
  and stage1_systolic_min = 130
  and stage1_diastolic_min = 80
  and stage2_systolic_min = 140
  and stage2_diastolic_min = 90
  and crisis_systolic_min in (180, 181)
  and crisis_diastolic_min in (120, 121);

create or replace function public.bp_classification_json(
  p_systolic numeric,
  p_diastolic numeric,
  p_emergency boolean default false
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_code text;
  v_label text;
  v_message text;
  v_severity integer;
  v_hypotension boolean;
begin
  if p_systolic is null or p_diastolic is null
    or p_systolic < 40 or p_systolic > 300
    or p_diastolic < 20 or p_diastolic > 200
    or p_systolic <= p_diastolic
    or p_systolic <> trunc(p_systolic)
    or p_diastolic <> trunc(p_diastolic) then
    return null;
  end if;

  v_hypotension := p_systolic < 90 or p_diastolic < 60;
  if p_systolic >= 180 or p_diastolic >= 120 then
    v_code := 'crisis';
    v_label := 'Hypertensive Urgency or Emergency';
    v_message := 'Urgency-range blood pressure requires immediate clinical assessment. Follow the applicable emergency protocol; a single reading alone does not diagnose a hypertensive emergency.';
    v_severity := 4;
  elsif p_systolic >= 140 or p_diastolic >= 90 then
    v_code := 'stage2';
    v_label := 'Stage 2 Hypertension';
    v_message := 'Very high blood pressure reading. Prompt clinical assessment is needed.';
    v_severity := 3;
  elsif p_systolic >= 130 or p_diastolic >= 81 then
    v_code := 'stage1';
    v_label := 'Stage 1 Hypertension';
    v_message := 'High blood pressure reading. Arrange appropriate clinical assessment.';
    v_severity := 2;
  elsif p_systolic >= 121 and p_systolic < 130 and p_diastolic <= 80 then
    v_code := 'elevated';
    v_label := 'Elevated Blood Pressure';
    v_message := 'Elevated reading. Recheck and monitor according to the clinical protocol.';
    v_severity := 1;
  elsif p_systolic <= 120 and p_diastolic <= 80 then
    v_code := 'normal';
    v_label := 'Normal Blood Pressure';
    v_message := case when v_hypotension
      then 'Low reading. Recheck and assess symptoms, baseline and clinical context; this classification is not a diagnosis.'
      else 'Blood pressure is within the configured screening range.'
    end;
    v_severity := 0;
  else
    return null;
  end if;

  return jsonb_build_object(
    'code', v_code,
    'label', v_label,
    'category', v_label,
    'severity', v_severity,
    'systolic', p_systolic,
    'diastolic', p_diastolic,
    'message', v_message,
    'classificationVersion', 'bp-v4',
    'emergency', v_code = 'crisis' and p_emergency,
    'emergencySymptomsPresent', p_emergency,
    'hypotensionPresent', v_hypotension,
    'interpretationStandard', 'kalusagap_configured_screening',
    'referralEvaluationRequired', v_code = 'crisis',
    'urgency', case when v_code = 'crisis' then 'immediate' else null end
  );
end;
$$;

revoke all on function public.bp_classification_json(numeric, numeric, boolean) from public, anon, authenticated;

create or replace function public.analytics_clinical_screening_for_resident(p_resident_id text)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare r public.residents%rowtype; v public.visits%rowtype; found_visit boolean := false;
  assessed_at timestamptz; age_years integer; age_months integer; maternal boolean := false;
  adult boolean := false; bp_parts text[]; systolic integer; diastolic integer;
  o2 numeric; temp numeric; pulse numeric; respiratory numeric; height_cm numeric; weight_kg numeric; bmi numeric;
  bp jsonb; bmi_result jsonb; o2_result jsonb; temp_result jsonb; pulse_result jsonb; rr_result jsonb;
  population text; population_note text; classes jsonb; alerts jsonb;
begin
  select * into r from public.residents where id = p_resident_id;
  if not found then return '{}'::jsonb; end if;
  select * into v from public.visits x where x.resident_id = p_resident_id
    and x.status not in ('draft', 'submitted')
    and (nullif(btrim(x.bp), '') is not null or x.o2sat is not null or x.temperature is not null
      or x.hr is not null or x.rr is not null or x.height_cm is not null or x.weight_kg is not null)
    order by coalesce(x.visit_date, x.created_at) desc, x.updated_at desc, x.created_at desc, x.id desc limit 1;
  found_visit := found;
  if found_visit then assessed_at := coalesce(v.visit_date, v.created_at); end if;
  if r.birth_date is not null and assessed_at is not null then
    age_years := extract(year from age((assessed_at at time zone 'Asia/Manila')::date, r.birth_date))::integer;
    age_months := age_years * 12 + extract(month from age((assessed_at at time zone 'Asia/Manila')::date, r.birth_date))::integer;
  end if;
  maternal := coalesce(v.consultation_details #>> '{clinicalContext,pregnancy,isPregnant}' = 'true', false)
    or coalesce(v.consultation_details #>> '{clinicalContext,pregnancy,isPostpartum}' = 'true', false)
    or coalesce(v.consultation_details #>> '{clinicalContext,pregnancyStatus}' in ('pregnant','postpartum'), false);
  adult := age_years >= 18 and not maternal;
  population := case when maternal then 'maternal_review_required' when age_years is null then 'age_unknown'
    when age_years < 18 then 'pediatric_review_required' else 'adult' end;
  population_note := case when maternal then 'Use the approved maternal assessment protocol.'
    when age_years is null then 'Resident age is unavailable; age-specific screening was not applied.'
    when age_years < 18 then 'Use the approved pediatric protocol.' else '' end;

  bp_parts := regexp_match(btrim(coalesce(v.bp, '')), '^([0-9]{2,3})[[:space:]]*/[[:space:]]*([0-9]{2,3})$');
  if bp_parts is not null then systolic := bp_parts[1]::integer; diastolic := bp_parts[2]::integer; end if;
  if systolic is null or diastolic is null or systolic < 40 or systolic > 300 or diastolic < 20 or diastolic > 200 or systolic <= diastolic then
    bp := jsonb_build_object('value', coalesce(v.bp, null), 'classification', 'Not classified', 'severity', 'unknown',
      'note', 'A valid systolic/diastolic reading is required.');
  elsif not adult then
    bp := jsonb_build_object('value', systolic || '/' || diastolic, 'classification', 'Not classified', 'severity', 'review', 'note', population_note);
  else
    bp := jsonb_build_object('value', systolic || '/' || diastolic || ' mmHg',
      'classification', case when systolic >= 180 or diastolic >= 120 then 'Severe Blood Pressure Alert'
        when systolic >= 140 or diastolic >= 90 then 'Stage 2 Hypertension'
        when systolic >= 130 or diastolic >= 81 then 'Stage 1 Hypertension'
        when systolic >= 121 and diastolic <= 80 then 'Elevated' else 'Normal' end,
      'severity', case when systolic >= 180 or diastolic >= 120 then 'critical'
        when systolic >= 140 or diastolic >= 90 then 'high'
        when systolic >= 130 or diastolic >= 81 then 'moderate'
        when systolic >= 121 and diastolic <= 80 then 'low' else 'none' end,
      'note', case when systolic <= 89 or diastolic <= 59
        then 'Low-reading flag: recheck and assess symptoms and clinical context.'
        else 'Screening classification only; one reading does not diagnose hypertension.' end);
  end if;

  if v.height_cm > 0 and v.weight_kg > 0 then bmi := v.weight_kg / power(v.height_cm / 100, 2); end if;
  if not adult then bmi_result := jsonb_build_object('value', bmi, 'classification', 'Not classified', 'severity', 'review', 'note', population_note);
  elsif bmi is null or bmi::text in ('NaN','Infinity','-Infinity') then bmi_result := jsonb_build_object('value', null, 'classification', 'Not assessed', 'severity', 'unknown', 'note', 'Valid height and weight are required.');
  else bmi_result := jsonb_build_object('value', bmi, 'classification', case when bmi < 18.5 then 'Underweight'
      when bmi < 23 then 'Normal' when bmi < 25 then 'Overweight' when bmi < 30 then 'Obese Class I' else 'Obese Class II' end,
    'severity', case when bmi >= 25 then 'high' when bmi >= 23 or bmi < 18.5 then 'monitor' else 'none' end);
  end if;

  o2 := v.o2sat; temp := v.temperature; pulse := v.hr; respiratory := v.rr; height_cm := v.height_cm; weight_kg := v.weight_kg;
  if o2 is null or o2 < 0 or o2 > 100 then o2_result := jsonb_build_object('value',o2,'classification','Not assessed','severity','unknown','note','Enter a valid percentage from 0 to 100.');
  elsif not adult then o2_result := jsonb_build_object('value',o2,'classification','Not classified','severity','review','note',population_note);
  else o2_result := jsonb_build_object('value',o2,'classification',case when o2 < 90 then 'Critical Low Oxygen Saturation Alert'
      when o2 < 94 then 'Reduced Oxygen Saturation' when o2 = 94 then 'Borderline Oxygen Saturation' else 'Normal Reference Range' end,
    'severity',case when o2 < 90 then 'critical' when o2 < 94 then 'high' when o2 = 94 then 'moderate' else 'none' end);
  end if;
  if temp is null or temp < 25 or temp > 45 then temp_result := jsonb_build_object('value',temp,'classification','Not assessed','severity','unknown','note','Enter a valid temperature in Celsius.');
  elsif not adult then temp_result := jsonb_build_object('value',temp,'classification','Not classified','severity','review','note',population_note);
  else temp_result := jsonb_build_object('value',temp,'classification',case when temp < 35 then 'Hypothermia Alert'
      when temp < 36.5 then 'Below Normal Reference Range' when temp <= 37.3 then 'Normal Reference Range'
      when temp < 38 then 'Above Normal Reference Range' when temp < 40 then 'Fever' else 'Very High Temperature Alert' end,
    'severity',case when temp < 35 or temp >= 40 then 'critical' when temp >= 38 then 'high'
      when temp < 36.5 or temp > 37.3 then 'monitor' else 'none' end);
  end if;
  if pulse is null or pulse < 20 or pulse > 250 then pulse_result := jsonb_build_object('value',pulse,'classification','Not assessed','severity','unknown','note','Enter a valid resting heart rate.');
  elsif not adult then pulse_result := jsonb_build_object('value',pulse,'classification','Not classified','severity','review','note',population_note);
  else pulse_result := jsonb_build_object('value',pulse,'classification',case when pulse < 60 then 'Below Normal Resting Heart Rate'
      when pulse <= 100 then 'Normal Reference Range' when pulse < 125 then 'Elevated Resting Heart Rate'
      else 'Priority Clinical Assessment Flag' end,
    'severity',case when pulse >= 125 then 'high' when pulse > 100 then 'moderate' when pulse < 60 then 'monitor' else 'none' end);
  end if;
  if respiratory is null or respiratory <= 0 or respiratory > 150 then rr_result := jsonb_build_object('value',respiratory,'classification','Not assessed','severity','unknown','note','Enter a valid respiratory rate in breaths per minute.');
  elsif maternal then rr_result := jsonb_build_object('value',respiratory,'classification','Not classified','severity','review','note',population_note);
  elsif adult then rr_result := jsonb_build_object('value',respiratory,'classification',case when respiratory < 12 then 'Below Normal Reference Range'
      when respiratory <= 20 then 'Normal Reference Range' when respiratory < 30 then 'Elevated Respiratory Rate'
      else 'Priority Clinical Assessment Flag' end,
    'severity',case when respiratory >= 30 then 'high' when respiratory > 20 then 'moderate' when respiratory < 12 then 'monitor' else 'none' end);
  elsif age_months is not null and age_months < 60 then
    rr_result := jsonb_build_object('value',respiratory,
      'classification',case when respiratory >= case when age_months < 2 then 60 when age_months < 12 then 50 else 40 end
        then 'Fast Breathing for Age' else 'Below Fast-Breathing Threshold for Age' end,
      'severity',case when respiratory >= case when age_months < 2 then 60 when age_months < 12 then 50 else 40 end then 'high' else 'none' end,
      'note','WHO IMCI age-specific screening threshold.');
  else rr_result := jsonb_build_object('value',respiratory,'classification','Not classified','severity','review','note',coalesce(nullif(population_note,''),'No approved pediatric threshold is configured for this age.'));
  end if;

  classes := jsonb_build_object('bloodPressure',bp,'bmi',bmi_result,'oxygenSaturation',o2_result,
    'respiratoryRate',rr_result,'temperature',temp_result,'heartRate',pulse_result);
  select coalesce(jsonb_agg(jsonb_build_object('indicator', key, 'classification', value->>'classification', 'value', value->'value') order by key),'[]'::jsonb)
    into alerts from jsonb_each(classes) where value->>'severity' in ('critical','high');
  return jsonb_build_object('criteriaVersion','adult-screening-2026-02','population',population,
    'assessmentAt',assessed_at,'lowBloodPressureFlag',coalesce(adult and (systolic <= 89 or diastolic <= 59),false),
    'classifications',classes,'alerts',alerts,'decisionSupportOnly',true);
end;
$$;

-- Recalculation stays within the existing resident risk model and updates an
-- independently stored screening projection; it never maps a clinical flag to
-- a new overall risk tier.
create or replace function public.refresh_resident_clinical_screening()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare target_resident_id text;
begin
  if tg_op = 'INSERT' then
    for target_resident_id in select distinct nv.resident_id from new_visits nv loop
      update public.residents set risk_clinical_screening = public.analytics_clinical_screening_for_resident(target_resident_id),
        risk_criteria_version = 'adult-screening-2026-02'
      where id = target_resident_id;
    end loop;
  elsif tg_op = 'DELETE' then
    for target_resident_id in select distinct ov.resident_id from old_visits ov loop
      update public.residents set risk_clinical_screening = public.analytics_clinical_screening_for_resident(target_resident_id)
      where id = target_resident_id;
    end loop;
  else
    for target_resident_id in select distinct changed.id from (
      select n.resident_id as id from new_visits n join old_visits o using(id)
      where (n.resident_id,n.visit_date,n.bp,n.o2sat,n.temperature,n.hr,n.rr,n.height_cm,n.weight_kg,n.consultation_details)
        is distinct from (o.resident_id,o.visit_date,o.bp,o.o2sat,o.temperature,o.hr,o.rr,o.height_cm,o.weight_kg,o.consultation_details)
      union select o.resident_id from new_visits n join old_visits o using(id) where n.resident_id is distinct from o.resident_id
    ) changed where changed.id is not null loop
      update public.residents set risk_clinical_screening = public.analytics_clinical_screening_for_resident(target_resident_id)
      where id = target_resident_id;
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists visits_resident_clinical_screening_insert on public.visits;
drop trigger if exists visits_resident_clinical_screening_update on public.visits;
drop trigger if exists visits_resident_clinical_screening_delete on public.visits;
create trigger visits_resident_clinical_screening_insert after insert on public.visits
  referencing new table as new_visits for each statement execute function public.refresh_resident_clinical_screening();
create trigger visits_resident_clinical_screening_update after update on public.visits
  referencing old table as old_visits new table as new_visits for each statement execute function public.refresh_resident_clinical_screening();
create trigger visits_resident_clinical_screening_delete after delete on public.visits
  referencing old table as old_visits for each statement execute function public.refresh_resident_clinical_screening();

update public.residents r set risk_clinical_screening = public.analytics_clinical_screening_for_resident(r.id),
  risk_criteria_version = 'adult-screening-2026-02';

-- A newer visit with no usable measurements must not erase the resident's
-- latest assessable risk. Ignore draft/submitted records and choose the latest
-- finalized visit that can actually produce a risk level. The persisted date
-- stays tied to that historical visit, never to the recalculation time.
create or replace function public.analytics_resident_risk(
  p_resident_id text, p_config jsonb, p_include_factors boolean default true,
  p_from timestamptz default null, p_until timestamptz default null
)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with latest as (
    select v.* from public.visits v
    where v.resident_id = p_resident_id
      and v.status not in ('draft', 'submitted')
      and (p_from is null or coalesce(v.visit_date, v.created_at) >= p_from)
      and (p_until is null or coalesce(v.visit_date, v.created_at) < p_until)
      and public.analytics_assess_vitals(v.bp, v.o2sat, v.temperature, v.hr, v.rr,
        v.height_cm, v.weight_kg, p_config, false) ->> 'riskLevel' is not null
    order by coalesce(v.visit_date, v.created_at) desc, v.updated_at desc, v.created_at desc, v.id desc
    limit 1
  ), vitals as materialized (
    select public.analytics_assess_vitals(v.bp, v.o2sat, v.temperature, v.hr, v.rr,
      v.height_cm, v.weight_kg, p_config, p_include_factors) as risk,
      coalesce(v.visit_date, v.created_at) as occurred_at, v.id
    from (select 1) singleton left join latest v on true
  )
  select case when exists (
      select 1 from public.visits c where c.resident_id = p_resident_id
        and c.status not in ('draft', 'submitted')
        and c.consultation_details ?| array[
          'clinicalAssessment', 'clinical_assessment', 'riskAssessment', 'risk_assessment', 'clinicalAssessmentHistory'
        ]
        and (p_from is null or coalesce(c.visit_date, c.created_at) >= p_from)
        and (p_until is null or coalesce(c.visit_date, c.created_at) < p_until)
    ) then public.analytics_overlay_clinical_risk(
      risk || jsonb_build_object('riskAssessedAt',
        case when risk ->> 'riskLevel' is not null then occurred_at end),
      occurred_at,
      public.analytics_clinical_sources(p_resident_id, p_from, p_until),
      p_include_factors,
      id
    )
    else risk || jsonb_build_object('riskAssessedAt',
      case when risk ->> 'riskLevel' is not null then occurred_at end)
    end
  from vitals;
$$;

-- Rebuild stored overall classifications through the established configurable
-- risk model; incomplete and unavailable residents use their latest
-- assessable historical consultation, or remain unclassified if none exists.
select public.recalculate_resident_risk(null, null);

-- Keep every existing directory/detail risk consumer on the same clinical
-- measurement snapshot without changing its overall risk or permission rules.
alter function public.resident_risk_for_ids(text[],uuid) rename to resident_risk_for_ids_without_screening;
create or replace function public.resident_risk_for_ids(p_resident_ids text[], p_actor_id uuid default null)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
  select coalesce(jsonb_agg(risk || jsonb_build_object('clinicalScreening',
    public.analytics_clinical_screening_for_resident(risk->>'residentId')) order by risk->>'residentId'),'[]'::jsonb)
  from jsonb_array_elements(public.resident_risk_for_ids_without_screening(p_resident_ids,p_actor_id)) risk;
$$;

create or replace function public.resident_risk_summary_records(
  p_actor_id uuid, p_barangay_id uuid default null, p_zone smallint default null,
  p_risk_level text default null, p_assessment_status text default null,
  p_from date default null, p_to date default null, p_indicator text default null,
  p_search text default null, p_limit integer default 25, p_offset integer default 0
)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
declare actor public.profiles%rowtype; result jsonb;
begin
  select * into actor from public.profiles where id = p_actor_id;
  if not found or actor.status::text <> 'active' or actor.municipality_id is null
    or actor.role::text not in ('health_supervisor','phn','mho')
    or not public.personnel_actor_has_permission(actor.id,'reports.analytics.view') then
    raise exception using errcode='42501', message='Resident risk summary is not available to this account.';
  end if;
  if p_limit < 1 or p_limit > 100 or p_offset < 0 or (p_from is not null and p_to is not null and p_from > p_to) then
    raise exception using errcode='22023', message='Invalid resident risk summary filters or pagination.';
  end if;
  if p_risk_level is not null and p_risk_level not in ('Low','Moderate','High','Unassigned') then
    raise exception using errcode='22023', message='Invalid risk level filter.';
  end if;
  if p_assessment_status is not null and p_assessment_status not in ('assessed','incomplete','unassessed') then
    raise exception using errcode='22023', message='Invalid assessment status filter.';
  end if;
  if p_indicator is not null and p_indicator not in ('bloodPressure','bmi','oxygenSaturation','respiratoryRate','temperature','heartRate') then
    raise exception using errcode='22023', message='Invalid clinical indicator filter.';
  end if;
  if actor.role::text = 'health_supervisor' and (actor.barangay_id is null or (p_barangay_id is not null and p_barangay_id <> actor.barangay_id)) then
    raise exception using errcode='42501', message='Health Supervisor risk records are restricted to the assigned barangay.';
  end if;
  if p_barangay_id is not null and not exists(select 1 from public.barangays b
    where b.id=p_barangay_id and b.municipality_id=actor.municipality_id and b.status='Active') then
    raise exception using errcode='42501', message='The selected barangay is outside the authorized municipality.';
  end if;

  with source as materialized (
    select r.id,r.first_name,r.middle_name,r.last_name,r.suffix,r.birth_date,r.sex,r.barangay,r.barangay_id,r.zone,
      b.name as barangay_name, r.risk_level as persisted_level,
      public.analytics_resident_risk(r.id,public.analytics_risk_configuration(),true) as risk,
      public.analytics_clinical_screening_for_resident(r.id) as screening,
      case when r.birth_date is not null then extract(year from age(current_date,r.birth_date))::integer end as age,
      latest.recorded_by_name as personnel
    from public.residents r join public.barangays b on b.id=r.barangay_id
    left join lateral (select v.recorded_by_name from public.visits v where v.resident_id=r.id
      order by coalesce(v.visit_date,v.created_at) desc,v.updated_at desc,v.created_at desc,v.id desc limit 1) latest on true
    where r.municipality_id=actor.municipality_id and b.municipality_id=actor.municipality_id
      and (actor.role::text <> 'health_supervisor' or r.barangay_id=actor.barangay_id)
      and (p_barangay_id is null or r.barangay_id=p_barangay_id)
      and (p_zone is null or r.zone=p_zone)
  ), normalized as materialized (
    select s.*, nullif(s.risk->>'riskLevel','') as level,
      coalesce(nullif(s.risk->>'riskAssessmentStatus',''),'unavailable') as raw_status,
      public.analytics_risk_timestamp(s.risk->>'riskAssessedAt') as assessed_at,
      coalesce(s.screening->'classifications','{}'::jsonb) as classifications
    from source s
  ), filtered as materialized (
    select n.*, case when n.level is not null then 'assessed'
      when n.raw_status='incomplete' then 'incomplete' else 'unassessed' end as status
    from normalized n
    where (p_risk_level is null or (p_risk_level='Unassigned' and n.level is null) or n.level=p_risk_level)
      and (p_assessment_status is null or (p_assessment_status='assessed' and n.level is not null)
        or (p_assessment_status='incomplete' and n.raw_status='incomplete')
        or (p_assessment_status='unassessed' and n.level is null and n.raw_status<>'incomplete'))
      and (p_from is null or (n.screening->>'assessmentAt')::timestamptz >= p_from::timestamp at time zone 'Asia/Manila')
      and (p_to is null or (n.screening->>'assessmentAt')::timestamptz < (p_to+1)::timestamp at time zone 'Asia/Manila')
      and (p_indicator is null or (n.classifications ? p_indicator and n.classifications->p_indicator->>'classification' not in ('Not assessed','Not classified')))
      and (p_search is null or concat_ws(' ',n.first_name,n.middle_name,n.last_name,n.suffix,n.id,n.barangay_name) ilike '%'||btrim(p_search)||'%')
  ), totals as (
    select count(*) as total, count(*) filter(where level is not null) as assessed,
      count(*) filter(where raw_status='incomplete') as incomplete,
      count(*) filter(where level='Low') as low, count(*) filter(where level='Moderate') as moderate,
      count(*) filter(where level='High') as high,
      count(*) filter(where level is null and raw_status<>'incomplete') as unassessed from filtered
  ), page as (
    select * from filtered order by last_name,first_name,id limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'summary',jsonb_build_object('totalResidents',t.total,'assessed',t.assessed,'incomplete',t.incomplete,
      'low',t.low,'moderate',t.moderate,'high',t.high,'unassessed',t.unassessed,
      'distribution',jsonb_build_array(jsonb_build_object('name','Low','value',t.low),
        jsonb_build_object('name','Moderate','value',t.moderate),jsonb_build_object('name','High','value',t.high),
        jsonb_build_object('name','Incomplete','value',t.incomplete),jsonb_build_object('name','Unassessed','value',t.unassessed))),
    'total',t.total,'limit',p_limit,'offset',p_offset,
    'barangays',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.name)
      from public.barangays b where b.municipality_id=actor.municipality_id and b.status='Active'
        and actor.role::text in ('phn','mho') and p_barangay_id is null),'[]'::jsonb),
    'zones',coalesce((select jsonb_agg(distinct r.zone order by r.zone) from public.residents r
      where r.municipality_id=actor.municipality_id and r.zone is not null
        and (actor.role::text <> 'health_supervisor' or r.barangay_id=actor.barangay_id)
        and (p_barangay_id is null or r.barangay_id=p_barangay_id)),'[]'::jsonb),
    'rows',(select coalesce(jsonb_agg(jsonb_build_object(
      'residentId',id,'name',trim(concat_ws(' ',first_name,nullif(middle_name,''),last_name,nullif(suffix,''))),
      'age',age,'sex',sex,'barangay',barangay_name,'zone',zone,'assessmentAt',screening->>'assessmentAt',
      'riskLevel',level,'riskAssessmentStatus',status,'riskScore',risk->'riskScore','riskFactors',risk->'riskFactors',
      'riskReason',risk->>'riskReason','missingMeasurements',risk->'missingMeasurements',
      'clinicalScreening',screening,'responsiblePersonnel',nullif(personnel,'')) order by last_name,first_name,id), '[]'::jsonb) from page))
  into result from totals t;
  return result;
end;
$$;

revoke all on function public.analytics_clinical_screening_for_resident(text) from public,anon,authenticated;
revoke all on function public.refresh_resident_clinical_screening() from public,anon,authenticated;
revoke all on function public.resident_risk_for_ids(text[],uuid) from public,anon,authenticated;
revoke all on function public.resident_risk_summary_records(uuid,uuid,smallint,text,text,date,date,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.analytics_clinical_screening_for_resident(text),
  public.resident_risk_for_ids(text[],uuid),
  public.resident_risk_summary_records(uuid,uuid,smallint,text,text,date,date,text,text,integer,integer) to service_role;

commit;
notify pgrst,'reload schema';

-- Additive consultation integrity and saved screening risk integration.
-- No historical measurements, pregnancy episodes, protocol approvals, or rows are rewritten.
begin;

-- Restore the completeness contract lost by the later numeric-parity replacement.
create or replace function public.analytics_assess_vitals(
  p_bp text, p_o2sat numeric, p_temperature numeric, p_pulse numeric,
  p_respiratory numeric, p_height_cm numeric, p_weight_kg numeric, p_config jsonb,
  p_include_factors boolean default true
)
returns jsonb language sql immutable parallel safe
set search_path = pg_catalog, public, pg_temp as $$
  with health as (
    select regexp_match(btrim(coalesce(p_bp, '')),
      '^[[:space:]]*([0-9]{2,3})[[:space:]]*/[[:space:]]*([0-9]{2,3})[[:space:]]*$') as bp,
      case when p_height_cm > 0 and p_weight_kg > 0
        and p_height_cm::text not in ('NaN','Infinity','-Infinity')
        and p_weight_kg::text not in ('NaN','Infinity','-Infinity')
        then round(p_weight_kg / ((p_height_cm / 100) * (p_height_cm / 100)), 1) end as bmi
  ), fields as (
    select field, case when measured > 0 and measured::text not in ('NaN','Infinity','-Infinity') then measured end as measured
    from health cross join lateral (values
      ('systolic', bp[1]::numeric), ('diastolic', bp[2]::numeric), ('o2sat', p_o2sat),
      ('temperature', p_temperature), ('pulse', p_pulse), ('respiratory', p_respiratory), ('bmi', bmi)
    ) measurements(field, measured)
  ), criteria as (
    select * from jsonb_to_recordset(p_config -> 'criteria') as c(
      code text, name text, field text, operator text, value numeric, value2 numeric,
      weight numeric, enabled boolean, priority integer
    ) where c.enabled is distinct from false
  ), required as (select distinct field from criteria), completeness as (
    select count(*) as required_count, count(f.measured) as available_count,
      coalesce(jsonb_agg(r.field order by r.field collate "C") filter (where f.measured is null), '[]'::jsonb) as missing
    from required r left join fields f on f.field = r.field
  ), matched as (
    select c.code, c.name, c.field, coalesce(c.weight, 0) as weight, c.priority, f.measured
    from criteria c join fields f on f.field = c.field
    where f.measured is not null and case c.operator
      when 'gte' then f.measured >= c.value when 'gt' then f.measured > c.value
      when 'lte' then f.measured <= c.value when 'lt' then f.measured < c.value
      when 'eq' then f.measured = c.value when 'between' then f.measured >= c.value and f.measured <= c.value2
      else false end
  ), explanation as (
    select 'Missing measurements: ' || string_agg(case r.field
      when 'systolic' then 'systolic blood pressure' when 'diastolic' then 'diastolic blood pressure'
      when 'o2sat' then 'oxygen saturation' when 'pulse' then 'pulse rate'
      when 'respiratory' then 'respiratory rate' when 'bmi' then 'body mass index' else r.field end,
      ', ' order by r.field collate "C") || '.' as missing_reason
    from required r left join fields f on f.field = r.field where f.measured is null
  ), score as (select coalesce(sum(weight), 0) as value from matched), assessment as (
    select c.*, score.value, case
      when score.value >= coalesce((p_config #>> '{thresholds,highMin}')::numeric, 70) then 'High'
      when score.value >= coalesce((p_config #>> '{thresholds,moderateMin}')::numeric, 40) then 'Moderate' else 'Low' end as level
    from completeness c cross join score
  )
  select jsonb_build_object(
    'riskScore', case when a.available_count > 0 then a.value end,
    'riskLevel', case when a.available_count > 0 and (a.available_count = a.required_count or a.level in ('Moderate','High')) then a.level end,
    'riskAssessmentStatus', case when a.available_count = 0 then 'unavailable'
      when a.available_count < a.required_count and a.level = 'Low' then 'incomplete' else 'assessed' end,
    'missingMeasurements', a.missing,
    'riskReason', case when a.available_count = 0 then 'No measurements required by the configured risk criteria are available.'
      when a.available_count < a.required_count and a.level = 'Low' then 'Assessment incomplete. ' || e.missing_reason
      else coalesce((select string_agg(name || ' (' || trim_scale(measured)::text || ')', '; ' order by coalesce(priority,0), code collate "C") from matched),
        'No configured risk criteria matched the recorded measurements.') || case when a.available_count < a.required_count then ' ' || e.missing_reason else '' end end,
    'riskFactors', case when p_include_factors then coalesce((select jsonb_agg(jsonb_build_object(
      'code',code,'name',name,'field',field,'measured',measured,'weight',weight
    ) order by coalesce(priority,0), code collate "C") from matched), '[]'::jsonb) else '[]'::jsonb end)
  from assessment a cross join explanation e;
$$;

create or replace function public.consultation_risk_level(p_level text)
returns text language sql immutable parallel safe set search_path = pg_catalog, public as $$
  select case regexp_replace(lower(btrim(p_level)), '[[:space:]]+risk$', '')
    when 'low' then 'Low' when 'medium' then 'Medium' when 'moderate' then 'Medium' when 'high' then 'High' end;
$$;

create or replace function public.consultation_clinical_instant(p_details jsonb, p_visit_date timestamptz)
returns timestamptz language sql immutable parallel safe set search_path = pg_catalog, public as $$
  select case when p_details->>'consultationDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    then ((p_details->>'consultationDate') || 'T' || case
      when p_details->>'consultationTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then p_details->>'consultationTime'
      else '00:00' end || ':00+08:00')::timestamptz
    else date_trunc('minute', p_visit_date at time zone 'UTC') at time zone 'UTC' end;
$$;
create index if not exists visits_clinical_risk_chronology_idx on public.visits
  (resident_id, public.consultation_clinical_instant(consultation_details, visit_date) desc, id desc);

create or replace function public.consultation_risk_review_valid(p_review jsonb)
returns boolean language sql immutable parallel safe set search_path = pg_catalog, public as $$
  select coalesce(jsonb_typeof(p_review) = 'object'
    and public.consultation_risk_level(p_review->>'level') is not null
    and p_review->'reassessmentConfirmed' = 'true'::jsonb
    and length(btrim(p_review->>'reason')) between 1 and 1000
    and length(p_review->>'reviewedBy') > 0
    and p_review->>'reviewedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.+(Z|[+-][0-9]{2}:[0-9]{2})$'
    and (p_review->>'reviewedByRole' in ('mho','phn','rhu_personnel')
      or (p_review->>'reviewedByRole' = 'health_supervisor' and p_review->>'clinicianAuthority' = 'consultation_station')), false);
$$;

create or replace function public.consultation_assessment_reasons(p_assessment jsonb)
returns jsonb language plpgsql immutable parallel safe set search_path = pg_catalog, public as $$
declare item jsonb; result jsonb := '[]'::jsonb; reason jsonb; field text; fallback text;
begin
  if jsonb_typeof(p_assessment->'reasons') = 'array' then
    for item in select value from jsonb_array_elements(p_assessment->'reasons') loop
      if jsonb_typeof(item) = 'object' then
        reason := item;
        foreach field in array array['ruleId','message','field'] loop
          if jsonb_typeof(reason->field) is distinct from 'string' then reason := reason - field; end if;
        end loop;
        if coalesce(reason->>'ruleId','') = '' then reason := reason || jsonb_build_object('ruleId','saved_risk_reason'); end if;
        if coalesce(reason->>'message','') = '' then reason := reason || jsonb_build_object('message',replace(coalesce(nullif(reason->>'field',''),
          case when reason->>'ruleId' = 'saved_risk_reason' then 'Legacy clinical rationale unavailable' else reason->>'ruleId' end),'_',' ')); end if;
        result := result || jsonb_build_array(reason);
      elsif jsonb_typeof(item) = 'string' and length(btrim(item#>>'{}')) > 0 then
        result := result || jsonb_build_array(jsonb_build_object('ruleId','saved_risk_reason','message',item#>>'{}'));
      end if;
    end loop;
    return result;
  end if;
  foreach field in array array['reasons','riskReason','risk_reason','reason'] loop
    if jsonb_typeof(p_assessment->field) = 'string' and length(btrim(p_assessment->>field)) > 0 then
      return jsonb_build_array(jsonb_build_object('ruleId','saved_risk_reason','message',p_assessment->>field));
    end if;
  end loop;
  return result;
end;
$$;

create or replace function public.consultation_saved_assessment(p_details jsonb)
returns jsonb language plpgsql immutable parallel safe set search_path = pg_catalog, public as $$
declare clinical jsonb; screening jsonb;
begin
  screening := p_details->'consultationRiskAssessment';
  clinical := coalesce(nullif(p_details->'clinicalAssessment','null'::jsonb), nullif(p_details->'clinical_assessment','null'::jsonb),
    nullif(p_details->'riskAssessment','null'::jsonb), nullif(p_details->'risk_assessment','null'::jsonb), nullif(p_details->'clinicalAssessmentHistory'->-1,'null'::jsonb));
  if clinical is null and coalesce(p_details->>'riskLevel', p_details->>'risk_level') is not null then
    clinical := jsonb_build_object('level', coalesce(p_details->>'riskLevel', p_details->>'risk_level'));
  end if;
  if public.consultation_risk_level(coalesce(clinical->>'level',clinical->>'riskLevel',clinical->>'risk_level')) = 'High'
    and public.consultation_risk_level(screening->>'level') is distinct from 'High'
    and not public.consultation_risk_review_valid(screening->'review') then return clinical; end if;
  return case when jsonb_typeof(screening) = 'object' then screening else clinical end;
end;
$$;

-- Only actual saved encounters dated no later than the reassessment may hold High.
-- A later confirmed clinical review clears older High; a routine Low/Medium does not.
create or replace function public.consultation_previous_assessment(p_resident_id text, p_exclude_visit_id text, p_as_of timestamptz, p_config jsonb default null)
returns jsonb language plpgsql stable set search_path = pg_catalog, public as $$
declare row record; assessment jsonb; historical jsonb; review jsonb; latest jsonb; tier text; sourced jsonb;
  weighted jsonb; configuration jsonb;
begin
  configuration := coalesce(p_config,public.analytics_risk_configuration());
  for row in select v.id, v.consultation_details as details,v.bp,v.o2sat,v.temperature,v.hr,v.rr,v.height_cm,v.weight_kg,
      public.consultation_clinical_instant(v.consultation_details,v.visit_date) as occurred_at
    from public.visits v where v.resident_id = p_resident_id and v.id is distinct from p_exclude_visit_id
      and public.consultation_clinical_instant(v.consultation_details,v.visit_date) <= p_as_of
    order by public.consultation_clinical_instant(v.consultation_details,v.visit_date) desc, v.id desc
  loop
    assessment := public.consultation_saved_assessment(row.details);
    tier := public.consultation_risk_level(coalesce(assessment->>'level',assessment->>'riskLevel',assessment->>'risk_level'));
    if jsonb_typeof(row.details->'consultationRiskAssessment') is distinct from 'object'
      and assessment->>'reviewStatus' is distinct from 'approved' and tier is distinct from 'High'
      and not exists(select 1 from jsonb_array_elements(coalesce(row.details->'riskReviewHistory','[]'::jsonb))
        where public.consultation_risk_review_valid(value) and value->>'level' <> 'High') then
      weighted := public.analytics_assess_vitals(row.bp,row.o2sat,row.temperature,row.hr,row.rr,row.height_cm,row.weight_kg,configuration,true);
      if weighted->>'riskLevel' = 'High' then
        assessment := jsonb_build_object('level','High','status','assessed','riskSource','legacy_weighted_measurements',
          'reviewStatus','professional_review_required','decisionSupport',true,'missingMeasurements',weighted->'missingMeasurements',
          'reasons',(select coalesce(jsonb_agg(jsonb_build_object('ruleId',value->>'code','field',value->>'field',
            'message',(value->>'name') || ' (' || trim_scale((value->>'measured')::numeric)::text || '): positive recorded legacy risk evidence, not an approved clinical protocol.') order by ordinality),'[]'::jsonb)
            from jsonb_array_elements(weighted->'riskFactors') with ordinality),
          'sourceConfig',jsonb_build_object('updatedAt',configuration->'updatedAt','thresholds',configuration->'thresholds','matchedCriteria',weighted->'riskFactors'),
          'sources',jsonb_build_array(jsonb_build_object('type','legacy_recorded_vitals','id',row.id)));
        tier := 'High';
      end if;
    end if;
    sourced := coalesce(assessment,'{}'::jsonb) || jsonb_build_object('level',tier,'reasons',public.consultation_assessment_reasons(assessment),'sourceVisitId',row.id,
      'consultationDate',to_char(row.occurred_at at time zone 'Asia/Manila','YYYY-MM-DD'),
      'consultationTime',to_char(row.occurred_at at time zone 'Asia/Manila','HH24:MI'),
      'sources',case when jsonb_typeof(assessment->'sources') = 'array' then assessment->'sources' else '[]'::jsonb end || jsonb_build_array(jsonb_build_object('type','saved_consultation','id',row.id)));
    if latest is null and tier is not null then latest := sourced; end if;
    if tier = 'High' then return sourced; end if;
    select value into review from jsonb_array_elements(
      case when jsonb_typeof(row.details->'riskReviewHistory') = 'array' then row.details->'riskReviewHistory' else '[]'::jsonb end
      || case when assessment->'review' is not null then jsonb_build_array(assessment->'review') else '[]'::jsonb end
    ) with ordinality where public.consultation_risk_review_valid(value) order by ordinality desc limit 1;
    if review is not null and public.consultation_risk_level(review->>'level') <> 'High' then
      return coalesce(latest, sourced || jsonb_build_object('level',public.consultation_risk_level(review->>'level'),'review',review));
    end if;
    select value into historical from jsonb_array_elements(
      case when jsonb_typeof(row.details->'consultationRiskAssessmentHistory') = 'array' then row.details->'consultationRiskAssessmentHistory' else '[]'::jsonb end
      || case when jsonb_typeof(row.details->'clinicalAssessmentHistory') = 'array' then row.details->'clinicalAssessmentHistory' else '[]'::jsonb end
    ) with ordinality where public.consultation_risk_level(coalesce(value->>'level',value->>'riskLevel',value->>'risk_level')) = 'High'
      order by ordinality desc limit 1;
    if historical is not null then return historical || jsonb_build_object('level','High','reasons',public.consultation_assessment_reasons(historical),'sourceVisitId',row.id,
      'consultationDate',to_char(row.occurred_at at time zone 'Asia/Manila','YYYY-MM-DD'),
      'consultationTime',to_char(row.occurred_at at time zone 'Asia/Manila','HH24:MI'),
      'sources',case when jsonb_typeof(historical->'sources') = 'array' then historical->'sources' else '[]'::jsonb end || jsonb_build_array(jsonb_build_object('type','saved_consultation','id',row.id))); end if;
  end loop;
  return latest;
end;
$$;

create or replace function public.analytics_assess_saved_visit(p_visit_id text, p_config jsonb, p_include_factors boolean default true)
returns jsonb language plpgsql stable set search_path = pg_catalog, public as $$
declare visit public.visits%rowtype; weighted jsonb; saved jsonb; screening jsonb; clinical jsonb;
  prior jsonb; review jsonb; reasons jsonb; factors jsonb; explanation text; tier text; eligible boolean; held boolean; result jsonb;
begin
  select * into visit from public.visits where id = p_visit_id;
  weighted := public.analytics_assess_vitals(visit.bp,visit.o2sat,visit.temperature,visit.hr,visit.rr,visit.height_cm,visit.weight_kg,p_config,p_include_factors);
  if visit.id is null then return weighted; end if;
  saved := public.consultation_saved_assessment(visit.consultation_details);
  screening := visit.consultation_details->'consultationRiskAssessment';
  clinical := visit.consultation_details->'clinicalAssessment';
  eligible := saved is not null and (saved = screening or saved->>'reviewStatus' = 'approved'
    or public.consultation_risk_level(coalesce(saved->>'level',saved->>'riskLevel',saved->>'risk_level')) = 'High'
    or exists(select 1 from jsonb_array_elements(public.consultation_assessment_reasons(saved)) where value->>'ruleId' in ('bp_emergency','bp_severe')));
  prior := public.consultation_previous_assessment(visit.resident_id,visit.id,public.consultation_clinical_instant(visit.consultation_details,visit.visit_date),p_config);
  select value into review from jsonb_array_elements(
    case when jsonb_typeof(visit.consultation_details->'riskReviewHistory') = 'array' then visit.consultation_details->'riskReviewHistory' else '[]'::jsonb end
    || case when screening->'review' is not null then jsonb_build_array(screening->'review') else '[]'::jsonb end
  ) with ordinality where public.consultation_risk_review_valid(value) order by ordinality desc limit 1;
  held := coalesce(prior->>'level' = 'High' and (review is null or review->>'level' = 'High'),false);
  if not coalesce(eligible,false) and not held then return weighted; end if;
  tier := case when held then 'High' else public.consultation_risk_level(coalesce(saved->>'level',saved->>'riskLevel',saved->>'risk_level')) end;
  reasons := public.consultation_assessment_reasons(saved);
  if held and not exists(select 1 from jsonb_array_elements(reasons) where value->>'ruleId' = 'previous_high_held') then reasons := reasons || jsonb_build_array(jsonb_build_object('ruleId','previous_high_held',
    'message','A previous saved High assessment is retained until an authorized professional documents a confirmed reassessment and reason.')); end if;
  select coalesce(jsonb_agg(value || jsonb_build_object('code',coalesce(value->>'ruleId','clinical_assessment'),
      'name',coalesce(value->>'message',replace(coalesce(value->>'field',value->>'ruleId','Clinical assessment'),'_',' ')),
      'field',value->>'field','measured',null,'weight',null,'source','consultation') order by ordinality),'[]'::jsonb),
    coalesce(string_agg(coalesce(value->>'message',replace(coalesce(value->>'field',value->>'ruleId',''),'_',' ')),'; ' order by ordinality),'')
    into factors, explanation from jsonb_array_elements(reasons) with ordinality;
  result := jsonb_build_object('riskScore',null,'riskLevel',case when tier = 'Medium' then 'Moderate' else tier end,
    'riskAssessmentStatus',case when tier is not null then 'assessed' else coalesce(saved->>'status','unavailable') end,
    'missingMeasurements',case when jsonb_typeof(saved->'missingMeasurements') = 'array' then saved->'missingMeasurements' else weighted->'missingMeasurements' end,'riskFactors',case when p_include_factors then factors else '[]'::jsonb end,
    'riskReason',explanation,'riskSource',case when held then 'saved_high_hold' when saved = screening then 'consultation_screening' else 'saved_clinical_assessment' end);
  if held then result := result || jsonb_build_object('previousAssessment',prior); end if;
  if screening is not null then result := result || jsonb_build_object('consultationRiskAssessment',screening); end if;
  if clinical is not null then result := result || jsonb_build_object('clinicalAssessment',clinical); end if;
  return result;
end;
$$;

-- Compose saved consultation assessments with the resident-risk projection
-- without replacing the resident-risk migration's authorization and scope logic.
create or replace function public.analytics_resident_risk(
  p_resident_id text, p_config jsonb, p_include_factors boolean default true,
  p_from timestamptz default null, p_until timestamptz default null
)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with latest as (
    select v.* from public.visits v where v.resident_id = p_resident_id
      and (p_from is null or coalesce(v.visit_date, v.created_at) >= p_from)
      and (p_until is null or coalesce(v.visit_date, v.created_at) < p_until)
    order by coalesce(v.visit_date, v.created_at) desc, v.updated_at desc, v.created_at desc, v.id desc limit 1
  ), vitals as materialized (
    select public.analytics_assess_vitals(v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg,
      p_config, p_include_factors) as risk, coalesce(v.visit_date, v.created_at) as occurred_at, v.id
    from (select 1) singleton left join latest v on true
  ), baseline as (
    select case when exists (select 1 from public.visits c where c.resident_id = p_resident_id
        and c.status not in ('draft', 'submitted') and c.consultation_details ?|
          array['clinicalAssessment', 'clinical_assessment', 'riskAssessment', 'risk_assessment', 'clinicalAssessmentHistory']
        and (p_from is null or coalesce(c.visit_date, c.created_at) >= p_from)
        and (p_until is null or coalesce(c.visit_date, c.created_at) < p_until))
      then public.analytics_overlay_clinical_risk(risk || jsonb_build_object('riskAssessedAt',
        case when risk ->> 'riskLevel' is not null then occurred_at end), occurred_at,
        public.analytics_clinical_sources(p_resident_id, p_from, p_until), p_include_factors, id)
      else risk || jsonb_build_object('riskAssessedAt', case when risk ->> 'riskLevel' is not null then occurred_at end) end as risk
    from vitals
  ), saved as (
    select public.analytics_assess_saved_visit(v.id, p_config, p_include_factors) as risk,
      public.consultation_clinical_instant(v.consultation_details, v.visit_date) as occurred_at
    from latest v
  ), ranked as (
    select baseline.risk as base_risk, saved.risk as saved_risk, saved.occurred_at,
      case public.consultation_risk_level(saved.risk ->> 'riskLevel')
        when 'High' then 3 when 'Medium' then 2 when 'Low' then 1 else 0 end as saved_severity,
      case public.consultation_risk_level(baseline.risk ->> 'riskLevel')
        when 'High' then 3 when 'Medium' then 2 when 'Low' then 1 else 0 end as base_severity
    from baseline left join saved on true
  )
  select case
    when saved_severity > base_severity then saved_risk || jsonb_build_object('riskAssessedAt', occurred_at)
    when coalesce(saved_risk ? 'consultationRiskAssessment', false)
      or coalesce(saved_risk ? 'clinicalAssessment', false) then
        base_risk
        || case when saved_risk ? 'consultationRiskAssessment'
          then jsonb_build_object('consultationRiskAssessment', saved_risk -> 'consultationRiskAssessment') else '{}'::jsonb end
        || case when saved_risk ? 'clinicalAssessment'
          then jsonb_build_object('clinicalAssessment', saved_risk -> 'clinicalAssessment') else '{}'::jsonb end
    else base_risk
  end
  from ranked;
$$;

create or replace function public.analytics_consultation_risk(p_consultation_id text, p_config jsonb)
returns text language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with visit as (
    select v.* from public.visits v where v.id = p_consultation_id
  ), baseline as (
    select case when v.status not in ('draft', 'submitted') and v.consultation_details ?|
      array['clinicalAssessment', 'clinical_assessment', 'riskAssessment', 'risk_assessment', 'clinicalAssessmentHistory'] then
      coalesce(public.analytics_overlay_clinical_risk(public.analytics_assess_vitals(v.bp, v.o2sat, v.temperature,
        v.hr, v.rr, v.height_cm, v.weight_kg, p_config, false), coalesce(v.visit_date, v.created_at),
        public.analytics_clinical_sources(v.resident_id, null, null, v.id), false, v.id) ->> 'riskLevel', 'Unassessed')
      else public.analytics_visit_risk(v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg, p_config) end as level
    from visit v
  ), saved as (
    select public.analytics_assess_saved_visit(v.id, p_config, false) ->> 'riskLevel' as level from visit v
  ), ranked as (
    select baseline.level as base_level, saved.level as saved_level,
      case public.consultation_risk_level(saved.level)
        when 'High' then 3 when 'Medium' then 2 when 'Low' then 1 else 0 end as saved_severity,
      case public.consultation_risk_level(baseline.level)
        when 'High' then 3 when 'Medium' then 2 when 'Low' then 1 else 0 end as base_severity
    from baseline cross join saved
  )
  select case when saved_severity > base_severity then
      case public.consultation_risk_level(saved_level) when 'Medium' then 'Moderate' else public.consultation_risk_level(saved_level) end
    else base_level end
  from ranked;
$$;

create or replace function public.guard_consultation_clinical_integrity()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare old_details jsonb; old_history jsonb; new_history jsonb; key text; entry jsonb;
  actor public.profiles%rowtype; resident public.residents%rowtype; bp text[]; strict_clinical boolean;
  assessment jsonb; review jsonb; prior jsonb; changed boolean; previous_level text; service_category text;
  clinical jsonb; configuration jsonb; medication jsonb; field text;
begin
  old_details := case when tg_op = 'UPDATE' then coalesce(old.consultation_details,'{}'::jsonb) else '{}'::jsonb end;
  if new.consultation_details is null then return new; end if;
  if jsonb_typeof(new.consultation_details) <> 'object' then raise exception 'Consultation details must be a JSON object' using errcode='23514'; end if;
  select * into resident from public.residents where id = new.resident_id;
  if tg_op = 'UPDATE' and new.consultation_details->'reportingScope' is distinct from old_details->'reportingScope' then
    raise exception 'Service-time reporting scope is immutable and historical scope cannot be guessed' using errcode='23514';
  end if;
  if tg_op = 'INSERT' and new.consultation_details ? 'reportingScope' and (
    jsonb_typeof(new.consultation_details->'reportingScope') <> 'object'
    or (new.consultation_details#>>'{reportingScope,municipalityId}') is distinct from resident.municipality_id::text
    or (new.consultation_details#>>'{reportingScope,barangayId}') is distinct from resident.barangay_id::text
  ) then raise exception 'Service-time reporting scope must come from the authoritative resident' using errcode='23514'; end if;
  clinical := new.consultation_details->'clinicalAssessment';
  if auth.role() = 'authenticated' and (clinical is distinct from old_details->'clinicalAssessment'
    or new.consultation_details->'consultationRiskAssessment' is distinct from old_details->'consultationRiskAssessment') then
    raise exception 'Clinical assessments and audit snapshots are server-managed' using errcode='42501';
  end if;
  if clinical is distinct from old_details->'clinicalAssessment' and clinical->>'reviewStatus' = 'approved' and not exists (
    select 1 from public.clinical_assessment_protocols p where p.municipality_id = resident.municipality_id and p.active
      and p.version = clinical->>'protocolVersion' and p.approved_by::text = clinical#>>'{approval,approvedBy}'
      and p.approved_at = (clinical#>>'{approval,approvedAt}')::timestamptz
      and p.review_reference = clinical#>>'{approval,reviewReference}' and p.thresholds = clinical#>'{inputs,thresholds}'
  ) then raise exception 'An active, clinically approved local protocol is required for approved clinicalAssessment' using errcode='23514'; end if;
  foreach key in array array['riskLevel','risk_level','riskAssessment','risk_assessment','clinical_assessment'] loop
    if new.consultation_details->key is distinct from old_details->key and new.consultation_details ? key then
      raise exception 'Legacy risk snapshots are read-only; use server-managed screening and clinical review' using errcode='23514';
    end if;
  end loop;
  foreach key in array array['consultationRiskAssessmentHistory','riskReviewHistory'] loop
    old_history := coalesce(old_details->key,'[]'::jsonb);
    new_history := coalesce(new.consultation_details->key,'[]'::jsonb);
    if jsonb_typeof(new_history) <> 'array' or jsonb_array_length(new_history) < jsonb_array_length(old_history)
      or (select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) from jsonb_array_elements(new_history) with ordinality
        where ordinality <= jsonb_array_length(old_history)) <> old_history then
      raise exception 'Consultation risk and review history is append-only' using errcode='23514';
    end if;
    for entry in select value from jsonb_array_elements(new_history) with ordinality where ordinality > jsonb_array_length(old_history) loop
      if key = 'riskReviewHistory' then
        if not public.consultation_risk_review_valid(entry) then raise exception 'Risk review requires a confirmed reassessment and reason' using errcode='23514'; end if;
        select * into actor from public.profiles where id::text = entry->>'reviewedBy';
        if not found or actor.status::text <> 'active' or actor.role::text is distinct from entry->>'reviewedByRole'
          or not (actor.role::text in ('mho','phn','rhu_personnel') or (actor.role::text = 'health_supervisor' and 'consultation' = any(actor.rhu_stations))) then
          raise exception 'An authorized clinical professional must reassess risk' using errcode='42501';
        end if;
        if (entry->>'reviewedAt')::timestamptz > clock_timestamp() + interval '5 minutes' then raise exception 'Risk review time must be server-generated' using errcode='23514'; end if;
      else
        if entry->>'version' is distinct from 'consultation-screening-v1' or entry->'decisionSupport' is distinct from 'true'::jsonb
          or entry->>'reviewStatus' is distinct from 'professional_review_required' or entry ? 'approval'
          or (entry->>'level' is not null and entry->>'level' not in ('Low','Medium','High')) then
          raise exception 'Consultation screening is professional-review decision support, not an approved protocol' using errcode='23514';
        end if;
        if entry->>'level' = 'Low' and entry->>'sourceStatus' is distinct from 'available' then
          raise exception 'Low screening risk requires verified available clinical sources' using errcode='23514';
        end if;
        select * into actor from public.profiles where id::text = entry->>'assessedBy';
        if not found or actor.status::text <> 'active' or actor.role::text is distinct from entry->>'assessedByRole'
          or actor.role::text not in ('mho','phn','rhu_personnel','health_supervisor') then raise exception 'Screening actor must be authenticated clinical staff' using errcode='42501'; end if;
        if entry->>'assessedAt' is null or (entry->>'assessedAt')::timestamptz > clock_timestamp() + interval '5 minutes' then
          raise exception 'Screening assessment time must be server-generated' using errcode='23514';
        end if;
      end if;
      if actor.municipality_id is distinct from resident.municipality_id
        or (actor.role::text = 'health_supervisor' and actor.barangay_id is distinct from resident.barangay_id)
        or (auth.role() = 'authenticated' and actor.id is distinct from auth.uid()) then
        raise exception 'Clinical actor is outside resident scope' using errcode='42501';
      end if;
    end loop;
  end loop;
  assessment := new.consultation_details->'consultationRiskAssessment';
  changed := assessment is distinct from old_details->'consultationRiskAssessment';
  if changed then
    if assessment is null or assessment is distinct from new.consultation_details->'consultationRiskAssessmentHistory'->-1 then
      raise exception 'The screening snapshot must equal the last server assessment history entry' using errcode='23514';
    end if;
    if jsonb_array_length(coalesce(new.consultation_details->'consultationRiskAssessmentHistory','[]'::jsonb))
      <= jsonb_array_length(coalesce(old_details->'consultationRiskAssessmentHistory','[]'::jsonb)) then raise exception 'Screening updates require an appended audit snapshot' using errcode='23514'; end if;
    review := assessment->'review';
    if review is not null and review is distinct from old_details->'consultationRiskAssessment'->'review'
      and (review is distinct from new.consultation_details->'riskReviewHistory'->-1
        or jsonb_array_length(coalesce(new.consultation_details->'riskReviewHistory','[]'::jsonb)) <= jsonb_array_length(coalesce(old_details->'riskReviewHistory','[]'::jsonb))) then
      raise exception 'Risk reassessment requires an append-only clinician review' using errcode='23514';
    end if;
    prior := public.consultation_previous_assessment(new.resident_id,new.id,public.consultation_clinical_instant(new.consultation_details,new.visit_date));
    previous_level := public.consultation_risk_level(coalesce(public.consultation_saved_assessment(old_details)->>'level',
      public.consultation_saved_assessment(old_details)->>'riskLevel',public.consultation_saved_assessment(old_details)->>'risk_level'));
    if tg_op = 'UPDATE' and previous_level is distinct from 'High' and old_details->'consultationRiskAssessment' is null
      and not exists(select 1 from jsonb_array_elements(coalesce(old_details->'riskReviewHistory','[]'::jsonb))
        where public.consultation_risk_review_valid(value) and value->>'level' <> 'High') then
      configuration := public.analytics_risk_configuration();
      if public.analytics_assess_vitals(old.bp,old.o2sat,old.temperature,old.hr,old.rr,old.height_cm,old.weight_kg,configuration,false)->>'riskLevel' = 'High'
        and public.consultation_clinical_instant(old_details,old.visit_date) is not null then previous_level := 'High'; end if;
    end if;
    if (prior->>'level' = 'High' or previous_level = 'High') and assessment->>'level' is distinct from 'High'
      and not (public.consultation_risk_review_valid(review) and review = new.consultation_details->'riskReviewHistory'->-1
        and jsonb_array_length(new.consultation_details->'riskReviewHistory') > jsonb_array_length(coalesce(old_details->'riskReviewHistory','[]'::jsonb))) then
      raise exception 'Saved High risk requires an authorized confirmed reassessment reason before downgrade' using errcode='23514';
    end if;
  end if;
  strict_clinical := (new.consultation_details->>'clinicalIntegrityVersion' = 'consultation-clinical-v1'
    or (tg_op = 'INSERT' and new.status::text = 'completed' and new.client_operation_key is not null))
    and (tg_op = 'INSERT' or (new.consultation_details->>'clinicalIntegrityVersion') is distinct from (old_details->>'clinicalIntegrityVersion')
      or (new.bp,new.temperature,new.hr,new.rr,new.height_cm,new.weight_kg,new.o2sat,new.findings,new.phn_assessment,new.chief_complaint,new.treatment_given,new.visit_date)
        is distinct from (old.bp,old.temperature,old.hr,old.rr,old.height_cm,old.weight_kg,old.o2sat,old.findings,old.phn_assessment,old.chief_complaint,old.treatment_given,old.visit_date)
      or (new.consultation_details->'consultationDate',new.consultation_details->'consultationTime',new.consultation_details->'findings',new.consultation_details->'diagnosis',new.consultation_details->'clinicalIndicators',new.consultation_details->'clinicalContext')
        is distinct from (old_details->'consultationDate',old_details->'consultationTime',old_details->'findings',old_details->'diagnosis',old_details->'clinicalIndicators',old_details->'clinicalContext')
      or changed or new.status::text = 'completed' and old.status::text is distinct from 'completed');
  if strict_clinical then
    if new.consultation_details->>'consultationDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or new.consultation_details->>'consultationTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or new.consultation_details->>'consultationDate' is null or new.consultation_details->>'consultationTime' is null then
      raise exception 'Clinical consultation requires a real calendar date and HH:MM time' using errcode='23514';
    end if;
    perform make_date(substring(new.consultation_details->>'consultationDate',1,4)::integer,
      substring(new.consultation_details->>'consultationDate',6,2)::integer,substring(new.consultation_details->>'consultationDate',9,2)::integer);
    if public.consultation_clinical_instant(new.consultation_details,new.visit_date) is distinct from
      (date_trunc('minute',new.visit_date at time zone 'UTC') at time zone 'UTC') then raise exception 'Consultation timestamp must preserve the Manila clinical date/time' using errcode='23514'; end if;
    bp := regexp_match(btrim(coalesce(new.bp,'')),'^([0-9]{2,3})[[:space:]]*/[[:space:]]*([0-9]{2,3})$');
    if bp is null or bp[1]::numeric not between 40 and 300 or bp[2]::numeric not between 20 and 200 or bp[1]::numeric <= bp[2]::numeric
      or new.temperature is null or new.temperature::text in ('NaN','Infinity','-Infinity') or new.temperature not between 25 and 46
      or new.hr is null or new.hr::text in ('NaN','Infinity','-Infinity') or new.hr not between 20 and 250
      or new.rr is null or new.rr::text in ('NaN','Infinity','-Infinity') or new.rr not between 5 and 80
      or new.height_cm is null or new.height_cm::text in ('NaN','Infinity','-Infinity') or new.height_cm not between 30 and 250
      or new.weight_kg is null or new.weight_kg::text in ('NaN','Infinity','-Infinity') or new.weight_kg not between 0.5 and 400
      or new.o2sat is null or new.o2sat::text in ('NaN','Infinity','-Infinity') or new.o2sat not between 50 and 100 then
      raise exception 'Complete clinically plausible consultation measurements are required' using errcode='23514';
    end if;
    new.bmi := round(new.weight_kg / ((new.height_cm / 100) * (new.height_cm / 100)),1);
    if new.bmi not between 3 and 200 then raise exception 'Calculated BMI is outside the plausible range' using errcode='23514'; end if;
    new.bmi_category := case when new.bmi < 18.5 then 'Underweight' when new.bmi < 25 then 'Normal' when new.bmi < 30 then 'Overweight' else 'Obese' end;
    if length(btrim(coalesce(new.consultation_details->>'findings',''))) = 0
      or new.consultation_details#>'{clinicalIndicators,dangerSignsReviewed}' is distinct from 'true'::jsonb then
      raise exception 'Clinical findings and confirmed danger-sign review are required' using errcode='23514';
    end if;
    if new.medications is not null and (tg_op = 'INSERT' or new.medications is distinct from old.medications) then
      if jsonb_typeof(new.medications) <> 'array' or jsonb_array_length(new.medications) > 50 then raise exception 'Use up to 50 structured prescriptions' using errcode='23514'; end if;
      for medication in select value from jsonb_array_elements(new.medications) loop
        if tg_op = 'UPDATE' and exists(select 1 from jsonb_array_elements(coalesce(old.medications,'[]'::jsonb)) where value = medication) then continue; end if;
        if jsonb_typeof(medication) <> 'object' then raise exception 'A structured prescription is required' using errcode='23514'; end if;
        foreach field in array array['genericName','dose','route','frequency','duration','quantity'] loop
          if jsonb_typeof(medication->field) is distinct from 'string' or length(btrim(medication->>field)) = 0 then
            raise exception 'Prescription requires medicine, dose, route, frequency, duration and quantity' using errcode='23514';
          end if;
        end loop;
        if medication->>'route' not in ('Oral','Sublingual','Buccal','Topical','Inhalation','Intranasal','Ophthalmic','Otic','Rectal','Vaginal','Intramuscular','Subcutaneous','Intravenous','Other / As prescribed')
          or medication->>'frequency' not in ('Once daily','Twice daily','Three times daily','Four times daily','Every 4 hours','Every 6 hours','Every 8 hours','Every 12 hours','Once weekly','Single dose','As needed','As prescribed')
          or medication->>'quantity' !~ '^[1-9][0-9]{0,4}$' or (medication->>'quantity')::numeric > 10000 then
          raise exception 'Prescription route/frequency must be predefined and quantity must be a positive whole number' using errcode='23514';
        end if;
        if nullif(medication->>'medicineId','') is not null then
          if medication->'custom' is distinct from 'false'::jsonb or not exists(
            select 1 from public.medicines m where m.id::text = medication->>'medicineId' and m.active and m.generic_name = medication->>'genericName'
          ) then raise exception 'Catalog prescription must reference an active canonical medicine' using errcode='23514'; end if;
        elsif medication->'custom' is distinct from 'true'::jsonb or medication->>'source' is distinct from 'custom' then
          raise exception 'A non-catalog prescription must be explicitly custom' using errcode='23514';
        end if;
      end loop;
    end if;
  end if;
  if new.consultation_details->'maternal' is distinct from old_details->'maternal' and new.consultation_details->'maternal' is not null then
    select hs.category into service_category from public.health_services hs where hs.id = new.health_service_id;
    if lower(coalesce(service_category,'')) <> 'maternal' or new.consultation_details#>>'{maternal,careType}' not in ('prenatal','postpartum') then
      raise exception 'Maternal consultation requires a real maternal service and explicit care type' using errcode='23514';
    end if;
    if nullif(new.consultation_details#>>'{maternal,pregnancyId}','') is not null and not exists (
      select 1 from public.maternal_pregnancies p where p.id::text = new.consultation_details#>>'{maternal,pregnancyId}' and p.resident_id = new.resident_id
    ) then raise exception 'Maternal pregnancy must belong to the consultation resident' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;
create trigger visits_consultation_clinical_integrity_guard before insert or update on public.visits
  for each row execute function public.guard_consultation_clinical_integrity();

-- Validate only new/changed links so pre-existing mismatches remain available for audited correction.
create or replace function public.guard_maternal_same_resident_pregnancy()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.pregnancy_id is not null and (tg_op = 'INSERT' or new.pregnancy_id is distinct from old.pregnancy_id or new.resident_id is distinct from old.resident_id)
    and not exists(select 1 from public.maternal_pregnancies p where p.id = new.pregnancy_id and p.resident_id = new.resident_id) then
    raise exception 'Maternal record pregnancy must belong to the same resident' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger maternal_records_same_resident_pregnancy before insert or update of pregnancy_id,resident_id on public.maternal_records
  for each row execute function public.guard_maternal_same_resident_pregnancy();

-- Internal helpers stay service-role-only, matching the existing aggregate RPC boundary.
do $acl$
declare signature text;
begin
  foreach signature in array array[
    'public.analytics_assess_vitals(text,numeric,numeric,numeric,numeric,numeric,numeric,jsonb,boolean)',
    'public.consultation_risk_level(text)', 'public.consultation_clinical_instant(jsonb,timestamptz)',
    'public.consultation_risk_review_valid(jsonb)', 'public.consultation_assessment_reasons(jsonb)', 'public.consultation_saved_assessment(jsonb)',
    'public.consultation_previous_assessment(text,text,timestamptz,jsonb)', 'public.analytics_assess_saved_visit(text,jsonb,boolean)',
    'public.guard_consultation_clinical_integrity()', 'public.guard_maternal_same_resident_pregnancy()'
  ] loop
    execute 'revoke all on function ' || signature || ' from public, anon, authenticated';
    execute 'grant execute on function ' || signature || ' to service_role';
  end loop;
end;
$acl$;

commit;
notify pgrst, 'reload schema';

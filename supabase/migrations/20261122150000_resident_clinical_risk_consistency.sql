-- Saved consultation assessments and resident/dashboard risk share one projection.
-- Human reviewed corrections release older evidence; normal visits do not.
begin;

-- Restore the completeness contract erased by 20261120140000 without changing
-- the original configured vitals rules or any evaluator signature.
create or replace function public.analytics_assess_vitals(
  p_bp text, p_o2sat numeric, p_temperature numeric, p_pulse numeric,
  p_respiratory numeric, p_height_cm numeric, p_weight_kg numeric, p_config jsonb,
  p_include_factors boolean default true
)
returns jsonb language sql immutable parallel safe
set search_path = pg_catalog, public, pg_temp
as $$
  with health as (
    select regexp_match(btrim(coalesce(p_bp, '')),
      '^[[:space:]]*([0-9]{2,3})[[:space:]]*/[[:space:]]*([0-9]{2,3})[[:space:]]*$') as bp,
      case when p_height_cm > 0 and p_weight_kg > 0
        and p_height_cm::text not in ('NaN', 'Infinity', '-Infinity')
        and p_weight_kg::text not in ('NaN', 'Infinity', '-Infinity')
        then round(p_weight_kg / ((p_height_cm / 100) * (p_height_cm / 100)), 1) end as bmi
  ), fields as (
    select field, case when measured > 0
      and measured::text not in ('NaN', 'Infinity', '-Infinity') then measured end as measured
    from health cross join lateral (values
      ('systolic', bp[1]::numeric), ('diastolic', bp[2]::numeric),
      ('o2sat', p_o2sat), ('temperature', p_temperature), ('pulse', p_pulse),
      ('respiratory', p_respiratory), ('bmi', bmi)
    ) measurements(field, measured)
  ), criteria as (
    select * from jsonb_to_recordset(p_config -> 'criteria') as c(
      code text, name text, field text, operator text, value numeric, value2 numeric,
      weight numeric, enabled boolean, priority integer
    ) where c.enabled is distinct from false
  ), required as (
    select distinct field from criteria
  ), completeness as (
    select count(*) as required_count, count(f.measured) as available_count,
      coalesce(jsonb_agg(r.field order by r.field collate "C")
        filter (where f.measured is null), '[]'::jsonb) as missing
    from required r left join fields f on f.field = r.field
  ), matched as (
    select c.code, c.name, c.field, coalesce(c.weight, 0) as weight, c.priority, f.measured
    from criteria c join fields f on f.field = c.field
    where f.measured is not null and case c.operator
      when 'gte' then f.measured >= c.value
      when 'gt' then f.measured > c.value
      when 'lte' then f.measured <= c.value
      when 'lt' then f.measured < c.value
      when 'eq' then f.measured = c.value
      when 'between' then f.measured >= c.value and f.measured <= c.value2
      else false end
  ), explanation as (
    select 'Missing measurements: ' || string_agg(case r.field
      when 'systolic' then 'systolic blood pressure' when 'diastolic' then 'diastolic blood pressure'
      when 'o2sat' then 'oxygen saturation' when 'pulse' then 'pulse rate'
      when 'respiratory' then 'respiratory rate' when 'bmi' then 'body mass index'
      else r.field end, ', ' order by r.field collate "C") || '.' as missing_reason
    from required r left join fields f on f.field = r.field where f.measured is null
  ), score as (
    select coalesce(sum(weight), 0) as value from matched
  ), assessment as (
    select c.*, score.value, case
      when score.value >= coalesce((p_config #>> '{thresholds,highMin}')::numeric, 70) then 'High'
      when score.value >= coalesce((p_config #>> '{thresholds,moderateMin}')::numeric, 40) then 'Moderate'
      else 'Low' end as level
    from completeness c cross join score
  )
  select jsonb_build_object(
    'riskScore', case when a.available_count > 0 then a.value end,
    'riskLevel', case when a.available_count > 0 and
      (a.available_count = a.required_count or a.level in ('Moderate', 'High')) then a.level end,
    'riskAssessmentStatus', case when a.available_count = 0 then 'unavailable'
      when a.available_count < a.required_count and a.level = 'Low' then 'incomplete' else 'assessed' end,
    'missingMeasurements', a.missing,
    'riskReason', case
      when a.available_count = 0 then 'No measurements required by the configured risk criteria are available.'
      when a.available_count < a.required_count and a.level = 'Low'
        then 'Assessment incomplete. ' || e.missing_reason
      else coalesce((select string_agg(name || ' (' || trim_scale(measured)::text || ')', '; '
        order by coalesce(priority, 0), code collate "C") from matched),
        'No configured risk criteria matched the recorded measurements.') ||
        case when a.available_count < a.required_count then ' ' || e.missing_reason else '' end end,
    'riskFactors', case when p_include_factors then coalesce((select jsonb_agg(jsonb_build_object(
      'code', code, 'name', name, 'field', field, 'measured', measured, 'weight', weight
    ) order by coalesce(priority, 0), code collate "C") from matched), '[]'::jsonb) else '[]'::jsonb end)
  from assessment a cross join explanation e;
$$;

-- Malformed historical JSON must not take an entire authorized risk page down.
create or replace function public.analytics_risk_timestamp(p_value text)
returns timestamptz language plpgsql immutable parallel safe
set search_path = pg_catalog, public, pg_temp set timezone = 'UTC' set datestyle = 'ISO, YMD'
as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}([Tt ][0-9:.]+([Zz]|[+-][0-9:]+)?)?$' then return null; end if;
  return date_trunc('milliseconds', p_value::timestamptz);
exception when invalid_datetime_format or datetime_field_overflow then return null;
end;
$$;

create or replace function public.analytics_clinical_level(p_assessment jsonb)
returns text language sql immutable parallel safe
set search_path = pg_catalog, public, pg_temp
as $$
  select case when coalesce(p_assessment ->> 'status', '') in ('', 'assessed', 'reviewed') then
    case regexp_replace(lower(btrim(coalesce(p_assessment ->> 'level', p_assessment ->> 'riskLevel',
      p_assessment ->> 'risk_level', ''))), '\s+risk$', '')
      when 'high' then 'High' when 'medium' then 'Moderate' when 'moderate' then 'Moderate' when 'low' then 'Low' end end;
$$;

create or replace function public.analytics_reviewed_correction(p_assessment jsonb)
returns boolean language sql immutable parallel safe
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(p_assessment ->> 'status' = 'reviewed' and p_assessment ->> 'reviewStatus' = 'reviewed'
    and jsonb_typeof(p_assessment #> '{review,by}') = 'string' and length(btrim(p_assessment #>> '{review,by}')) > 0
    and public.analytics_risk_timestamp(p_assessment #>> '{review,at}') is not null
    and jsonb_typeof(p_assessment #> '{review,reason}') = 'string' and length(btrim(p_assessment #>> '{review,reason}')) > 0
    and (public.analytics_clinical_level(jsonb_build_object('level', p_assessment #>> '{review,previousLevel}')) is not null
      or p_assessment #>> '{review,previousLevel}' = 'Unassessed'), false);
$$;

create index if not exists analytics_visits_saved_clinical_idx on public.visits(resident_id)
  where status not in ('draft', 'submitted') and (
    consultation_details ?| array['clinicalAssessment', 'clinical_assessment', 'riskAssessment', 'risk_assessment', 'clinicalAssessmentHistory']);

-- Only actual saved objects are sources. A legacy riskLevel scalar is not an assessment.
create or replace function public.analytics_clinical_sources(
  p_resident_id text, p_from timestamptz default null, p_until timestamptz default null,
  p_consultation_id text default null, p_completed_only boolean default false
)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with visits as (
    select v.*, case when jsonb_typeof(v.consultation_details -> 'clinicalAssessmentHistory') = 'array'
      then v.consultation_details -> 'clinicalAssessmentHistory' else '[]'::jsonb end as history
    from public.visits v where v.resident_id = p_resident_id and v.status not in ('draft', 'submitted')
      and (not p_completed_only or v.status = 'completed')
      and (p_consultation_id is null or v.id = p_consultation_id)
      and (p_from is null or coalesce(v.visit_date, v.created_at) >= p_from)
      and (p_until is null or coalesce(v.visit_date, v.created_at) < p_until)
      and v.consultation_details ?| array['clinicalAssessment', 'clinical_assessment', 'riskAssessment', 'risk_assessment', 'clinicalAssessmentHistory']
  ), sources as (
    select v.id, coalesce(v.visit_date, v.created_at) as visit_at, v.updated_at, v.created_at,
      coalesce(v.consultation_details ->> 'consultationDate',
        ((coalesce(v.visit_date, v.created_at) at time zone 'Asia/Manila')::date)::text) as clinical_date,
      a.assessment, a.ordinal
    from visits v cross join lateral (
      select value as assessment, ordinality as ordinal from jsonb_array_elements(v.history) with ordinality
      union all select coalesce(nullif(v.consultation_details -> 'clinicalAssessment', 'null'::jsonb),
        nullif(v.consultation_details -> 'clinical_assessment', 'null'::jsonb),
        nullif(v.consultation_details -> 'riskAssessment', 'null'::jsonb),
        nullif(v.consultation_details -> 'risk_assessment', 'null'::jsonb)), jsonb_array_length(v.history) + 1
    ) a where jsonb_typeof(a.assessment) = 'object'
  )
  select coalesce(jsonb_agg(jsonb_build_object('consultationId', id, 'clinicalDate', clinical_date,
    'visitDate', visit_at, 'updatedAt', updated_at, 'createdAt', created_at,
    'ordinal', ordinal, 'assessment', assessment) order by id, ordinal), '[]'::jsonb) from sources;
$$;

-- The latest complete reviewed correction starts a new resident evidence window.
create or replace function public.analytics_clinical_evidence(p_sources jsonb)
returns table(source jsonb, assessed_at timestamptz, level text, severity integer, reviewed boolean)
language sql stable
set search_path = pg_catalog, public, pg_temp
as $$
  with raw as (
    select s as source, coalesce(public.analytics_risk_timestamp(s #>> '{assessment,assessedAt}'),
      public.analytics_risk_timestamp(s #>> '{assessment,review,at}'),
      public.analytics_risk_timestamp(s ->> 'visitDate'), public.analytics_risk_timestamp(s ->> 'createdAt'),
      '1970-01-01T00:00:00Z'::timestamptz) as assessed_at,
      coalesce(public.analytics_risk_timestamp(s ->> 'visitDate'), public.analytics_risk_timestamp(s ->> 'createdAt'),
        '1970-01-01T00:00:00Z'::timestamptz) as visit_at,
      coalesce(public.analytics_risk_timestamp(s ->> 'updatedAt'), public.analytics_risk_timestamp(s ->> 'createdAt'),
        '1970-01-01T00:00:00Z'::timestamptz) as updated_at,
      coalesce(public.analytics_risk_timestamp(s ->> 'createdAt'), '1970-01-01T00:00:00Z'::timestamptz) as created_at,
      coalesce(s ->> 'consultationId', '') collate "C" as id, coalesce((s ->> 'ordinal')::bigint, 0) as ordinal,
      public.analytics_clinical_level(s -> 'assessment') as level,
      public.analytics_reviewed_correction(s -> 'assessment') as reviewed
    from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) s
  ), correction as (
    select * from raw where reviewed
    order by assessed_at desc, visit_at desc, updated_at desc, created_at desc, id desc, ordinal desc limit 1
  )
  select r.source, r.assessed_at, r.level, case r.level when 'High' then 3 when 'Moderate' then 2 when 'Low' then 1 else 0 end, r.reviewed
  from raw r left join correction c on true
  where c.source is null or (r.assessed_at, r.visit_at, r.updated_at, r.created_at, r.id, r.ordinal)
    >= (c.assessed_at, c.visit_at, c.updated_at, c.created_at, c.id, c.ordinal)
  order by r.assessed_at desc, r.visit_at desc, r.updated_at desc, r.created_at desc, r.id desc, r.ordinal desc;
$$;

create or replace function public.analytics_overlay_clinical_risk(
  p_risk jsonb, p_vitals_at timestamptz, p_sources jsonb, p_include_factors boolean default true,
  p_consultation_id text default null
)
returns jsonb language plpgsql stable
set search_path = pg_catalog, public, pg_temp set timezone = 'UTC'
as $$
declare
  evidence record; selected_source jsonb; selected_at timestamptz; selected_level text; selected_severity integer := -1;
  newest_source jsonb; newest_at timestamptz; newest_level text; correction_at timestamptz;
  assessment jsonb; factors jsonb := '[]'; normalized_factors jsonb; factor_reason text; reason text;
  assessed_latest boolean := false; checked_latest boolean := false;
  vitals_severity integer := case p_risk ->> 'riskLevel' when 'High' then 3 when 'Moderate' then 2 when 'Low' then 1 else 0 end;
begin
  for evidence in select * from public.analytics_clinical_evidence(p_sources) loop
    if not checked_latest and evidence.source ->> 'consultationId' = p_consultation_id then
      assessed_latest := evidence.level is not null; checked_latest := true;
    end if;
    if newest_source is null then newest_source := evidence.source; newest_at := evidence.assessed_at; newest_level := evidence.level; end if;
    if evidence.reviewed and correction_at is null then correction_at := evidence.assessed_at; end if;
    if evidence.severity > selected_severity then
      selected_source := evidence.source; selected_at := evidence.assessed_at;
      selected_level := evidence.level; selected_severity := evidence.severity;
    end if;
  end loop;
  if selected_source is null then return p_risk; end if;
  if selected_level = 'Low' and newest_level is null then
    selected_source := newest_source; selected_at := newest_at; selected_level := null; selected_severity := 0;
  end if;
  if not assessed_latest and (correction_at is null or coalesce(p_vitals_at, '1970-01-01T00:00:00Z'::timestamptz) > correction_at)
    and vitals_severity > selected_severity and vitals_severity > 1 then return p_risk; end if;
  assessment := selected_source -> 'assessment';
  for factors in select value from (values (assessment -> 'mainFactors'), (assessment -> 'riskFactors'),
    (assessment -> 'factors'), (assessment -> 'reasons')) candidates(value)
    where case when jsonb_typeof(value) = 'array' then jsonb_array_length(value) > 0 else false end limit 1 loop end loop;
  factors := coalesce(factors, '[]'::jsonb);
  select coalesce(jsonb_agg(case when jsonb_typeof(f.value) = 'object' then f.value else '{}'::jsonb end
    || jsonb_build_object('name', n.name) order by f.ordinal), '[]'::jsonb),
    string_agg(nullif(n.name, ''), '; ' order by f.ordinal)
  into normalized_factors, factor_reason from jsonb_array_elements(factors) with ordinality f(value, ordinal)
  cross join lateral (select case when jsonb_typeof(f.value) = 'string' then f.value #>> '{}'
    else coalesce(nullif(f.value ->> 'name', ''), nullif(f.value ->> 'label', ''), nullif(f.value ->> 'message', ''),
      nullif(f.value ->> 'reason', ''), replace(coalesce(f.value ->> 'field', f.value ->> 'ruleId', ''), '_', ' ')) end as name) n;
  reason := coalesce(nullif(btrim(case when jsonb_typeof(assessment -> 'summary') = 'string' then assessment ->> 'summary' end), ''),
    nullif(btrim(case when jsonb_typeof(assessment -> 'reason') = 'string' then assessment ->> 'reason' end), ''),
    nullif(btrim(case when jsonb_typeof(assessment -> 'riskReason') = 'string' then assessment ->> 'riskReason' end), ''),
    case when public.analytics_reviewed_correction(assessment) then nullif(btrim(assessment #>> '{review,reason}'), '') end,
    factor_reason, 'Saved clinical assessment: ' || coalesce(selected_level, 'unclassified') || '.');
  return jsonb_build_object('riskScore', null, 'riskLevel', selected_level,
    'riskFactors', case when p_include_factors then normalized_factors else '[]'::jsonb end,
    'riskAssessedAt', case when selected_at <> '1970-01-01T00:00:00Z'::timestamptz
      then to_char(selected_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'riskAssessmentStatus', coalesce(nullif(btrim(assessment ->> 'status'), ''), case when selected_level is null then 'unavailable' else 'assessed' end),
    'missingMeasurements', case when jsonb_typeof(assessment -> 'missingMeasurements') = 'array' then assessment -> 'missingMeasurements' else '[]'::jsonb end,
    'riskReason', reason);
end;
$$;

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
  )
  select case when exists (select 1 from public.visits c where c.resident_id = p_resident_id
      and c.status not in ('draft', 'submitted') and c.consultation_details ?|
        array['clinicalAssessment', 'clinical_assessment', 'riskAssessment', 'risk_assessment', 'clinicalAssessmentHistory']
      and (p_from is null or coalesce(c.visit_date, c.created_at) >= p_from)
      and (p_until is null or coalesce(c.visit_date, c.created_at) < p_until))
    then public.analytics_overlay_clinical_risk(risk || jsonb_build_object('riskAssessedAt',
      case when risk ->> 'riskLevel' is not null then occurred_at end), occurred_at,
      public.analytics_clinical_sources(p_resident_id, p_from, p_until), p_include_factors, id)
    else risk || jsonb_build_object('riskAssessedAt', case when risk ->> 'riskLevel' is not null then occurred_at end) end from vitals;
$$;

create or replace function public.analytics_consultation_risk(p_consultation_id text, p_config jsonb)
returns text language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select case when v.status not in ('draft', 'submitted') and v.consultation_details ?|
    array['clinicalAssessment', 'clinical_assessment', 'riskAssessment', 'risk_assessment', 'clinicalAssessmentHistory'] then
    coalesce(public.analytics_overlay_clinical_risk(public.analytics_assess_vitals(v.bp, v.o2sat, v.temperature,
    v.hr, v.rr, v.height_cm, v.weight_kg, p_config, false), coalesce(v.visit_date, v.created_at),
    public.analytics_clinical_sources(v.resident_id, null, null, v.id), false, v.id) ->> 'riskLevel', 'Unassessed')
    else public.analytics_visit_risk(v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg, p_config) end
  from public.visits v where v.id = p_consultation_id;
$$;

create or replace function public.resident_clinical_risk_context(p_resident_id text)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with evidence as materialized (
    select * from public.analytics_clinical_evidence(public.analytics_clinical_sources(p_resident_id))
  ), indicators as (
    select distinct on (i.key) i.key, i.value from evidence e
    cross join lateral jsonb_each(case when jsonb_typeof(e.source #> '{assessment,inputs,indicators}') = 'object'
      then e.source #> '{assessment,inputs,indicators}' else '{}'::jsonb end) i
    where i.key in ('hypertension', 'diabetes', 'otherSignificantDisease', 'multipleComorbidities', 'chronicDisease')
      and jsonb_typeof(i.value) = 'boolean'
    order by i.key, e.assessed_at desc, public.analytics_risk_timestamp(e.source ->> 'visitDate') desc,
      public.analytics_risk_timestamp(e.source ->> 'updatedAt') desc, public.analytics_risk_timestamp(e.source ->> 'createdAt') desc,
      e.source ->> 'consultationId' collate "C" desc, (e.source ->> 'ordinal')::bigint desc
  )
  select jsonb_build_object('assessments', coalesce((select jsonb_agg(jsonb_build_object(
    'consultationId', source ->> 'consultationId', 'clinicalDate', source ->> 'clinicalDate', 'assessment', source -> 'assessment')
    order by assessed_at desc, public.analytics_risk_timestamp(source ->> 'visitDate') desc,
      public.analytics_risk_timestamp(source ->> 'updatedAt') desc, public.analytics_risk_timestamp(source ->> 'createdAt') desc,
      source ->> 'consultationId' collate "C" desc, (source ->> 'ordinal')::bigint desc) from evidence), '[]'::jsonb),
    'clinicalIndicators', coalesce((select jsonb_object_agg(key, value) from indicators), '{}'::jsonb));
$$;

-- Fractional configured weights must survive persistence unchanged.
alter table public.residents alter column risk_score type numeric using risk_score::numeric;

alter table public.residents add column if not exists risk_assessment_status text,
  add column if not exists risk_missing_measurements jsonb not null default '[]'::jsonb,
  add column if not exists risk_reason text;

create or replace function public.persist_resident_risk(p_resident_id text, p_config jsonb default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare risk jsonb; written integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('resident-clinical-risk:' || p_resident_id, 0));
  perform 1 from public.residents where id = p_resident_id for no key update;
  if not found then return null; end if;
  -- This query runs AFTER the lock, not in a stale pre-lock assessment CTE.
  risk := public.analytics_resident_risk(p_resident_id, coalesce(p_config, public.analytics_risk_configuration()), true);
  update public.residents set risk_score = (risk ->> 'riskScore')::numeric, risk_level = risk ->> 'riskLevel',
    risk_factors = risk -> 'riskFactors', risk_assessed_at = public.analytics_risk_timestamp(risk ->> 'riskAssessedAt'),
    risk_assessment_status = risk ->> 'riskAssessmentStatus', risk_missing_measurements = risk -> 'missingMeasurements',
    risk_reason = risk ->> 'riskReason'
  where id = p_resident_id and (risk_score, risk_level, risk_factors, risk_assessed_at,
    risk_assessment_status, risk_missing_measurements, risk_reason) is distinct from
    ((risk ->> 'riskScore')::numeric, risk ->> 'riskLevel', risk -> 'riskFactors',
      public.analytics_risk_timestamp(risk ->> 'riskAssessedAt'), risk ->> 'riskAssessmentStatus', risk -> 'missingMeasurements', risk ->> 'riskReason');
  get diagnostics written = row_count;
  return jsonb_build_object('risk', risk, 'updated', written > 0);
end;
$$;

create or replace function public.recalculate_resident_risk(p_barangay text default null, p_municipality_id uuid default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare resident record; configuration jsonb := public.analytics_risk_configuration(); updated integer := 0; total integer := 0; result jsonb;
begin
  for resident in select id from public.residents
    where (p_municipality_id is null or municipality_id = p_municipality_id)
      and (p_barangay is null or lower(btrim(barangay)) = lower(btrim(p_barangay))) order by id loop
    result := public.persist_resident_risk(resident.id, configuration);
    total := total + 1;
    if (result ->> 'updated')::boolean then updated := updated + 1; end if;
  end loop;
  return jsonb_build_object('updated', updated, 'total', total);
end;
$$;

-- A second clinician can save after the builder's prior-history read. Serialize
-- before writing and amend only the new history tail, never its audit prefix.
create or replace function public.guard_consultation_clinical_risk()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare assessment jsonb; history jsonb; previous_history jsonb; prior record; reason jsonb; label text;
begin
  assessment := new.consultation_details -> 'clinicalAssessment';
  if new.status in ('draft', 'submitted') or jsonb_typeof(assessment) is distinct from 'object' then return new; end if;
  if tg_op = 'UPDATE' and assessment is not distinct from old.consultation_details -> 'clinicalAssessment' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('resident-clinical-risk:' || new.resident_id, 0));
  perform 1 from public.residents where id = new.resident_id for no key update;
  if public.analytics_reviewed_correction(assessment) or public.analytics_clinical_level(assessment) not in ('Low', 'Moderate')
    or public.analytics_clinical_level(assessment) is null then return new; end if;
  history := case when jsonb_typeof(new.consultation_details -> 'clinicalAssessmentHistory') = 'array'
    then new.consultation_details -> 'clinicalAssessmentHistory' else '[]'::jsonb end;
  previous_history := case when tg_op = 'UPDATE' and jsonb_typeof(old.consultation_details -> 'clinicalAssessmentHistory') = 'array'
    then old.consultation_details -> 'clinicalAssessmentHistory' else '[]'::jsonb end;
  if tg_op = 'UPDATE' and jsonb_array_length(history) <= jsonb_array_length(previous_history) then return new; end if;
  select * into prior from public.analytics_clinical_evidence(public.analytics_clinical_sources(new.resident_id))
    where level = 'High' order by assessed_at desc limit 1;
  if not found then return new; end if;
  label := 'Previous saved High clinical assessment requires clinician review';
  reason := jsonb_build_object('ruleId', 'previous_high_risk_requires_review', 'reference', 'saved_clinical_assessment',
    'sourceConsultationId', prior.source ->> 'consultationId',
    'sourceAssessedAt', prior.source #>> '{assessment,assessedAt}');
  assessment := assessment || jsonb_build_object('level', 'High', 'status', 'assessed',
    'referralEvaluationRequired', true, 'urgency', case when assessment ->> 'urgency' = 'immediate' then 'immediate' else 'prompt' end,
    'summary', label || '.',
    'mainFactors', (case when jsonb_typeof(assessment -> 'mainFactors') = 'array' then assessment -> 'mainFactors' else '[]'::jsonb end) || jsonb_build_array(label),
    'reasons', (case when jsonb_typeof(assessment -> 'reasons') = 'array' then assessment -> 'reasons' else '[]'::jsonb end) || jsonb_build_array(reason),
    'followUpRequirements', (case when jsonb_typeof(assessment -> 'followUpRequirements') = 'array' then assessment -> 'followUpRequirements' else '[]'::jsonb end)
      || jsonb_build_array('clinical_risk_review_required'));
  new.consultation_details := jsonb_set(new.consultation_details, '{clinicalAssessment}', assessment, true);
  if jsonb_array_length(history) > 0 then
    history := jsonb_set(history, array[(jsonb_array_length(history) - 1)::text], assessment);
    new.consultation_details := jsonb_set(new.consultation_details, '{clinicalAssessmentHistory}', history, true);
  end if;
  return new;
end;
$$;

drop trigger if exists zz_visits_resident_clinical_risk_guard on public.visits;

create trigger zz_visits_resident_clinical_risk_guard before insert or update on public.visits
  for each row execute function public.guard_consultation_clinical_risk();

create or replace function public.persist_risk_after_visits()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare resident_id text;
begin
  if tg_op = 'INSERT' then
    for resident_id in select distinct v.resident_id from new_visits v order by v.resident_id loop
      perform public.persist_resident_risk(resident_id);
    end loop;
  elsif tg_op = 'DELETE' then
    for resident_id in select distinct v.resident_id from old_visits v order by v.resident_id loop
      perform public.persist_resident_risk(resident_id);
    end loop;
  else
    for resident_id in
      select id from (
        select n.resident_id as id from new_visits n join old_visits o using(id)
        where (n.resident_id, n.status, n.visit_date, n.bp, n.o2sat, n.temperature, n.hr, n.rr, n.height_cm, n.weight_kg, n.consultation_details)
          is distinct from (o.resident_id, o.status, o.visit_date, o.bp, o.o2sat, o.temperature, o.hr, o.rr, o.height_cm, o.weight_kg, o.consultation_details)
        union select o.resident_id from new_visits n join old_visits o using(id)
        where n.resident_id is distinct from o.resident_id
      ) changed order by id loop
      perform public.persist_resident_risk(resident_id);
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists visits_resident_risk_after_insert on public.visits;

create trigger visits_resident_risk_after_insert after insert on public.visits
  referencing new table as new_visits for each statement execute function public.persist_risk_after_visits();

drop trigger if exists visits_resident_risk_after_update on public.visits;

create trigger visits_resident_risk_after_update after update on public.visits
  referencing old table as old_visits new table as new_visits for each statement execute function public.persist_risk_after_visits();

drop trigger if exists visits_resident_risk_after_delete on public.visits;

create trigger visits_resident_risk_after_delete after delete on public.visits
  referencing old table as old_visits for each statement execute function public.persist_risk_after_visits();

create or replace function public.resident_risk_for_ids(p_resident_ids text[], p_actor_id uuid default null)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare actor public.profiles%rowtype; configuration jsonb; result jsonb;
begin
  if coalesce(cardinality(p_resident_ids), 0) > 1000 then
    raise exception using errcode = '22023', message = 'Risk detail requests must be paginated.';
  end if;
  if p_actor_id is not null then
    select * into actor from public.profiles where id = p_actor_id;
    if not found or not coalesce(actor.status::text = 'active' or
      (actor.role::text = 'resident' and actor.status::text = 'pending_verification'), false) then
      raise exception using errcode = '42501', message = 'An active authorized account is required.';
    end if;
  end if;
  configuration := public.analytics_risk_configuration();
  select coalesce(jsonb_agg(public.analytics_resident_risk(r.id, configuration, true)
    || jsonb_build_object('residentId', r.id) order by r.id), '[]'::jsonb) into result
  from public.residents r where r.id = any(p_resident_ids) and (
    p_actor_id is null or (actor.role::text = 'resident' and r.auth_user_id = actor.id)
    or (r.municipality_id = actor.municipality_id and (actor.role::text in ('mho', 'phn')
      or (actor.role::text in ('health_supervisor', 'bhw') and r.barangay_id = actor.barangay_id))));
  return result;
end;
$$;

create or replace function public.resident_risk_summary(p_actor_id uuid, p_barangay text default null, p_limit integer default 0, p_offset integer default 0)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare actor public.profiles%rowtype; configuration jsonb := public.analytics_risk_configuration(); result jsonb;
begin
  select * into actor from public.profiles where id = p_actor_id;
  if not found or actor.status::text is distinct from 'active' or actor.municipality_id is null
    or coalesce(actor.role::text, '') not in ('phn', 'mho', 'health_supervisor')
    or not public.personnel_actor_has_permission(actor.id, 'reports.analytics.view') then
    raise exception using errcode = '42501', message = 'The risk summary requires an active authorized account.';
  end if;
  if p_limit < 0 or p_limit > 500 or p_offset < 0 then
    raise exception using errcode = '22023', message = 'Invalid risk pagination.';
  end if;
  with assessed as materialized (
    select r.id, public.analytics_resident_risk(r.id, configuration, true) as risk
    from public.residents r join public.barangays b on b.id = r.barangay_id
    where r.municipality_id = actor.municipality_id and b.municipality_id = actor.municipality_id
      and (actor.role::text <> 'health_supervisor' or r.barangay_id = actor.barangay_id)
      and (p_barangay is null or lower(btrim(b.name)) = lower(btrim(p_barangay)))
  ), high as (
    select * from assessed where risk ->> 'riskLevel' = 'High' order by id limit p_limit offset p_offset
  ), totals as (
    select count(*) as total, count(*) filter (where risk ->> 'riskLevel' = 'High') as high_count,
      count(*) filter (where risk ->> 'riskLevel' = 'Moderate') as moderate_count,
      count(*) filter (where risk ->> 'riskLevel' = 'Low') as low_count,
      count(*) filter (where risk ->> 'riskLevel' is not null) as assessed_count from assessed
  )
  select jsonb_build_object('summary', jsonb_build_object('totalResidents', total, 'assessed', assessed_count,
    'high', high_count, 'moderate', moderate_count, 'low', low_count, 'unassessed', total - assessed_count,
    'highRiskPercentage', case when assessed_count > 0 then round(high_count::numeric * 100 / assessed_count) else null end,
    'distribution', jsonb_build_array(jsonb_build_object('name','Low Risk','value',low_count),
      jsonb_build_object('name','Moderate Risk','value',moderate_count), jsonb_build_object('name','High Risk','value',high_count),
      jsonb_build_object('name','Unassessed','value',total - assessed_count))),
    'highRisk', (select coalesce(jsonb_agg(risk || jsonb_build_object('residentId',id) order by id), '[]'::jsonb) from high))
  into result from totals;
  return result;
end;
$$;

-- Patch only risk inputs in the deployed aggregate function. Preserve its
-- authorization, geography, disease/activity/date definitions and response DTO.
do $migration$
declare definition text; updated text;
begin
  definition := replace(pg_get_functiondef('public.scoped_aggregate_analytics(uuid,text,text,text,text,text,date,date,integer,boolean)'::regprocedure), E'\r\n', E'\n');
  updated := replace(definition,
    $old$select distinct on (v.resident_id) v.resident_id,
        public.analytics_visit_risk(v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg, v_config) as risk
      from visits v order by v.resident_id$old$,
    $new$select distinct on (v.resident_id) v.resident_id,
        case when exists (select 1 from public.visits c where c.resident_id = v.resident_id and c.status not in ('draft', 'submitted')
          and c.consultation_details ?| array['clinicalAssessment','clinical_assessment','riskAssessment','risk_assessment','clinicalAssessmentHistory'])
        then coalesce(public.analytics_resident_risk(v.resident_id, v_config, false) ->> 'riskLevel', 'Unassessed')
        else public.analytics_visit_risk(v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg, v_config) end as risk
      from visits v order by v.resident_id$new$);
  if updated = definition then raise exception 'Clinical risk: current early-warning risk marker not found'; end if;
  definition := updated;
  updated := replace(definition,
    $old$public.analytics_visit_risk(v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg, v_config) as risk
      from visits v
      where (coalesce(p_from$old$,
    $new$case when exists (select 1 from public.visits c where c.resident_id = v.resident_id and c.status not in ('draft', 'submitted')
          and c.consultation_details ?| array['clinicalAssessment','clinical_assessment','riskAssessment','risk_assessment','clinicalAssessmentHistory'])
        then coalesce(public.analytics_resident_risk(v.resident_id, v_config, false,
          coalesce(p_from, case when p_year is not null then make_date(p_year, 1, 1) end)::timestamp at time zone 'Asia/Manila',
          (coalesce(p_to, case when p_year is not null then make_date(p_year, 12, 31) end) + 1)::timestamp at time zone 'Asia/Manila')
          ->> 'riskLevel', 'Unassessed')
        else public.analytics_visit_risk(v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg, v_config) end as risk
      from visits v
      where (coalesce(p_from$new$);
  if updated = definition then raise exception 'Clinical risk: reporting early-warning risk marker not found'; end if;
  definition := updated;
  updated := replace(definition,
    $old$public.analytics_visit_risk(v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg, v_config) as risk$old$,
    $new$public.analytics_consultation_risk(v.id, v_config) as risk,
        case when v.status not in ('draft', 'submitted') and v.consultation_details ?|
          array['clinicalAssessment','clinical_assessment','riskAssessment','risk_assessment','clinicalAssessmentHistory']
        then public.analytics_clinical_sources(v.resident_id, null, null, v.id) else '[]'::jsonb end as risk_sources$new$);
  if updated = definition then raise exception 'Clinical risk: map encounter risk marker not found'; end if;
  definition := updated;
  updated := replace(definition,
    $old$select distinct on (resident_id) resident_id, barangay_id, risk from visits
      order by resident_id, occurred_at desc, updated_at desc, created_at desc, id desc$old$,
    $new$select distinct on (v.resident_id) v.resident_id, v.barangay_id,
        case when exists (select 1 from public.visits c where c.resident_id = v.resident_id and c.status not in ('draft', 'submitted')
          and c.consultation_details ?| array['clinicalAssessment','clinical_assessment','riskAssessment','risk_assessment','clinicalAssessmentHistory'])
        then coalesce(public.analytics_resident_risk(v.resident_id, v_config, false) ->> 'riskLevel', 'Unassessed') else v.risk end as risk
      from visits v order by v.resident_id, v.occurred_at desc, v.updated_at desc, v.created_at desc, v.id desc$new$);
  if updated = definition then raise exception 'Clinical risk: current map resident risk marker not found'; end if;
  definition := updated;
  updated := replace(definition,
    $old$select distinct on (v.resident_id) v.resident_id, v.barangay_id, v.risk
      from visits v$old$,
    $new$select distinct on (v.resident_id) v.resident_id, v.barangay_id,
        case when exists (select 1 from public.visits c where c.resident_id = v.resident_id and c.status not in ('draft', 'submitted')
          and c.consultation_details ?| array['clinicalAssessment','clinical_assessment','riskAssessment','risk_assessment','clinicalAssessmentHistory'])
        then coalesce(public.analytics_resident_risk(v.resident_id, v_config, false, v_from, v_until) ->> 'riskLevel', 'Unassessed') else v.risk end as risk
      from visits v$new$);
  if updated = definition then raise exception 'Clinical risk: reporting map risk marker not found'; end if;
  definition := updated;
  updated := replace(definition,
    $old$    ), latest_matched as (
      select distinct on (resident_id) resident_id, barangay_id, risk from matched
      order by resident_id, occurred_at desc, updated_at desc, created_at desc, id desc$old$,
    $new$    ), matched_sources as materialized (
      select resident_id, jsonb_path_query_array(jsonb_agg(risk_sources), '$[*][*]') as sources from matched group by resident_id
    ), latest_matched as (
      select distinct on (m.resident_id) m.resident_id, m.barangay_id,
        case when s.sources <> '[]'::jsonb then coalesce(public.analytics_overlay_clinical_risk(
          jsonb_build_object('riskLevel', m.risk), m.occurred_at, s.sources, false, m.id) ->> 'riskLevel', 'Unassessed')
          else m.risk end as risk from matched m join matched_sources s on s.resident_id = m.resident_id
      order by m.resident_id, m.occurred_at desc, m.updated_at desc, m.created_at desc, m.id desc$new$);
  if updated = definition then raise exception 'Clinical risk: matched map risk marker not found'; end if;
  definition := updated;
  updated := replace(definition,
    $old$public.analytics_visit_risk(
          v.bp, v.o2sat, v.temperature, v.hr, v.rr, v.height_cm, v.weight_kg, v_config) = p_risk_level$old$,
    $new$public.analytics_consultation_risk(v.id, v_config) = p_risk_level$new$);
  if updated = definition then raise exception 'Clinical risk: trend encounter risk marker not found'; end if;
  execute updated;
end;
$migration$;

revoke all on function public.analytics_assess_vitals(text,numeric,numeric,numeric,numeric,numeric,numeric,jsonb,boolean) from public, anon, authenticated;

revoke all on function public.analytics_risk_timestamp(text) from public, anon, authenticated;

revoke all on function public.analytics_clinical_level(jsonb) from public, anon, authenticated;

revoke all on function public.analytics_reviewed_correction(jsonb) from public, anon, authenticated;

revoke all on function public.analytics_clinical_sources(text,timestamptz,timestamptz,text,boolean) from public, anon, authenticated;

revoke all on function public.analytics_clinical_evidence(jsonb) from public, anon, authenticated;

revoke all on function public.analytics_overlay_clinical_risk(jsonb,timestamptz,jsonb,boolean,text) from public, anon, authenticated;

revoke all on function public.analytics_resident_risk(text,jsonb,boolean,timestamptz,timestamptz) from public, anon, authenticated;

revoke all on function public.analytics_consultation_risk(text,jsonb) from public, anon, authenticated;

revoke all on function public.resident_clinical_risk_context(text) from public, anon, authenticated;

revoke all on function public.persist_resident_risk(text,jsonb) from public, anon, authenticated;

revoke all on function public.guard_consultation_clinical_risk() from public, anon, authenticated;

revoke all on function public.persist_risk_after_visits() from public, anon, authenticated;

revoke all on function public.resident_risk_for_ids(text[],uuid) from public, anon, authenticated;

revoke all on function public.resident_risk_summary(uuid,text,integer,integer) from public, anon, authenticated;

revoke all on function public.recalculate_resident_risk(text,uuid) from public, anon, authenticated;

revoke all on function public.scoped_aggregate_analytics(uuid,text,text,text,text,text,date,date,integer,boolean) from public, anon, authenticated;

grant execute on function public.analytics_assess_vitals(text,numeric,numeric,numeric,numeric,numeric,numeric,jsonb,boolean),
  public.analytics_risk_timestamp(text), public.analytics_clinical_level(jsonb), public.analytics_reviewed_correction(jsonb),
  public.analytics_clinical_sources(text,timestamptz,timestamptz,text,boolean), public.analytics_clinical_evidence(jsonb),
  public.analytics_overlay_clinical_risk(jsonb,timestamptz,jsonb,boolean,text),
  public.analytics_resident_risk(text,jsonb,boolean,timestamptz,timestamptz), public.analytics_consultation_risk(text,jsonb),
  public.resident_clinical_risk_context(text), public.persist_resident_risk(text,jsonb),
  public.guard_consultation_clinical_risk(), public.persist_risk_after_visits(),
  public.resident_risk_for_ids(text[],uuid), public.resident_risk_summary(uuid,text,integer,integer),
  public.recalculate_resident_risk(text,uuid), public.scoped_aggregate_analytics(uuid,text,text,text,text,text,date,date,integer,boolean)
  to service_role;

-- Bring already-saved consultation evidence into the same persistent projection.
select public.recalculate_resident_risk();

commit;

notify pgrst, 'reload schema';

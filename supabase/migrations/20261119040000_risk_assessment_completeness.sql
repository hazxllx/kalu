-- KFT-014: completeness follows the current enabled configuration, never the
-- presence of an unrelated vital. Preserve configured scoring and positive risk.
begin;

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

-- Retain deployed authorization, scope, signatures and ACLs. Change only the
-- resident-population counts in these existing large aggregate functions.
do $migration$
declare
  definition text;
  updated text;
begin
  definition := pg_get_functiondef('public.scoped_aggregate_analytics(uuid,text,text,text,text,text,date,date,integer,boolean)'::regprocedure);
  updated := replace(definition,
    $old$count(*) filter (where risk = 'Unassessed') as unassessed from latest$old$,
    $new$count(*) filter (where coalesce(risk, 'Unassessed') = 'Unassessed') as unassessed
      from residents r left join latest l on l.resident_id = r.id$new$);
  if updated = definition then
    raise exception 'KFT-014: expected early-warning risk population definition not found';
  end if;
  execute updated;

  definition := pg_get_functiondef('public.resident_risk_summary(uuid,text,integer,integer)'::regprocedure);
  updated := replace(definition,
    $old$'high', high_count, 'moderate', moderate_count, 'low', low_count,$old$,
    $new$'high', high_count, 'moderate', moderate_count, 'low', low_count,
      'unassessed', total - assessed_count,$new$);
  updated := replace(updated,
    $old$jsonb_build_object('name','High Risk','value',high_count)))$old$,
    $new$jsonb_build_object('name','High Risk','value',high_count),
        jsonb_build_object('name','Unassessed','value',total - assessed_count)))$new$);
  if updated = definition or position($check$'name','Unassessed'$check$ in updated) = 0 then
    raise exception 'KFT-014: expected resident risk summary definition not found';
  end if;
  execute updated;
end;
$migration$;

revoke all on function public.analytics_assess_vitals(text, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.analytics_assess_vitals(text, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, boolean) to service_role;

commit;
notify pgrst, 'reload schema';

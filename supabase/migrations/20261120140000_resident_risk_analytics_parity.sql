-- supabase/migrations/20261120140000_resident_risk_analytics_parity.sql
-- Keep database-backed resident risk classifications identical to the
-- canonical backend residentRisk.assessVitals implementation.
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
  ), raw_fields as (
    select field, measured from health cross join lateral (values
      ('systolic', bp[1]::numeric), ('diastolic', bp[2]::numeric),
      ('o2sat', p_o2sat), ('temperature', p_temperature), ('pulse', p_pulse),
      ('respiratory', p_respiratory), ('bmi', bmi)
    ) measurements(field, measured)
  ), fields as (
    select field, case
      when measured is null or measured::text in ('NaN', 'Infinity', '-Infinity') then null
      when measured > 0 then measured else null end as measured
    from raw_fields
  ), criteria as (
    select c.code, c.name, c.field, c.operator, c.value, c.value2,
      coalesce(c.weight, 0) as weight, c.priority
    from jsonb_to_recordset(p_config -> 'criteria') as c(
      code text, name text, field text, operator text, value numeric, value2 numeric,
      weight numeric, enabled boolean, priority integer
    )
    where c.enabled is distinct from false
  ), matched as (
    select c.code, c.name, c.field, c.weight, c.priority, f.measured
    from criteria c join fields f on f.field = c.field
    where f.measured is not null and case c.operator
      when 'gte' then f.measured >= c.value
      when 'gt' then f.measured > c.value
      when 'lte' then f.measured <= c.value
      when 'lt' then f.measured < c.value
      when 'eq' then f.measured = c.value
      when 'between' then f.measured >= c.value and f.measured <= c.value2
      else false end
  ), score as (
    select coalesce(sum(weight), 0) as value from matched
  ), assessment as (
    select
      exists (select 1 from criteria c join fields f on f.field = c.field where f.measured is not null) as assessed,
      exists (select 1 from criteria c where not exists (
        select 1 from fields f where f.field = c.field and f.measured is not null
      )) as incomplete,
      score.value,
      case
        when score.value >= coalesce((p_config #>> '{thresholds,highMin}')::numeric, 70) then 'High'
        when score.value >= coalesce((p_config #>> '{thresholds,moderateMin}')::numeric, 40) then 'Moderate'
        else 'Low' end as classified_level
    from score
  )
  select jsonb_build_object(
    'riskScore', case when a.assessed then a.value end,
    'riskLevel', case when a.assessed and not (a.incomplete and a.classified_level = 'Low')
      then a.classified_level end,
    'riskFactors', case when p_include_factors then coalesce((select jsonb_agg(jsonb_build_object(
      'code', code, 'name', name, 'field', field, 'measured', measured, 'weight', weight
    ) order by coalesce(priority, 0), code collate "C") from matched), '[]'::jsonb) else '[]'::jsonb end)
  from assessment a;
$$;

commit;

-- Directory/detail risk uses the same SQL evaluator as aggregate analytics,
-- without fetching every visit or applying a 5,000-row cutoff in Node.
begin;

create or replace function public.resident_risk_for_ids(p_resident_ids text[], p_actor_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.profiles%rowtype;
  configuration jsonb;
  result jsonb;
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
  with scoped as (
    select r.id from public.residents r
    where r.id = any(p_resident_ids) and (
      p_actor_id is null -- service-role-only internal clinical risk persistence
      or (actor.role::text = 'resident' and r.auth_user_id = actor.id)
      or (r.municipality_id = actor.municipality_id and (
        actor.role::text in ('mho', 'phn')
        or (actor.role::text in ('health_supervisor', 'bhw') and r.barangay_id = actor.barangay_id)
      ))
    )
  ), assessed as (
    select r.id, coalesce(v.visit_date, v.created_at) as occurred_at,
      public.analytics_assess_vitals(v.bp, v.o2sat, v.temperature, v.hr, v.rr,
        v.height_cm, v.weight_kg, configuration, true) as risk
    from scoped r left join lateral (
      select * from public.visits v where v.resident_id = r.id
      order by coalesce(v.visit_date, v.created_at) desc, v.updated_at desc, v.created_at desc, v.id desc limit 1
    ) v on true
  )
  select coalesce(jsonb_agg(risk || jsonb_build_object(
    'residentId', id, 'riskAssessedAt', case when risk ->> 'riskLevel' is not null then occurred_at end
  ) order by id), '[]'::jsonb) into result from assessed;
  return result;
end;
$$;

revoke all on function public.resident_risk_for_ids(text[], uuid) from public, anon, authenticated;
grant execute on function public.resident_risk_for_ids(text[], uuid) to service_role;

-- Administrator configuration changes recalculate ALL eligible records in SQL.
-- Only changed risk fields are written, preventing gratuitous revision bumps.
create or replace function public.recalculate_resident_risk(p_barangay text default null, p_municipality_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  configuration jsonb := public.analytics_risk_configuration();
  result jsonb;
begin
  with assessed as materialized (
    select r.id, coalesce(v.visit_date, v.created_at) as occurred_at,
      public.analytics_assess_vitals(v.bp, v.o2sat, v.temperature, v.hr, v.rr,
        v.height_cm, v.weight_kg, configuration, true) as risk
    from public.residents r left join lateral (
      select * from public.visits v where v.resident_id = r.id
      order by coalesce(v.visit_date, v.created_at) desc, v.updated_at desc, v.created_at desc, v.id desc limit 1
    ) v on true
    where (p_municipality_id is null or r.municipality_id = p_municipality_id)
      and (p_barangay is null or lower(trim(r.barangay)) = lower(trim(p_barangay)))
  ), written as (
    update public.residents r set
      risk_score = (a.risk ->> 'riskScore')::numeric,
      risk_level = a.risk ->> 'riskLevel',
      risk_factors = a.risk -> 'riskFactors',
      risk_assessed_at = case when a.risk ->> 'riskLevel' is not null then a.occurred_at end
    from assessed a where r.id = a.id and (
      r.risk_score is distinct from (a.risk ->> 'riskScore')::numeric
      or r.risk_level is distinct from (a.risk ->> 'riskLevel')
      or r.risk_factors is distinct from (a.risk -> 'riskFactors')
      or r.risk_assessed_at is distinct from case when a.risk ->> 'riskLevel' is not null then a.occurred_at end
    ) returning r.id
  )
  select jsonb_build_object('updated', (select count(*) from written), 'total', (select count(*) from assessed)) into result;
  return result;
end;
$$;
revoke all on function public.recalculate_resident_risk(text, uuid) from public, anon, authenticated;
grant execute on function public.recalculate_resident_risk(text, uuid) to service_role;

-- Count-only utility summaries and bounded high-risk IDs use current SQL risk,
-- not a truncated full-resident/visit fetch in Node.
create or replace function public.resident_risk_summary(p_actor_id uuid, p_barangay text default null, p_limit integer default 0, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.profiles%rowtype;
  configuration jsonb := public.analytics_risk_configuration();
  result jsonb;
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
    select r.id, coalesce(v.visit_date, v.created_at) as occurred_at,
      public.analytics_assess_vitals(v.bp, v.o2sat, v.temperature, v.hr, v.rr,
        v.height_cm, v.weight_kg, configuration, true) as risk
    from public.residents r join public.barangays b on b.id = r.barangay_id
    left join lateral (
      select * from public.visits v where v.resident_id = r.id
      order by coalesce(v.visit_date, v.created_at) desc, v.updated_at desc, v.created_at desc, v.id desc limit 1
    ) v on true
    where r.municipality_id = actor.municipality_id and b.municipality_id = actor.municipality_id
      and (actor.role::text <> 'health_supervisor' or r.barangay_id = actor.barangay_id)
      and (p_barangay is null or lower(trim(b.name)) = lower(trim(p_barangay)))
  ), high as (
    select * from assessed where risk ->> 'riskLevel' = 'High' order by id limit p_limit offset p_offset
  ), totals as (
    select count(*) as total,
      count(*) filter (where risk ->> 'riskLevel' = 'High') as high_count,
      count(*) filter (where risk ->> 'riskLevel' = 'Moderate') as moderate_count,
      count(*) filter (where risk ->> 'riskLevel' = 'Low') as low_count,
      count(*) filter (where risk ->> 'riskLevel' is not null) as assessed_count
    from assessed
  )
  select jsonb_build_object(
    'summary', jsonb_build_object('totalResidents', total, 'assessed', assessed_count,
      'high', high_count, 'moderate', moderate_count, 'low', low_count,
      'highRiskPercentage', case when assessed_count > 0 then round(high_count::numeric * 100 / assessed_count) else null end,
      'distribution', jsonb_build_array(jsonb_build_object('name','Low Risk','value',low_count),
        jsonb_build_object('name','Moderate Risk','value',moderate_count), jsonb_build_object('name','High Risk','value',high_count))),
    'highRisk', (select coalesce(jsonb_agg(risk || jsonb_build_object('residentId',id,'riskAssessedAt',occurred_at) order by id), '[]'::jsonb) from high)
  ) into result from totals;
  return result;
end;
$$;
revoke all on function public.resident_risk_summary(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.resident_risk_summary(uuid, text, integer, integer) to service_role;
commit;
notify pgrst, 'reload schema';

-- Rollback after reverting directory risk RPC consumers:
-- DROP FUNCTION IF EXISTS public.resident_risk_for_ids(text[], uuid);
-- DROP FUNCTION IF EXISTS public.recalculate_resident_risk(text, uuid);
-- DROP FUNCTION IF EXISTS public.resident_risk_summary(uuid, text, integer, integer);
-- No resident/consultation rows or existing RLS policies are changed.

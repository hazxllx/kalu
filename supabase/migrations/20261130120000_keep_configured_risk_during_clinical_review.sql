-- A pending protocol review is not an assessed clinical level and must not
-- erase a resident risk level independently produced from complete configured
-- measurements. Keep saved, classified clinical evidence (including prior
-- high-risk evidence) in the overlay; ignore unclassified pending snapshots.
begin;

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
  ), clinical as materialized (
    select public.analytics_clinical_sources(p_resident_id, p_from, p_until) as sources
  ), classified_clinical as materialized (
    select coalesce(jsonb_agg(source), '[]'::jsonb) as sources
    from clinical c
    cross join lateral jsonb_array_elements(c.sources) as item(source)
    where public.analytics_clinical_level(source -> 'assessment') is not null
  )
  select case when jsonb_array_length(classified_clinical.sources) > 0
    then public.analytics_overlay_clinical_risk(
      risk || jsonb_build_object('riskAssessedAt',
        case when risk ->> 'riskLevel' is not null then occurred_at end),
      occurred_at,
      classified_clinical.sources,
      p_include_factors,
      id
    )
    else risk || jsonb_build_object('riskAssessedAt',
      case when risk ->> 'riskLevel' is not null then occurred_at end)
    end
  from vitals cross join classified_clinical;
$$;

-- Rebuild persisted classifications with the corrected source precedence.
select public.recalculate_resident_risk(null, null);

commit;

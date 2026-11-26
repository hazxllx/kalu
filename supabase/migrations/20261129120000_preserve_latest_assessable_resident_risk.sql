-- supabase/migrations/20261129120000_preserve_latest_assessable_resident_risk.sql
-- Prefer the latest finalized consultation that can produce a risk level.
-- A later empty/draft visit must not erase a valid historical assessment.
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

-- Refresh the stored directory projection while keeping the consultation's
-- actual historical date as risk_assessed_at.
select public.recalculate_resident_risk(null, null);

commit;
